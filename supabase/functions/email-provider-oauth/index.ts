import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const BASE=`${SUPABASE_URL}/functions/v1/email-provider-oauth`;
const RESEND_CLIENT_ID=`${BASE}/client-metadata`;
const RESEND_CALLBACK=`${BASE}/resend-callback`;
const GMAIL_CALLBACK=`${BASE}/gmail-callback`;
const DEFAULT_RETURN="https://crm.axiva.com.br";

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}})}
function redirect(url:string){return new Response(null,{status:302,headers:{Location:url,"Cache-Control":"no-store"}})}
function b64url(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function randomToken(size=32){const a=new Uint8Array(size);crypto.getRandomValues(a);return b64url(a)}
async function sha256b64url(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return b64url(new Uint8Array(d))}
function safeReturnUrl(value:unknown){try{const u=new URL(String(value||DEFAULT_RETURN));if(u.protocol!=="https:")return DEFAULT_RETURN;if(u.hostname==="crm.axiva.com.br"||u.hostname.endsWith(".vercel.app"))return u.origin;return DEFAULT_RETURN}catch{return DEFAULT_RETURN}}
async function userFromRequest(req:Request){const h=req.headers.get("Authorization")||"";if(!h.startsWith("Bearer "))return null;const {data,error}=await admin.auth.getUser(h.slice(7));return error?null:data.user}
async function orgAdmin(userId:string,organizationId:string){
  const [{data:m},{data:o},{data:sa},{data:p}]=await Promise.all([
    admin.from("organization_members").select("role,is_active,deleted_at").eq("organization_id",organizationId).eq("user_id",userId).maybeSingle(),
    admin.from("organizations").select("is_active,deleted_at,is_sandbox").eq("id",organizationId).maybeSingle(),
    admin.from("system_admins").select("user_id").eq("user_id",userId).maybeSingle(),
    admin.from("profiles").select("account_status,deleted_at").eq("id",userId).maybeSingle(),
  ]);
  if(!o?.is_active||o?.deleted_at||p?.account_status!=="active"||p?.deleted_at)return false;
  const member=Boolean(m?.is_active&&!m?.deleted_at&&["admin","owner"].includes(String(m?.role||"")));
  return member||Boolean(sa&&o?.is_sandbox===true);
}
async function systemAdmin(userId:string){
  const [{data:sa},{data:p}]=await Promise.all([
    admin.from("system_admins").select("user_id").eq("user_id",userId).maybeSingle(),
    admin.from("profiles").select("account_status,deleted_at").eq("id",userId).maybeSingle(),
  ]);
  return Boolean(sa&&p?.account_status==="active"&&!p?.deleted_at);
}
async function googleCredentials(){const {data,error}=await admin.rpc("email_get_google_platform_credentials");if(error)throw error;const r=data?.[0]||{};return {clientId:r.client_id||"",clientSecret:r.client_secret||""}}
async function existingRefresh(orgId:string){const {data}=await admin.rpc("email_get_connection_credentials",{p_organization_id:orgId});return data?.[0]?.refresh_token||""}
async function storeTokens(args:any){const {error}=await admin.rpc("email_store_connection_tokens",args);if(error)throw error}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  const url=new URL(req.url);
  const path=url.pathname;

  if(req.method==="GET"&&path.endsWith("/client-metadata")){
    return json({client_id:RESEND_CLIENT_ID,client_name:"AXIVA CRM",client_uri:"https://crm.axiva.com.br",redirect_uris:[RESEND_CALLBACK],grant_types:["authorization_code","refresh_token"],response_types:["code"],token_endpoint_auth_method:"none",scope:"full_access"});
  }

  if(req.method==="GET"&&(path.endsWith("/resend-callback")||path.endsWith("/gmail-callback"))){
    const provider=path.endsWith("/resend-callback")?"resend":"gmail";
    const state=url.searchParams.get("state")||"";
    const code=url.searchParams.get("code")||"";
    const oauthError=url.searchParams.get("error");
    const {data:st}=await admin.from("email_oauth_states").select("*").eq("state",state).maybeSingle();
    const returnUrl=safeReturnUrl(st?.return_url);
    if(!st||st.provider!==provider||new Date(st.expires_at).getTime()<Date.now())return redirect(`${returnUrl}/?email_oauth=error&message=${encodeURIComponent("Autorização expirada ou inválida")}`);
    await admin.from("email_oauth_states").delete().eq("state",state);
    if(oauthError||!code)return redirect(`${returnUrl}/?email_oauth=error&provider=${provider}&message=${encodeURIComponent(oauthError||"Autorização cancelada")}`);
    try{
      if(provider==="resend"){
        const body=new URLSearchParams({grant_type:"authorization_code",client_id:RESEND_CLIENT_ID,code,redirect_uri:RESEND_CALLBACK,code_verifier:st.code_verifier});
        const r=await fetch("https://api.resend.com/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
        const t=await r.json();
        if(!r.ok)throw new Error(t?.message||t?.error||"Falha ao conectar Resend");
        await storeTokens({p_organization_id:st.organization_id,p_provider:"resend",p_email_address:st.sender_email,p_sender_email:st.sender_email,p_sender_name:st.sender_name||null,p_access_token:t.access_token,p_refresh_token:t.refresh_token||"",p_expires_at:new Date(Date.now()+Number(t.expires_in||900)*1000).toISOString(),p_provider_account_id:null,p_connected_by:st.user_id});
        await admin.from("email_connections").update({resend_full_access:true,updated_at:new Date().toISOString()}).eq("organization_id",st.organization_id);
      }else{
        const g=await googleCredentials();if(!g.clientId||!g.clientSecret)throw new Error("Integração Gmail ainda não configurada pelo administrador da plataforma.");
        const body=new URLSearchParams({code,client_id:g.clientId,client_secret:g.clientSecret,redirect_uri:GMAIL_CALLBACK,grant_type:"authorization_code"});
        const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
        const t=await r.json();if(!r.ok)throw new Error(t?.error_description||t?.error||"Falha ao conectar Gmail");
        const ui=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{Authorization:`Bearer ${t.access_token}`}});const profile=await ui.json();if(!ui.ok||!profile?.email)throw new Error("Não foi possível identificar o e-mail do Google.");
        const refresh=t.refresh_token||await existingRefresh(st.organization_id);
        if(!refresh)throw new Error("O Google não retornou autorização permanente. Desconecte o acesso anterior e tente novamente.");
        await storeTokens({p_organization_id:st.organization_id,p_provider:"gmail",p_email_address:profile.email,p_sender_email:profile.email,p_sender_name:profile.name||st.sender_name||null,p_access_token:t.access_token,p_refresh_token:refresh,p_expires_at:new Date(Date.now()+Number(t.expires_in||3600)*1000).toISOString(),p_provider_account_id:profile.sub||null,p_connected_by:st.user_id});
        await admin.from("email_connections").update({resend_full_access:false,updated_at:new Date().toISOString()}).eq("organization_id",st.organization_id);
      }
      return redirect(`${returnUrl}/?email_oauth=success&provider=${provider}`);
    }catch(e){return redirect(`${returnUrl}/?email_oauth=error&provider=${provider}&message=${encodeURIComponent(e instanceof Error?e.message:String(e))}`)}
  }

  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const user=await userFromRequest(req);if(!user)return json({error:"Sessão inválida"},401);
  let body:any={};try{body=await req.json()}catch{}
  const action=String(body?.action||"");

  if(action==="platform_status"){
    if(!await systemAdmin(user.id))return json({error:"Sem permissão"},403);
    const g=await googleCredentials();return json({google_configured:Boolean(g.clientId&&g.clientSecret),google_client_id:g.clientId||null,google_redirect_uri:GMAIL_CALLBACK,resend_client_id:RESEND_CLIENT_ID,resend_redirect_uri:RESEND_CALLBACK});
  }
  if(action==="configure_google"){
    if(!await systemAdmin(user.id))return json({error:"Sem permissão"},403);
    const clientId=String(body?.client_id||"").trim(),clientSecret=String(body?.client_secret||"").trim();
    if(!clientId||!clientSecret)return json({error:"Client ID e Client Secret são obrigatórios."},400);
    const {error}=await admin.rpc("email_set_google_platform_credentials",{p_client_id:clientId,p_client_secret:clientSecret,p_updated_by:user.id});if(error)return json({error:error.message},400);
    return json({ok:true,google_redirect_uri:GMAIL_CALLBACK});
  }

  const organizationId=String(body?.organization_id||"");if(!organizationId)return json({error:"organization_id é obrigatório"},400);
  if(!await orgAdmin(user.id,organizationId))return json({error:"Somente administradores da empresa podem conectar ou alterar a conta de e-mail."},403);

  if(action==="start"){
    const provider=String(body?.provider||"");if(!["gmail","resend"].includes(provider))return json({error:"Provedor inválido"},400);
    const returnUrl=safeReturnUrl(body?.return_url);
    const state=randomToken(32);let verifier:string|null=null;let authorizationUrl="";
    const senderEmail=String(body?.sender_email||"").trim();const senderName=String(body?.sender_name||"").trim()||null;
    if(provider==="resend"){
      if(!senderEmail||!senderEmail.includes("@"))return json({error:"Informe o e-mail remetente do domínio verificado no Resend."},400);
      verifier=randomToken(64);const challenge=await sha256b64url(verifier);
      const q=new URLSearchParams({client_id:RESEND_CLIENT_ID,response_type:"code",redirect_uri:RESEND_CALLBACK,scope:"full_access",state,code_challenge:challenge,code_challenge_method:"S256"});
      authorizationUrl=`https://api.resend.com/oauth/authorize?${q}`;
    }else{
      const g=await googleCredentials();if(!g.clientId||!g.clientSecret)return json({error:"O Gmail ainda precisa da configuração única do Google OAuth pelo administrador da plataforma."},409);
      const q=new URLSearchParams({client_id:g.clientId,redirect_uri:GMAIL_CALLBACK,response_type:"code",scope:"openid email profile https://www.googleapis.com/auth/gmail.send",access_type:"offline",include_granted_scopes:"true",prompt:"consent",state});
      authorizationUrl=`https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    }
    const {error}=await admin.from("email_oauth_states").insert({state,organization_id:organizationId,user_id:user.id,provider,code_verifier:verifier,sender_email:senderEmail||null,sender_name:senderName,return_url:returnUrl});
    if(error)return json({error:error.message},500);
    return json({authorization_url:authorizationUrl});
  }

  if(action==="update_sender"){
    const senderEmail=String(body?.sender_email||"").trim(),senderName=String(body?.sender_name||"").trim()||null;
    if(!senderEmail||!senderEmail.includes("@"))return json({error:"E-mail remetente inválido."},400);
    const {data:c}=await admin.from("email_connections").select("provider").eq("organization_id",organizationId).maybeSingle();
    if(c?.provider!=="resend")return json({error:"O remetente manual é usado somente na conexão Resend."},400);
    const {error}=await admin.from("email_connections").update({sender_email:senderEmail,sender_name:senderName,updated_at:new Date().toISOString()}).eq("organization_id",organizationId);if(error)return json({error:error.message},400);
    return json({ok:true});
  }

  if(action==="disconnect"){
    const {data:creds}=await admin.rpc("email_get_connection_credentials",{p_organization_id:organizationId});const c=creds?.[0];
    if(c?.refresh_token){
      try{
        if(c.provider==="resend")await fetch("https://api.resend.com/oauth/revoke",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:RESEND_CLIENT_ID,token:c.refresh_token,token_type_hint:"refresh_token"})});
        if(c.provider==="gmail")await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.refresh_token)}`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"}});
      }catch{}
    }
    const {error}=await admin.rpc("email_revoke_connection",{p_organization_id:organizationId});if(error)return json({error:error.message},500);
    return json({ok:true});
  }
  return json({error:"Ação inválida"},400);
});