import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}})}
async function processorSecret(){const {data,error}=await admin.rpc("email_get_processor_secret");if(error)throw error;return String(data||"")}
async function googleCredentials(){const {data,error}=await admin.rpc("email_get_google_platform_credentials");if(error)throw error;const r=data?.[0]||{};return {clientId:r.client_id||"",clientSecret:r.client_secret||""}}
async function getCreds(orgId:string){const {data,error}=await admin.rpc("email_get_connection_credentials",{p_organization_id:orgId});if(error)throw error;return data?.[0]||null}
async function refreshCredentials(orgId:string,creds:any){
 const g=await googleCredentials();if(!g.clientId||!g.clientSecret)throw new Error("Configuração Gmail ausente.");
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:g.clientId,client_secret:g.clientSecret,refresh_token:creds.refresh_token,grant_type:"refresh_token"})});
 const d=await r.json();if(!r.ok)throw new Error(d?.error_description||d?.error||"Falha ao renovar Gmail");
 const expires=new Date(Date.now()+Number(d.expires_in||3600)*1000).toISOString();
 const {data:meta}=await admin.from("email_connections").select("provider_account_id,connected_by").eq("organization_id",orgId).maybeSingle();
 const {error}=await admin.rpc("email_store_connection_tokens",{p_organization_id:orgId,p_provider:"gmail",p_email_address:creds.email_address,p_sender_email:creds.sender_email,p_sender_name:creds.sender_name,p_access_token:d.access_token,p_refresh_token:creds.refresh_token,p_expires_at:expires,p_provider_account_id:meta?.provider_account_id||null,p_connected_by:meta?.connected_by||null});
 if(error)throw error;return {...creds,access_token:d.access_token,access_expires_at:expires};
}
async function usableCreds(orgId:string){let c=await getCreds(orgId);if(!c||c.provider!=="gmail")throw new Error("Gmail não conectado.");const exp=c.access_expires_at?new Date(c.access_expires_at).getTime():0;if(!c.access_token||exp<Date.now()+60000)c=await refreshCredentials(orgId,c);return c}
async function threadHasReply(creds:any,threadId:string,email:string){
 const q=new URLSearchParams({format:"metadata"});q.append("metadataHeaders","From");
 const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?${q}`,{headers:{Authorization:`Bearer ${creds.access_token}`}});
 if(r.status===404)return false;if(!r.ok)throw new Error(r.status===403?"Gmail sem permissão de leitura. Autorize a prospecção novamente.":`Falha ao consultar conversa no Gmail (${r.status}).`);
 const d=await r.json();const target=String(email||"").trim().toLowerCase();
 return (d?.messages||[]).some((m:any)=>{const from=(m?.payload?.headers||[]).find((h:any)=>String(h.name).toLowerCase()==="from")?.value||"";return String(from).toLowerCase().includes(target)});
}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const expected=await processorSecret();if(!expected||req.headers.get("X-Processor-Secret")!==expected)return json({error:"Unauthorized"},401);
  const {data:rows,error}=await admin.from("email_campaign_recipients")
    .select("id,organization_id,recipient_email,gmail_thread_id,sequence_step,status,email_campaigns!inner(provider)")
    .eq("recipient_source","crm_prospecting")
    .eq("status","queued")
    .eq("email_campaigns.provider","gmail")
    .is("replied_at",null)
    .not("gmail_thread_id","is",null)
    .gt("sequence_step",1)
    .order("updated_at",{ascending:true}).limit(50);
  if(error)throw error;
  let checked=0,replied=0,errors=0;const cache=new Map<string,any>();
  for(const row of rows||[]){
   try{
    let creds=cache.get(row.organization_id);if(!creds){creds=await usableCreds(row.organization_id);cache.set(row.organization_id,creds);}
    checked++;
    if(await threadHasReply(creds,row.gmail_thread_id,row.recipient_email)){await admin.rpc("email_mark_prospecting_reply",{p_recipient_id:row.id});replied++;}
   }catch{errors++;}
  }
  return json({ok:true,checked,replied,errors});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});