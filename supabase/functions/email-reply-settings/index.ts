import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_ADMIN_KEY=Deno.env.get("AXIVA_RESEND_INBOUND_API_KEY")||"";
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}})}
async function userFromRequest(req:Request){const h=req.headers.get("Authorization")||"";if(!h.startsWith("Bearer "))return null;const {data,error}=await admin.auth.getUser(h.slice(7));return error?null:data.user}
async function orgAdmin(userId:string,organizationId:string){
  const [{data:m},{data:o},{data:p}]=await Promise.all([
    admin.from("organization_members").select("role,is_active,deleted_at").eq("organization_id",organizationId).eq("user_id",userId).maybeSingle(),
    admin.from("organizations").select("is_active,deleted_at").eq("id",organizationId).maybeSingle(),
    admin.from("profiles").select("account_status,deleted_at").eq("id",userId).maybeSingle(),
  ]);
  return Boolean(o?.is_active&&!o?.deleted_at&&p?.account_status==="active"&&!p?.deleted_at&&m?.is_active&&!m?.deleted_at&&["admin","owner"].includes(String(m?.role||"")));
}
function cleanDomain(value:unknown){
  return String(value||"").trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/$/,"");
}
function validDomain(value:string){
  return value.length<=253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
}
function validLocal(value:string){return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/i.test(value)}
async function resendRequest(path:string,init:RequestInit={}){
  if(!RESEND_ADMIN_KEY)throw new Error("Configuração central de respostas não disponível.");
  const headers={Authorization:`Bearer ${RESEND_ADMIN_KEY}`,"Content-Type":"application/json",...(init.headers||{})};
  const r=await fetch(`https://api.resend.com${path}`,{...init,headers});
  let data:any={};try{data=await r.json()}catch{}
  if(!r.ok)throw new Error(data?.message||data?.error||`Resend HTTP ${r.status}`);
  return data;
}
async function platformReply(){
  const {data}=await admin.from("email_platform_config").select("generic_reply_address,generic_reply_status").eq("singleton",true).maybeSingle();
  const address=String(data?.generic_reply_address||"").trim().toLowerCase();
  return {address,ready:Boolean(address&&data?.generic_reply_status==="verified")};
}
async function connection(org:string){
  const {data,error}=await admin.from("email_connections")
    .select("organization_id,provider,email_address,sender_email,sender_name,status,reply_mode,custom_reply_domain,custom_reply_email,custom_reply_domain_id,custom_reply_status,custom_reply_dns,resend_full_access")
    .eq("organization_id",org).maybeSingle();
  if(error)throw error;return data;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const user=await userFromRequest(req);if(!user)return json({error:"Sessão inválida"},401);
  let body:any={};try{body=await req.json()}catch{}
  const org=String(body?.organization_id||"");if(!org)return json({error:"organization_id é obrigatório"},400);
  if(!await orgAdmin(user.id,org))return json({error:"Somente administradores da empresa podem alterar a configuração de respostas."},403);
  const action=String(body?.action||"get");
  try{
    if(action==="get"){
      const [c,p]=await Promise.all([connection(org),platformReply()]);
      return json({connection:c,system_reply_ready:p.ready,system_reply_address:p.ready?p.address:null});
    }
    if(action==="set_mode"){
      const mode=String(body?.mode||"");
      if(!["system","custom"].includes(mode))return json({error:"Modo de resposta inválido."},400);
      const c=await connection(org);
      if(mode==="custom"&&c?.custom_reply_status!=="verified")return json({error:"Verifique o DNS do endereço personalizado antes de ativá-lo."},409);
      const {error}=await admin.from("email_connections").update({reply_mode:mode,updated_at:new Date().toISOString()}).eq("organization_id",org);
      if(error)throw error;
      return json({ok:true,reply_mode:mode});
    }
    if(action==="start_custom_domain"){
      const c=await connection(org);
      if(c?.provider!=="resend")return json({error:"A resposta personalizada é necessária apenas para E-mail corporativo. No Gmail, a resposta volta para a própria conta conectada."},400);
      const domain=cleanDomain(body?.domain);
      const local=String(body?.local_part||"resposta").trim().toLowerCase();
      if(!validDomain(domain)||!validLocal(local))return json({error:"Informe um domínio e um endereço de resposta válidos."},400);
      if(c?.custom_reply_domain_id&&c?.custom_reply_domain!==domain)return json({error:"Já existe um domínio personalizado em configuração. Conclua essa configuração antes de cadastrar outro."},409);
      let d:any;
      if(c?.custom_reply_domain_id){
        d=await resendRequest(`/domains/${encodeURIComponent(c.custom_reply_domain_id)}`);
      }else{
        d=await resendRequest("/domains",{method:"POST",body:JSON.stringify({name:domain,region:"sa-east-1",capabilities:{sending:"disabled",receiving:"enabled"}})});
      }
      const domainId=String(d?.id||c?.custom_reply_domain_id||"");
      if(!domainId)throw new Error("O provedor não retornou o identificador do domínio.");
      const records=Array.isArray(d?.records)?d.records:[];
      const status=String(d?.status||"pending");
      const replyEmail=`${local}@${domain}`;
      const {error}=await admin.from("email_connections").update({
        custom_reply_domain:domain,custom_reply_email:replyEmail,custom_reply_domain_id:domainId,
        custom_reply_status:status,custom_reply_dns:records,updated_at:new Date().toISOString()
      }).eq("organization_id",org);
      if(error)throw error;
      return json({ok:true,domain_id:domainId,domain,status,reply_email:replyEmail,records});
    }
    if(action==="verify_custom_domain"){
      const c=await connection(org);
      if(!c?.custom_reply_domain_id)return json({error:"Nenhum domínio personalizado foi iniciado."},400);
      try{await resendRequest(`/domains/${encodeURIComponent(c.custom_reply_domain_id)}/verify`,{method:"POST"});}catch(e){
        const msg=e instanceof Error?e.message:String(e);
        if(!/pending|already|verif/i.test(msg))throw e;
      }
      const d=await resendRequest(`/domains/${encodeURIComponent(c.custom_reply_domain_id)}`);
      const records=Array.isArray(d?.records)?d.records:[];
      const status=String(d?.status||"pending");
      const verified=status==="verified";
      const {error}=await admin.from("email_connections").update({
        custom_reply_status:status,custom_reply_dns:records,reply_mode:verified?"custom":c.reply_mode,updated_at:new Date().toISOString()
      }).eq("organization_id",org);
      if(error)throw error;
      return json({ok:true,verified,status,reply_email:c.custom_reply_email,records});
    }
    return json({error:"Ação inválida"},400);
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});