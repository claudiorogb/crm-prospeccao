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
  try{
    const authHeader=req.headers.get("Authorization");
    if(!authHeader?.startsWith("Bearer ")) return json({error:"Unauthorized"},401);
    const token=authHeader.replace("Bearer ","");
    const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
    const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleApiKey=Deno.env.get("GOOGLE_PLACES_API_KEY");
    if(!googleApiKey) throw new Error("GOOGLE_PLACES_API_KEY secret not configured");
    const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});

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

    const [{data:membership},{data:organization}] = await Promise.all([
      admin.from("organization_members").select("organization_id,is_active,role,deleted_at").eq("organization_id",campaign.organization_id).eq("user_id",user.id).maybeSingle(),
      admin.from("organizations").select("id,is_active,deleted_at").eq("id",campaign.organization_id).maybeSingle(),
    ]);
    if(!membership?.is_active||membership?.deleted_at||!organization?.is_active||organization?.deleted_at) return json({error:"Forbidden"},403);

    if(!campaign.target_segment_id) return json({error:"A campanha precisa estar vinculada a um público-alvo."},400);
    const {data:targetSegment,error:segmentError}=await admin.from("target_segments").select("id,name,is_active,deleted_at")
      .eq("id",campaign.target_segment_id).eq("organization_id",campaign.organization_id).is("deleted_at",null).single();
    if(segmentError||!targetSegment||!targetSegment.is_active) return json({error:"Público-alvo inválido ou inativo."},400);

    const {data:searchTerms,error:termsError}=await admin.from("target_segment_search_terms").select("id,term,priority")
      .eq("target_segment_id",targetSegment.id).eq("is_active",true).order("priority",{ascending:true}).order("created_at",{ascending:true});
    if(termsError||!searchTerms?.length) return json({error:"Esse público-alvo não possui termos de busca ativos."},400);

    const cursor=Number(campaign.search_term_cursor||0);
    const termIndex=((cursor%searchTerms.length)+searchTerms.length)%searchTerms.length;
    const selectedTerm=searchTerms[termIndex];
    const center=await resolveCampaignCenter(admin,campaign,googleApiKey);
    const enterprise=await reserveQuota(admin,campaign.organization_id,"enterprise");
    const radiusKm=Math.max(1,Math.min(Number(campaign.radius_km||30),50));

    const googleResponse=await fetch("https://places.googleapis.com/v1/places:searchText",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "X-Goog-Api-Key":googleApiKey,
        "X-Goog-FieldMask":["places.id","places.displayName","places.formattedAddress","places.location","places.nationalPhoneNumber","places.websiteUri","places.rating","places.userRatingCount","places.primaryType","places.businessStatus"].join(","),
      },
      body:JSON.stringify({textQuery:selectedTerm.term,languageCode:"pt-BR",regionCode:"BR",pageSize:20,locationBias:{circle:{center:{latitude:center.latitude,longitude:center.longitude},radius:radiusKm*1000}}}),
    });
    const googlePayload=await googleResponse.json();
    if(!googleResponse.ok) return json({error:"Google Places request failed",google_status:googleResponse.status,details:googlePayload},502);

    const nextCursor=(termIndex+1)%searchTerms.length;
    await admin.from("campaigns").update({search_term_cursor:nextCursor}).eq("id",campaign.id).eq("organization_id",campaign.organization_id).is("deleted_at",null);

    const places=Array.isArray(googlePayload.places)?googlePayload.places:[];
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
        score_reason:{distance_km:Number(distanceKm.toFixed(1)),primary_type:place.primaryType||"",search_term:selectedTerm.term},
        status:"new",source:"google_places",captured_by:user.id,
      });
    }

    let inserted=0;
    if(candidates.length){
      const {data:insertedRows,error:insertError}=await admin.from("leads").insert(candidates).select("id");
      if(insertError) throw insertError;
      inserted=insertedRows?.length||0;
    }

    return json({ok:true,campaign:campaign.name,target_segment:targetSegment.name,query:selectedTerm.term,search_term_index:termIndex+1,search_terms_total:searchTerms.length,
      center:{latitude:center.latitude,longitude:center.longitude},radius_km:radiusKm,found:places.length,inserted,duplicates,outside_radius:outsideRadius,non_operational:nonOperational,missing_location:missingLocation,
      usage:enterprise.usage,quota:enterprise.quota,remaining:Math.max(enterprise.quota-enterprise.usage,0),pro_usage:center.pro?.usage??null,pro_quota:center.pro?.quota??null});
  }catch(error:any){
    const status=Number(error?.status||500);
    return json({error:error instanceof Error?error.message:String(error),usage:error?.usage,quota:error?.quota},status);
  }
});