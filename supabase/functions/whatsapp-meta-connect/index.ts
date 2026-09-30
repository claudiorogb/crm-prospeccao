import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});
const digits=(v:unknown)=>String(v||"").replace(/\D/g,"");
const normalizePhone=(v:unknown)=>{const d=digits(v);if(d.startsWith("55")&&d.length>=12)return d;if(d.length===10||d.length===11)return `55${d}`;return d};
async function graphJson(response:Response){const raw=await response.text();let data:any={};try{data=raw?JSON.parse(raw):{}}catch{data={raw}}if(!response.ok){throw new Error(String(data?.error?.message||data?.message||raw||`HTTP ${response.status}`))}return data}
async function membership(admin:any,userId:string,organizationId:string,adminOnly=false){const {data}=await admin.from("organization_members").select("role,is_active,deleted_at").eq("organization_id",organizationId).eq("user_id",userId).eq("is_active",true).is("deleted_at",null).maybeSingle();if(!data)return null;if(adminOnly&&!["owner","admin"].includes(String(data.role)))return null;return data}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const supabaseUrl=Deno.env.get("SUPABASE_URL"),serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl||!serviceRole)return json({error:"Server not configured"},503);
  const auth=req.headers.get("Authorization")||"";if(!auth.startsWith("Bearer "))return json({error:"Unauthorized"},401);
  const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await admin.auth.getUser(auth.slice(7));const user=userData?.user;
  if(userError||!user)return json({error:"Unauthorized"},401);
  let body:any={};try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
  const action=String(body?.action||""),organizationId=String(body?.organization_id||"");
  if(!action||!organizationId)return json({error:"action and organization_id are required"},400);
  const appId=Deno.env.get("META_APP_ID")||"",appSecret=Deno.env.get("META_APP_SECRET")||"",configId=Deno.env.get("META_EMBEDDED_SIGNUP_CONFIG_ID")||"",graphVersion=Deno.env.get("META_GRAPH_API_VERSION")||"";
  if(action==="config"){
    if(!(await membership(admin,user.id,organizationId,false)))return json({error:"Forbidden"},403);
    return json({ok:true,configured:Boolean(appId&&appSecret&&configId&&graphVersion),app_id:appId||null,config_id:configId||null,graph_version:graphVersion||null});
  }
  if(!(await membership(admin,user.id,organizationId,true)))return json({error:"Apenas proprietário ou administrador pode conectar o WhatsApp oficial."},403);
  if(!appId||!appSecret||!configId||!graphVersion)return json({error:"A integração oficial da Meta ainda não foi configurada no servidor."},503);
  if(action==="complete_signup"){
    const code=String(body?.code||""),wabaId=String(body?.waba_id||""),phoneNumberId=String(body?.phone_number_id||"");
    if(!code||!wabaId||!phoneNumberId)return json({error:"code, waba_id and phone_number_id are required"},400);
    try{
      const tokenUrl=new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);tokenUrl.searchParams.set("client_id",appId);tokenUrl.searchParams.set("client_secret",appSecret);tokenUrl.searchParams.set("code",code);
      const tokenData=await graphJson(await fetch(tokenUrl.toString()));const accessToken=String(tokenData?.access_token||"");if(!accessToken)throw new Error("A Meta não retornou uma credencial de acesso.");
      const phonesUrl=new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/phone_numbers`);phonesUrl.searchParams.set("fields","id,display_phone_number,verified_name,status,quality_rating");
      const phonesData=await graphJson(await fetch(phonesUrl.toString(),{headers:{Authorization:`Bearer ${accessToken}`}}));
      const phoneInfo=(phonesData?.data||[]).find((x:any)=>String(x?.id)===phoneNumberId);if(!phoneInfo)throw new Error("O número informado não pertence à conta WhatsApp autorizada.");
      await graphJson(await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`,{method:"POST",headers:{Authorization:`Bearer ${accessToken}`}}));
      const phone=normalizePhone(phoneInfo?.display_phone_number);if(!phone)throw new Error("Não foi possível identificar o telefone autorizado.");
      const {data:existing}=await admin.from("whatsapp_numbers").select("id,is_default").eq("organization_id",organizationId).eq("provider","meta").eq("provider_phone_number_id",phoneNumberId).is("deleted_at",null).maybeSingle();
      let numberRow:any=existing||null;const now=new Date().toISOString();
      if(numberRow){
        const {data,error}=await admin.from("whatsapp_numbers").update({alias:String(phoneInfo?.verified_name||"WhatsApp Oficial"),phone_e164:phone,provider:"meta",provider_phone_number_id:phoneNumberId,provider_business_account_id:wabaId,connection_status:"connected",is_active:true,last_connection_test_at:now,last_connection_test_ok:true,updated_at:now}).eq("id",numberRow.id).eq("organization_id",organizationId).select("id,alias,phone_e164,is_default").single();if(error)throw error;numberRow=data;
      }else{
        const {count}=await admin.from("whatsapp_numbers").select("id",{count:"exact",head:true}).eq("organization_id",organizationId).is("deleted_at",null);
        const {data,error}=await admin.from("whatsapp_numbers").insert({organization_id:organizationId,alias:String(phoneInfo?.verified_name||"WhatsApp Oficial"),phone_e164:phone,is_default:Number(count||0)===0,is_active:true,connection_status:"connected",provider:"meta",provider_phone_number_id:phoneNumberId,provider_business_account_id:wabaId,credential_configured:false,last_connection_test_at:now,last_connection_test_ok:true,created_by:user.id}).select("id,alias,phone_e164,is_default").single();if(error)throw error;numberRow=data;
      }
      const {error:secretError}=await admin.rpc("store_whatsapp_provider_secret",{p_number_id:numberRow.id,p_secret:accessToken});if(secretError)throw new Error("Não foi possível armazenar a credencial da Meta com segurança.");
      await admin.from("audit_logs").insert({organization_id:organizationId,actor_user_id:user.id,action:"whatsapp_meta_connected",entity_type:"whatsapp_number",entity_id:numberRow.id,metadata:{provider:"meta",waba_id:wabaId,phone_number_id:phoneNumberId}});
      return json({ok:true,number:{id:numberRow.id,alias:numberRow.alias,phone_e164:numberRow.phone_e164,provider:"meta",connection_status:"connected"}});
    }catch(error){return json({error:error instanceof Error?error.message:String(error)},502)}
  }
  if(action==="test_connection"){
    const numberId=String(body?.number_id||"");if(!numberId)return json({error:"number_id is required"},400);
    const {data:n}=await admin.from("whatsapp_numbers").select("id,provider_phone_number_id,credential_configured").eq("id",numberId).eq("organization_id",organizationId).eq("provider","meta").is("deleted_at",null).maybeSingle();
    if(!n?.provider_phone_number_id||!n.credential_configured)return json({error:"Conexão oficial incompleta."},409);
    const {data:secret}=await admin.rpc("read_whatsapp_provider_secret",{p_number_id:numberId});if(!secret)return json({error:"Credencial da Meta indisponível."},409);
    try{const url=new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(n.provider_phone_number_id)}`);url.searchParams.set("fields","id,display_phone_number,verified_name,quality_rating");const info=await graphJson(await fetch(url.toString(),{headers:{Authorization:`Bearer ${secret}`}}));await admin.from("whatsapp_numbers").update({connection_status:"connected",last_connection_test_at:new Date().toISOString(),last_connection_test_ok:true,updated_at:new Date().toISOString()}).eq("id",numberId).eq("organization_id",organizationId);return json({ok:true,info:{id:info?.id||null,display_phone_number:info?.display_phone_number||null,verified_name:info?.verified_name||null,quality_rating:info?.quality_rating||null}})}catch(error){await admin.from("whatsapp_numbers").update({connection_status:"error",last_connection_test_at:new Date().toISOString(),last_connection_test_ok:false,updated_at:new Date().toISOString()}).eq("id",numberId).eq("organization_id",organizationId);return json({error:error instanceof Error?error.message:String(error)},502)}
  }
  return json({error:"Unsupported action"},400);
});