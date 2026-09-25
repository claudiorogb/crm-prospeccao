import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function haversineKm(lat1:number,lon1:number,lat2:number,lon2:number){
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

async function reserveQuota(admin:any, organizationId:string, bucket:"enterprise"|"pro") {
  const { data, error } = await admin.rpc("reserve_google_places_quota", {
    p_organization_id: organizationId,
    p_bucket: bucket,
    p_amount: 1,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row?.allowed) {
    const label = bucket === "enterprise" ? "Enterprise" : "Pro";
    throw Object.assign(new Error(`Monthly Google Places ${label} safety quota reached`), { status: 429, usage: row?.usage || 0, quota: row?.quota || 0 });
  }
  return { usage: Number(row.usage || 0), quota: Number(row.quota || 0) };
}

async function resolveCampaignCenter(admin:any,campaign:any,googleApiKey:string){
  if(campaign.center_latitude!=null&&campaign.center_longitude!=null){
    return {latitude:Number(campaign.center_latitude),longitude:Number(campaign.center_longitude),pro:null};
  }
  const pro = await reserveQuota(admin,campaign.organization_id,"pro");
  const response=await fetch("https://places.googleapis.com/v1/places:searchText",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Goog-Api-Key":googleApiKey,"X-Goog-FieldMask":"places.location"},
    body:JSON.stringify({textQuery:`${campaign.city||""}, ${campaign.state||"SP"}, Brasil`,languageCode:"pt-BR",regionCode:"BR",pageSize:1}),
  });
  const payload=await response.json();
  if(!response.ok||!payload?.places?.[0]?.location) throw new Error("Não foi possível localizar o centro da cidade da campanha no Google Places.");
  const location=payload.places[0].location;
  await admin.from("campaigns").update({center_latitude:location.latitude,center_longitude:location.longitude}).eq("id",campaign.id).eq("organization_id",campaign.organization_id).is("deleted_at",null);
  return {latitude:Number(location.latitude),longitude:Number(location.longitude),pro};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);

  let admin:any=null;
  let captureRunId:string|null=null;

  try{
    const authHeader=req.headers.get("Authorization");
    if(!authHeader?.startsWith("Bearer ")) return json({error:"Unauthorized"},401);
    const token=authHeader.replace("Bearer ","");
    const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
    const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleApiKey=Deno.env.get("GOOGLE_PLACES_API_KEY");
    if(!googleApiKey) throw new Error("GOOGLE_PLACES_API_KEY secret not configured");
    admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});

    const {data:authData,error:authError}=await admin.auth.getUser(token);
    const user=authData?.user;
    if(authError||!user) return json({error:"Invalid session"},401);

    const body=await req.json();
    const campaignId=body?.campaign_id;
    if(!campaignId) return json({error:"campaign_id is required"},400);

    const {data:profile}=await admin.from("profiles").select("account_status,deleted_at").eq("id",user.id).maybeSingle();
    if(profile?.account_status!=="active"||profile?.deleted_at) return json({error:"Account inactive or suspended"},403);

    const {data:campaign,error:campaignError}=await admin.from("campaigns")
      .select("id,organization_id,name,city,state,radius_km,center_latitude,center_longitude,target_segment_id,search_term_cursor")
      .eq("id",campaignId).is("deleted_at",null).single();
    if(campaignError||!campaign) return json({error:"Campaign not found"},404);

    const [{data:membership},{data:organization},{data:orgSettings},{data:systemAdmin}] = await Promise.all([
      admin.from("organization_members").select("organization_id,is_active,role,deleted_at").eq("organization_id",campaign.organization_id).eq("user_id",user.id).maybeSingle(),
      admin.from("organizations").select("id,is_active,deleted_at,is_sandbox").eq("id",campaign.organization_id).maybeSingle(),
      admin.from("organization_settings").select("google_places_leads_per_capture").eq("organization_id",campaign.organization_id).maybeSingle(),
      admin.from("system_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
    ]);

    if(!organization?.is_active||organization?.deleted_at) return json({error:"Forbidden"},403);

    const isOrganizationAdmin = Boolean(
      membership?.is_active &&
      !membership?.deleted_at &&
      ["admin","owner"].includes(String(membership?.role||""))
    );
    const isSandboxSystemAdmin = Boolean(systemAdmin && organization?.is_sandbox === true);

    if(!isOrganizationAdmin && !isSandboxSystemAdmin) {
      return json({error:"A captação de leads é permitida somente para administradores da empresa."},403);
    }

    if(!campaign.target_segment_id) return json({error:"A campanha precisa estar vinculada a um público-alvo."},400);
    const {data:targetSegment,error:segmentError}=await admin.from("target_segments").select("id,name,is_active,deleted_at")
      .eq("id",campaign.target_segment_id).eq("organization_id",campaign.organization_id).is("deleted_at",null).single();
    if(segmentError||!targetSegment||!targetSegment.is_active) return json({error:"Público-alvo inválido ou inativo."},400);

    const {data:searchTerms,error:termsError}=await admin.from("target_segment_search_terms").select("id,term,priority")
      .eq("target_segment_id",targetSegment.id).eq("is_active",true).order("priority",{ascending:true}).order("created_at",{ascending:true});
    if(termsError||!searchTerms?.length) return json({error:"Esse público-alvo não possui termos de busca ativos."},400);

    const {data:captureRows,error:captureError}=await admin.rpc("reserve_lead_capture_slot",{
      p_organization_id:campaign.organization_id,
      p_user_id:user.id,
      p_campaign_id:campaign.id,
    });
    if(captureError) throw captureError;
    const capture=captureRows?.[0];
    if(!capture?.allowed){
      return json({
        error:"Limite semanal de captações atingido.",
        capture_usage:Number(capture?.usage||0),
        capture_limit:capture?.weekly_limit,
        week_start:capture?.week_start,
      },429);
    }
    captureRunId=capture.run_id;

    const cursor=Number(campaign.search_term_cursor||0);
    const startTermIndex=((cursor%searchTerms.length)+searchTerms.length)%searchTerms.length;
    const center=await resolveCampaignCenter(admin,campaign,googleApiKey);
    const radiusKm=Math.max(1,Math.min(Number(campaign.radius_km||30),50));
    const leadsPerCapture=Math.max(1,Math.trunc(Number(orgSettings?.google_places_leads_per_capture||40)));

    const fieldMask=["places.id","places.displayName","places.formattedAddress","places.location","places.nationalPhoneNumber","places.websiteUri","places.rating","places.userRatingCount","places.primaryType","places.businessStatus","nextPageToken"].join(",");
    const placesById=new Map<string,any>();
    const queriesUsed:string[]=[];
    let pagesUsed=0;
    let termsUsed=0;
    let quotaStopped=false;
    let enterpriseUsage=0;
    let enterpriseQuota=0;
    let pageErrorStatus:number|null=null;

    for(let offset=0; offset<searchTerms.length && placesById.size<leadsPerCapture; offset++){
      const termIndex=(startTermIndex+offset)%searchTerms.length;
      const selectedTerm=searchTerms[termIndex];
      queriesUsed.push(selectedTerm.term);
      termsUsed++;
      let nextPageToken:string|null=null;

      for(let page=0; page<3 && placesById.size<leadsPerCapture; page++){
        try{
          const enterprise=await reserveQuota(admin,campaign.organization_id,"enterprise");
          enterpriseUsage=enterprise.usage;
          enterpriseQuota=enterprise.quota;
        }catch(error:any){
          if(pagesUsed>0 && Number(error?.status||0)===429){
            quotaStopped=true;
            break;
          }
          throw error;
        }

        const pageSize=Math.min(20,leadsPerCapture-placesById.size);
        const requestBody:any={
          textQuery:selectedTerm.term,
          languageCode:"pt-BR",
          regionCode:"BR",
          pageSize,
          locationBias:{circle:{center:{latitude:center.latitude,longitude:center.longitude},radius:radiusKm*1000}}
        };
        if(nextPageToken) requestBody.pageToken=nextPageToken;

        const googleResponse=await fetch("https://places.googleapis.com/v1/places:searchText",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "X-Goog-Api-Key":googleApiKey,
            "X-Goog-FieldMask":fieldMask,
          },
          body:JSON.stringify(requestBody),
        });
        const googlePayload=await googleResponse.json();

        if(!googleResponse.ok){
          if(pagesUsed===0){
            await admin.rpc("finish_lead_capture_run",{p_run_id:captureRunId,p_success:false,p_result:{google_status:googleResponse.status}});
            captureRunId=null;
            return json({error:"Google Places request failed",google_status:googleResponse.status,details:googlePayload},502);
          }
          pageErrorStatus=googleResponse.status;
          break;
        }

        pagesUsed++;
        for(const place of Array.isArray(googlePayload.places)?googlePayload.places:[]){
          if(place?.id && !placesById.has(place.id)) {
            placesById.set(place.id,{...place,_axivaSearchTerm:selectedTerm.term});
          }
          if(placesById.size>=leadsPerCapture) break;
        }

        nextPageToken=googlePayload?.nextPageToken||null;
        if(!nextPageToken) break;
      }

      if(quotaStopped) break;
    }

    const nextCursor=(startTermIndex+Math.max(termsUsed,1))%searchTerms.length;
    await admin.from("campaigns").update({search_term_cursor:nextCursor}).eq("id",campaign.id).eq("organization_id",campaign.organization_id).is("deleted_at",null);

    const places=Array.from(placesById.values()).slice(0,leadsPerCapture);
    const placeIds=places.map((p:any)=>p.id).filter(Boolean);
    let existingIds=new Set<string>();
    if(placeIds.length){
      const {data:existing}=await admin.from("leads").select("google_place_id").eq("organization_id",campaign.organization_id).is("deleted_at",null).in("google_place_id",placeIds);
      existingIds=new Set((existing||[]).map((x:any)=>x.google_place_id));
    }

    const candidates:any[]=[];
    let duplicates=0,outsideRadius=0,nonOperational=0,missingLocation=0;
    for(const place of places){
      if(!place?.id) continue;
      if(existingIds.has(place.id)){duplicates++;continue;}
      if(place.businessStatus&&place.businessStatus!=="OPERATIONAL"){nonOperational++;continue;}
      const lat=Number(place.location?.latitude),lon=Number(place.location?.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lon)){missingLocation++;continue;}
      const distanceKm=haversineKm(center.latitude,center.longitude,lat,lon);
      if(distanceKm>radiusKm){outsideRadius++;continue;}
      candidates.push({
        organization_id:campaign.organization_id,campaign_id:campaign.id,target_segment_id:targetSegment.id,
        business_name:place.displayName?.text||"Empresa sem nome",segment:targetSegment.name,
        phone:place.nationalPhoneNumber||null,website:place.websiteUri||null,address:place.formattedAddress||null,
        city:campaign.city||null,state:campaign.state||null,latitude:lat,longitude:lon,google_place_id:place.id,
        google_rating:place.rating??null,google_review_count:place.userRatingCount??null,score:null,
        score_reason:{distance_km:Number(distanceKm.toFixed(1)),primary_type:place.primaryType||"",search_term:place._axivaSearchTerm||""},
        status:"captured_pending",source:"google_places",captured_by:user.id,
      });
    }

    let inserted=0;
    if(candidates.length){
      const {data:insertedRows,error:insertError}=await admin.from("leads").insert(candidates).select("id");
      if(insertError) throw insertError;
      inserted=insertedRows?.length||0;
    }

    const captureResult={
      requested_limit:leadsPerCapture,
      pages_used:pagesUsed,
      terms_used:termsUsed,
      queries:queriesUsed,
      found:places.length,
      inserted,
      duplicates,
      outside_radius:outsideRadius,
      non_operational:nonOperational,
      missing_location:missingLocation,
      quota_stopped:quotaStopped,
      page_error_status:pageErrorStatus
    };
    await admin.rpc("finish_lead_capture_run",{p_run_id:captureRunId,p_success:true,p_result:captureResult});
    captureRunId=null;

    return json({
      ok:true,
      campaign:campaign.name,
      target_segment:targetSegment.name,
      queries:queriesUsed,
      terms_used:termsUsed,
      search_terms_total:searchTerms.length,
      center:{latitude:center.latitude,longitude:center.longitude},
      radius_km:radiusKm,
      requested_limit:leadsPerCapture,
      pages_used:pagesUsed,
      found:places.length,
      inserted,
      duplicates,
      outside_radius:outsideRadius,
      non_operational:nonOperational,
      missing_location:missingLocation,
      quota_stopped:quotaStopped,
      page_error_status:pageErrorStatus,
      usage:enterpriseUsage,
      quota:enterpriseQuota,
      remaining:Math.max(enterpriseQuota-enterpriseUsage,0),
      pro_usage:center.pro?.usage??null,
      pro_quota:center.pro?.quota??null,
      capture_usage:Number(capture?.usage||0),
      capture_limit:capture?.weekly_limit,
      week_start:capture?.week_start
    });
  }catch(error:any){
    if(admin&&captureRunId){
      try{await admin.rpc("finish_lead_capture_run",{p_run_id:captureRunId,p_success:false,p_result:{error:error instanceof Error?error.message:String(error)}});}catch(_){ }
    }
    const status=Number(error?.status||500);
    return json({error:error instanceof Error?error.message:String(error),usage:error?.usage,quota:error?.quota},status);
  }
});