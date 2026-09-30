import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const EVOLUTION_URL="https://evolution-api-production-f25e4.up.railway.app";
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}})}
function slugify(value:string){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")}
function publicProvider(data:any){const qr=data?.qrcode;return {qrcode:qr?{base64:qr.base64??null,code:qr.code??null}:undefined,base64:data?.base64??undefined,instance:data?.instance?{state:data.instance.state??undefined,status:data.instance.status??undefined}:undefined}}
async function evolution(path:string,options:RequestInit={}){
  const key=Deno.env.get("EVOLUTION_API_KEY");
  if(!key) throw new Error("EVOLUTION_API_KEY não configurada no Supabase");
  const response=await fetch(`${EVOLUTION_URL}${path}`,{...options,headers:{"Content-Type":"application/json",apikey:key,...(options.headers||{})}});
  const text=await response.text();let data:any={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!response.ok){const detail=data?.response?.message||data?.message||data?.error||`HTTP ${response.status}`;throw new Error(Array.isArray(detail)?detail.join(" • "):String(detail))}
  return data;
}
const INBOUND_WEBHOOK_URL="https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/whatsapp-inbound-webhook?token=pJVRbLZllIz2WSSdWtrJV-GVstV33ld7Xix5Mc2PIos";
async function ensureInboundWebhook(instanceName:string){
  await evolution(`/webhook/set/${encodeURIComponent(instanceName)}`,{
    method:"POST",
    body:JSON.stringify({
      webhook:{
        enabled:true,
        url:INBOUND_WEBHOOK_URL,
        webhookByEvents:false,
        webhookBase64:false,
        events:["MESSAGES_UPSERT","MESSAGES_UPDATE","CONTACTS_UPSERT","CONTACTS_UPDATE","CONNECTION_UPDATE"]
      }
    })
  });
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const authHeader=req.headers.get("Authorization");
    if(!authHeader?.startsWith("Bearer "))return json({error:"Unauthorized"},401);
    const token=authHeader.replace("Bearer ","");
    const supabaseUrl=Deno.env.get("SUPABASE_URL")!,serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:authData,error:authError}=await admin.auth.getUser(token);const user=authData?.user;
    if(authError||!user)return json({error:"Invalid session"},401);
    const body=await req.json();const organizationId=String(body?.organization_id||""),action=String(body?.action||"");
    if(!organizationId||!action)return json({error:"organization_id and action are required"},400);
    const [{data:profile},{data:sysAdmin},{data:membership},{data:org}]=await Promise.all([
      admin.from("profiles").select("account_status,deleted_at").eq("id",user.id).maybeSingle(),
      admin.from("system_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
      admin.from("organization_members").select("organization_id,is_active,role,deleted_at").eq("organization_id",organizationId).eq("user_id",user.id).eq("is_active",true).is("deleted_at",null).maybeSingle(),
      admin.from("organizations").select("id,name,is_active,deleted_at").eq("id",organizationId).maybeSingle(),
    ]);
    if(profile?.account_status!=="active"||profile?.deleted_at||!org?.is_active||org?.deleted_at||(!sysAdmin&&!membership))return json({error:"Forbidden"},403);
    const canManage=Boolean(sysAdmin||membership?.role==="admin"||membership?.role==="owner");
    if(!canManage)return json({error:"Somente administradores podem gerenciar a conexão WhatsApp."},403);
    const numberId=body?.number_id?String(body.number_id):null;let number:any=null;
    if(numberId){const {data}=await admin.from("whatsapp_numbers").select("*").eq("id",numberId).eq("organization_id",organizationId).is("deleted_at",null).maybeSingle();number=data;if(!number)return json({error:"WhatsApp number not found"},404)}
    if(action==="create_instance"){
      if(!number)return json({error:"number_id is required"},400);
      const suffix=String(number.id).slice(0,8),instanceName=`${slugify(org.name||"cliente")}-${slugify(number.alias||"whatsapp")}-${suffix}`.slice(0,60);
      const created=await evolution("/instance/create",{method:"POST",body:JSON.stringify({instanceName,integration:"WHATSAPP-BAILEYS",qrcode:true,number:number.phone_e164})});
      const instanceId=created?.instance?.instanceId||null,state=created?.instance?.status||created?.instance?.state||"connecting";
      await admin.from("whatsapp_numbers").update({provider:"evolution",evolution_instance_name:instanceName,evolution_instance_id:instanceId,connection_status:state==="open"?"connected":"waiting_qr",credential_configured:true,evolution_connected_at:state==="open"?new Date().toISOString():null,evolution_last_sync_at:new Date().toISOString()}).eq("id",number.id).eq("organization_id",organizationId);
      await ensureInboundWebhook(instanceName);
      let responseData=created;const hasQr=created?.qrcode?.base64||created?.base64||created?.qrcode?.code;
      if(!hasQr&&state!=="open"){await new Promise(r=>setTimeout(r,800));responseData=await evolution(`/instance/connect/${encodeURIComponent(instanceName)}`)}
      return json({ok:true,instance_name:instanceName,instance_id:instanceId,state,provider:publicProvider(responseData)});
    }
    if(action==="connect_instance"){
      if(!number?.evolution_instance_name)return json({error:"Instância Evolution não configurada"},409);
      await ensureInboundWebhook(number.evolution_instance_name);
      const data=await evolution(`/instance/connect/${encodeURIComponent(number.evolution_instance_name)}`),state=data?.instance?.state||data?.instance?.status||"connecting";
      if(state==="open"){const now=new Date().toISOString();await admin.from("whatsapp_numbers").update({connection_status:"connected",evolution_connected_at:number.evolution_connected_at||now,evolution_last_sync_at:now,credential_configured:true}).eq("id",number.id).eq("organization_id",organizationId)}
      return json({ok:true,state,provider:publicProvider(data)});
    }
    if(action==="connection_state"){
      if(!number?.evolution_instance_name)return json({error:"Instância Evolution não configurada"},409);
      await ensureInboundWebhook(number.evolution_instance_name);
      const data=await evolution(`/instance/connectionState/${encodeURIComponent(number.evolution_instance_name)}`),state=data?.instance?.state||data?.instance?.status||"unknown",connected=state==="open",now=new Date().toISOString();
      await admin.from("whatsapp_numbers").update({connection_status:connected?"connected":state,evolution_connected_at:connected?(number.evolution_connected_at||now):number.evolution_connected_at,evolution_last_sync_at:now,credential_configured:true}).eq("id",number.id).eq("organization_id",organizationId);
      return json({ok:true,state,provider:publicProvider(data)});
    }
    if(action==="delete_instance"){
      if(number?.evolution_instance_name)await evolution(`/instance/delete/${encodeURIComponent(number.evolution_instance_name)}`,{method:"DELETE"});
      return json({ok:true});
    }
    if(action==="send_message")return json({error:"Envio automático processado pelo worker do backend.",backend_worker:true},409);
    return json({error:"Unknown action"},400);
  }catch(error){return json({error:error instanceof Error?error.message:String(error)},500)}
});