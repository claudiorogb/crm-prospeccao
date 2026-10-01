import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const OAUTH_BASE=`${SUPABASE_URL}/functions/v1/email-provider-oauth`;
const RESEND_CLIENT_ID=`${OAUTH_BASE}/client-metadata`;
const UNSUBSCRIBE_BASE=`${SUPABASE_URL}/functions/v1/email-unsubscribe`;
const REPLY_DOMAIN="auth.axiva.com.br";

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}})}
function bytesToBase64(bytes:Uint8Array){let out="";for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(out)}
function b64url(value:string){return bytesToBase64(new TextEncoder().encode(value)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function clean(v:string){return String(v||"").replace(/[\r\n]+/g," ").trim()}
function enc(v:string){return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(v))}?=`}
function html(v:string){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\n/g,"<br>")}
function randomIndex(length:number){if(length<=1)return 0;const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);return Number(bytes[0]%length)}
function normalizeLegacySpintax(value:string){
 return String(value||"").replace(/\{\s*op(?:ç|c)ão\s*1\s*\|\s*op(?:ç|c)ão\s*2\s*\|\s*op(?:ç|c)ão\s*3\s*\}/gi,"{Quero te apresentar|Gostaria de apresentar|Posso te mostrar}");
}
function applySpintax(value:string){
  let output=normalizeLegacySpintax(value);const pattern=/\{([^{}]*\|[^{}]*)\}/g;
  for(let pass=0;pass<12;pass+=1){
    let changed=false;
    output=output.replace(pattern,(_m,inner)=>{const options=String(inner).split("|").map((v:string)=>v.trim());if(options.length<2)return _m;changed=true;return options[randomIndex(options.length)]??""});
    if(!changed)break;
  }
  return output;
}
function saoPauloGreeting(){
 const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",hour:"2-digit",hourCycle:"h23"}).format(new Date()));
 const greeting=hour<12?"Bom dia":hour<18?"Boa tarde":"Boa noite";
 const endings=["tudo bem?","como vai?","como está?","tudo certo?"];
 return `${greeting}, ${endings[randomIndex(endings.length)]}`;
}
function applyVariables(value:string,ctx:any){
  return String(value||"").replaceAll("{saudacao}",saoPauloGreeting()).replaceAll("{nome}","")
      .replaceAll("{empresa}",ctx?.empresa||"")
    .replaceAll("{cidade}",ctx?.cidade||"")
    .replaceAll("{uf}",ctx?.uf||"")
    .replaceAll("{telefone}",ctx?.telefone||"")
    .replaceAll("{segmento}",ctx?.segmento||"")
    .replaceAll("{email}",ctx?.email||"");
}
async function recipientContext(recipient:any){
  const base={nome:recipient?.recipient_name||"",empresa:"",cidade:"",uf:"",telefone:"",segmento:"",email:recipient?.recipient_email||""};
  if(recipient?.lead_id){
    const {data}=await admin.from("leads").select("business_name,contact_name,city,state,phone,whatsapp_phone,segment,email").eq("id",recipient.lead_id).maybeSingle();
    if(data)return {nome:data.contact_name||base.nome,empresa:data.business_name||"",cidade:data.city||"",uf:data.state||"",telefone:data.whatsapp_phone||data.phone||"",segmento:data.segment||"",email:data.email||base.email};
  }
  if(recipient?.marketing_contact_id){
    const {data}=await admin.from("email_marketing_contacts").select("contact_name,company_name,email").eq("id",recipient.marketing_contact_id).maybeSingle();
    if(data)return {...base,nome:data.contact_name||base.nome,empresa:data.company_name||"",email:data.email||base.email};
  }
  return base;
}
async function renderSequence(c:any,r:any){
  const ctx=await recipientContext(r);
  return {
    ...c,
    subject:applySpintax(applyVariables(c.subject,ctx)),
    body_text:applySpintax(applyVariables(c.body_text,ctx)),
    followup1_body:c.followup1_body?applySpintax(applyVariables(c.followup1_body,ctx)):c.followup1_body,
    followup2_body:c.followup2_body?applySpintax(applyVariables(c.followup2_body,ctx)):c.followup2_body,
  };
}
async function processorSecret(){const {data,error}=await admin.rpc("email_get_processor_secret");if(error)throw error;return String(data||"")}
async function googleCredentials(){const {data,error}=await admin.rpc("email_get_google_platform_credentials");if(error)throw error;const r=data?.[0]||{};return {clientId:r.client_id||"",clientSecret:r.client_secret||""}}
async function getCreds(orgId:string){const {data,error}=await admin.rpc("email_get_connection_credentials",{p_organization_id:orgId});if(error)throw error;return data?.[0]||null}

async function refreshCredentials(orgId:string,creds:any){
  const {data:meta}=await admin.from("email_connections").select("provider_account_id,connected_by").eq("organization_id",orgId).maybeSingle();
  if(!creds?.refresh_token)throw new Error("Token de renovação ausente. Reconecte a conta de e-mail.");
  let payload:any;
  if(creds.provider==="resend"){
    const r=await fetch("https://api.resend.com/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",client_id:RESEND_CLIENT_ID,refresh_token:creds.refresh_token})});
    payload=await r.json();if(!r.ok)throw new Error(payload?.message||payload?.error||"Falha ao renovar Resend");
  }else{
    const g=await googleCredentials();if(!g.clientId||!g.clientSecret)throw new Error("Configuração Gmail ausente.");
    const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:g.clientId,client_secret:g.clientSecret,refresh_token:creds.refresh_token,grant_type:"refresh_token"})});
    payload=await r.json();if(!r.ok)throw new Error(payload?.error_description||payload?.error||"Falha ao renovar Gmail");
    payload.refresh_token=creds.refresh_token;
  }
  const expires=new Date(Date.now()+Number(payload.expires_in||(creds.provider==="gmail"?3600:900))*1000).toISOString();
  const {error}=await admin.rpc("email_store_connection_tokens",{p_organization_id:orgId,p_provider:creds.provider,p_email_address:creds.email_address,p_sender_email:creds.sender_email,p_sender_name:creds.sender_name,p_access_token:payload.access_token,p_refresh_token:payload.refresh_token||creds.refresh_token,p_expires_at:expires,p_provider_account_id:meta?.provider_account_id||null,p_connected_by:meta?.connected_by||null});
  if(error)throw error;
  return {...creds,access_token:payload.access_token,refresh_token:payload.refresh_token||creds.refresh_token,access_expires_at:expires};
}
async function usableCreds(orgId:string){
  let c=await getCreds(orgId);
  if(!c||!["gmail","resend"].includes(c.provider))throw new Error("Conta Gmail ou Resend não conectada.");
  const exp=c.access_expires_at?new Date(c.access_expires_at).getTime():0;
  if(!c.access_token||exp<Date.now()+60000)c=await refreshCredentials(orgId,c);
  return c;
}
async function gmailReadReady(creds:any){const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=1",{headers:{Authorization:`Bearer ${creds.access_token}`}});return r.ok}
async function threadHasReply(creds:any,threadId:string,email:string){
  const q=new URLSearchParams({format:"metadata"});q.append("metadataHeaders","From");
  const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?${q}`,{headers:{Authorization:`Bearer ${creds.access_token}`}});
  if(r.status===404)return false;
  if(!r.ok)throw new Error(r.status===403?"Gmail sem permissão de leitura. Autorize a prospecção novamente.":`Falha ao consultar conversa no Gmail (${r.status}).`);
  const d=await r.json();const target=String(email||"").trim().toLowerCase();
  return (d?.messages||[]).some((m:any)=>{const from=(m?.payload?.headers||[]).find((h:any)=>String(h.name).toLowerCase()==="from")?.value||"";return String(from).toLowerCase().includes(target)});
}
function mime(fromEmail:string,fromName:string,to:string,subject:string,body:string,unsubscribe:string){
  const from=fromName?`${enc(clean(fromName))} <${clean(fromEmail)}>`:clean(fromEmail);
  const boundary=`axiva_${crypto.randomUUID().replace(/-/g,"")}`;const crlf="\r\n";
  return [
    `From: ${from}`,`To: ${clean(to)}`,`Subject: ${enc(subject)}`,"MIME-Version: 1.0",
    `List-Unsubscribe: <${unsubscribe}>`,"List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,"",
    `--${boundary}`,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: 8bit","",`${body}\n\nPara cancelar o recebimento: ${unsubscribe}`,"",
    `--${boundary}`,"Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: 8bit","",`<div style="font-family:Arial,sans-serif">${html(body)}</div><hr style="border:0;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#666">Não deseja mais receber estes e-mails? <a href="${unsubscribe}">Cancelar inscrição</a>.</p>`,"",
    `--${boundary}--`,""
  ].join(crlf);
}
function sequenceBody(r:any,c:any){const step=Number(r.sequence_step||1);return step===2?c.followup1_body:step===3?c.followup2_body:c.body_text}
async function sendGmail(creds:any,r:any,c:any){
  const body=sequenceBody(r,c);const unsubscribe=`${UNSUBSCRIBE_BASE}?token=${r.unsubscribe_token}`;const raw=b64url(mime(c.from_email,c.from_name,r.recipient_email,c.subject,body,unsubscribe));
  const payload:any={raw};if(r.gmail_thread_id)payload.threadId=r.gmail_thread_id;
  const res=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${creds.access_token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const d=await res.json();return {ok:res.ok,status:res.status,id:d?.id||null,threadId:d?.threadId||r.gmail_thread_id||null,error:d?.error?.message||(!res.ok?`Gmail HTTP ${res.status}`:null)};
}
async function sendResend(creds:any,r:any,c:any){
  const body=sequenceBody(r,c);
  const unsubscribe=`${UNSUBSCRIBE_BASE}?token=${r.unsubscribe_token}`;
  const replyAddress=`reply-${r.reply_token}@${REPLY_DOMAIN}`;
  const from=c.from_name?`${c.from_name} <${c.from_email}>`:c.from_email;
  const payload:any={
    from,
    to:[r.recipient_email],
    subject:c.subject,
    text:`${body}\n\nPara cancelar o recebimento: ${unsubscribe}`,
    html:`<div style="font-family:Arial,sans-serif">${html(body)}</div><hr style="border:0;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#666">Não deseja mais receber estes e-mails? <a href="${unsubscribe}">Cancelar inscrição</a>.</p>`,
    reply_to:[replyAddress],
    headers:{"List-Unsubscribe":`<${unsubscribe}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}
  };
  const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${creds.access_token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const d=await res.json();return {ok:res.ok,status:res.status,id:d?.id||null,threadId:null,error:d?.message||d?.error||(!res.ok?`Resend HTTP ${res.status}`:null)};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const expected=await processorSecret();
    if(!expected||req.headers.get("X-Processor-Secret")!==expected)return json({error:"Unauthorized"},401);
    let processed=0,sent=0,stopped=0,retried=0,failed=0;
    for(let i=0;i<20;i++){
      const {data:claim,error:claimError}=await admin.rpc("email_claim_next_sequence_recipient");
      if(claimError)throw claimError;const x=claim?.[0];if(!x)break;processed++;
      try{
        const [{data:r,error:re},{data:c,error:ce},creds]=await Promise.all([
          admin.from("email_campaign_recipients").select("id,recipient_email,recipient_name,unsubscribe_token,reply_token,gmail_thread_id,sequence_step,replied_at,lead_id,marketing_contact_id").eq("id",x.recipient_id).single(),
          admin.from("email_campaigns").select("id,subject,body_text,followup1_body,followup2_body,from_email,from_name,provider,sequence_mode").eq("id",x.campaign_id).single(),
          usableCreds(x.organization_id)
        ]);
        if(re)throw re;if(ce)throw ce;if(!r||!c||!c.sequence_mode)throw new Error("Sequência inválida.");
        if(creds.provider!==c.provider)throw new Error("O provedor conectado mudou após a criação da sequência. Cancele e recrie a sequência.");
        if(r.replied_at){await admin.rpc("email_mark_prospecting_reply",{p_recipient_id:r.id});stopped++;continue}
        if(creds.provider==="gmail"){
          if(!(await gmailReadReady(creds)))throw new Error("Gmail sem permissão de leitura. Clique em Autorizar Gmail para prospecção.");
          if(r.gmail_thread_id&&Number(r.sequence_step)>1&&await threadHasReply(creds,r.gmail_thread_id,r.recipient_email)){
            await admin.rpc("email_mark_prospecting_reply",{p_recipient_id:r.id});stopped++;continue;
          }
        }
        const {data:gate,error:gateError}=await admin.from("email_campaign_recipients").select("status,replied_at").eq("id",r.id).single();
        if(gateError)throw gateError;
        if(gate?.status!=="sending"||gate?.replied_at){stopped++;continue;}
        const renderedCampaign=await renderSequence(c,r);
        const result=creds.provider==="resend"?await sendResend(creds,r,renderedCampaign):await sendGmail(creds,r,renderedCampaign);
        if(result.ok){
          if(result.threadId)await admin.from("email_campaign_recipients").update({gmail_thread_id:result.threadId,updated_at:new Date().toISOString()}).eq("id",r.id);
          await admin.rpc("email_complete_recipient",{p_recipient_id:r.id,p_success:true,p_provider_message_id:result.id,p_error:null,p_retry_after_seconds:null});sent++;
        }else{
          const retry=[401,403,429,500,502,503,504].includes(Number(result.status))?3600:null;
          await admin.rpc("email_complete_recipient",{p_recipient_id:r.id,p_success:false,p_provider_message_id:null,p_error:result.error,p_retry_after_seconds:retry});
          if(retry)retried++;else failed++;
        }
      }catch(e){
        const msg=e instanceof Error?e.message:String(e);
        await admin.rpc("email_complete_recipient",{p_recipient_id:x.recipient_id,p_success:false,p_provider_message_id:null,p_error:msg,p_retry_after_seconds:3600});retried++;
      }
    }
    return json({ok:true,processed,sent,stopped,retried,failed});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});