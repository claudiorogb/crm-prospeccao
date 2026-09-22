import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const OAUTH_BASE=`${SUPABASE_URL}/functions/v1/email-provider-oauth`;
const RESEND_CLIENT_ID=`${OAUTH_BASE}/client-metadata`;
const UNSUBSCRIBE_BASE=`${SUPABASE_URL}/functions/v1/email-unsubscribe`;
const TRACK_BASE=`${SUPABASE_URL}/functions/v1/email-campaign-track`;

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}})}
function escapeHtml(v:string){return v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function bytesToBase64(bytes:Uint8Array){let out="";const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));return btoa(out)}
function base64urlText(value:string){const b64=bytesToBase64(new TextEncoder().encode(value));return b64.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function encodeHeader(value:string){return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(value))}?=`}
function cleanHeader(value:string){return String(value||"").replace(/[\r\n]+/g," ").trim()}
function trackedHtml(body:string,token:string|null){
 if(!token)return escapeHtml(body).replace(/\n/g,"<br>");
 const expression=/https?:\/\/[^\s<>"']+/gi;let index=0;
 const rendered=String(body).replace(expression,match=>{
  const linkIndex=index++;if(linkIndex>=30)return escapeHtml(match);
  const url=match.replace(/[.,;!?)\]]+$/,"");const trailing=match.slice(url.length);
  try{const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol)||parsed.username||parsed.password)return escapeHtml(match)}catch{return escapeHtml(match)}
  return `<a href="${TRACK_BASE}?t=${token}&amp;l=${linkIndex}" rel="noopener noreferrer">${escapeHtml(url)}</a>${escapeHtml(trailing)}`;
 });
 return rendered.split(/\n/).map(part=>part.replace(/&(?!(?:amp|lt|gt|quot);)/g,"&amp;")).join("<br>");
}
function trackedBody(body:string,token:string|null){
 if(!token)return escapeHtml(body).replace(/\n/g,"<br>");
 const matches=[...String(body).matchAll(/https?:\/\/[^\s<>"']+/gi)].slice(0,30);
 let cursor=0;let output="";
 for(let i=0;i<matches.length;i++){
  const m=matches[i];const start=m.index||0;output+=escapeHtml(body.slice(cursor,start));
  const raw=m[0];const target=raw.replace(/[.,;!?)\]]+$/,"");const trailing=raw.slice(target.length);
  let valid=false;try{const u=new URL(target);valid=["http:","https:"].includes(u.protocol)&&!u.username&&!u.password}catch{}
  output+=valid?`<a href="${TRACK_BASE}?t=${token}&amp;l=${i}" rel="noopener noreferrer">${escapeHtml(target)}</a>${escapeHtml(trailing)}`:escapeHtml(raw);
  cursor=start+raw.length;
 }
 output+=escapeHtml(body.slice(cursor));return output.replace(/\n/g,"<br>");
}
function trackingPixel(token:string|null){return token?`<img src="${TRACK_BASE}?t=${token}" width="1" height="1" alt="" style="display:none" />`:""}
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
  const g=await googleCredentials();if(!g.clientId||!g.clientSecret)throw new Error("Configuração Gmail da plataforma ausente.");
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:g.clientId,client_secret:g.clientSecret,refresh_token:creds.refresh_token,grant_type:"refresh_token"})});
  payload=await r.json();if(!r.ok)throw new Error(payload?.error_description||payload?.error||"Falha ao renovar Gmail");
  payload.refresh_token=creds.refresh_token;
 }
 const access=payload.access_token;const refresh=payload.refresh_token||creds.refresh_token;const expires=new Date(Date.now()+Number(payload.expires_in||900)*1000).toISOString();
 const {error}=await admin.rpc("email_store_connection_tokens",{p_organization_id:orgId,p_provider:creds.provider,p_email_address:creds.email_address,p_sender_email:creds.sender_email,p_sender_name:creds.sender_name,p_access_token:access,p_refresh_token:refresh,p_expires_at:expires,p_provider_account_id:meta?.provider_account_id||null,p_connected_by:meta?.connected_by||null});
 if(error)throw error;return {...creds,access_token:access,refresh_token:refresh,access_expires_at:expires};
}
async function usableCreds(orgId:string){let c=await getCreds(orgId);if(!c)throw new Error("Conta de e-mail não conectada.");const exp=c.access_expires_at?new Date(c.access_expires_at).getTime():0;if(!c.access_token||exp<Date.now()+60000)c=await refreshCredentials(orgId,c);return c}
async function signedAttachments(campaignId:string){
 const {data:campaignMeta,error:campaignError}=await admin.from("email_campaigns").select("source_campaign_id").eq("id",campaignId).single();if(campaignError)throw campaignError;
 const attachmentCampaignId=campaignMeta?.source_campaign_id||campaignId;
 const {data:rows,error}=await admin.from("email_campaign_attachments").select("storage_path,file_name,mime_type,size_bytes").eq("campaign_id",attachmentCampaignId).order("created_at");if(error)throw error;
 const result:any[]=[];for(const a of rows||[]){const {data,error:e}=await admin.storage.from("email-campaign-attachments").createSignedUrl(a.storage_path,600);if(e)throw e;result.push({...a,signed_url:data.signedUrl});}return result;
}
async function gmailAttachmentData(rows:any[]){const out:any[]=[];for(const a of rows){const {data,error}=await admin.storage.from("email-campaign-attachments").download(a.storage_path);if(error)throw error;const bytes=new Uint8Array(await data.arrayBuffer());out.push({...a,content:bytesToBase64(bytes)});}return out;}
function buildMime(fromEmail:string,fromName:string|undefined,to:string,subject:string,body:string,unsubscribe:string,attachments:any[],token:string|null){
 const mixed=`axiva_mix_${crypto.randomUUID().replace(/-/g,"")}`;const alt=`axiva_alt_${crypto.randomUUID().replace(/-/g,"")}`;const crlf="\r\n";
 const from=fromName?`${encodeHeader(cleanHeader(fromName))} <${cleanHeader(fromEmail)}>`:cleanHeader(fromEmail);
 const html=`<div style="font-family:Arial,sans-serif;white-space:normal">${trackedBody(body,token)}</div><hr style="border:0;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#666">Não deseja mais receber estes e-mails? <a href="${unsubscribe}">Cancelar inscrição</a>.</p>${trackingPixel(token)}`;
 const plain=`${body}\n\nPara cancelar o recebimento: ${unsubscribe}`;
 const lines=[`From: ${from}`,`To: ${cleanHeader(to)}`,`Subject: ${encodeHeader(subject)}`,"MIME-Version: 1.0",`List-Unsubscribe: <${unsubscribe}>`,`List-Unsubscribe-Post: List-Unsubscribe=One-Click`];
 if(attachments.length){
  lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`,"",`--${mixed}`,`Content-Type: multipart/alternative; boundary="${alt}"`,"",`--${alt}`,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: 8bit","",plain,"",`--${alt}`,"Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: 8bit","",html,"",`--${alt}--`);
  for(const a of attachments){lines.push("",`--${mixed}`,`Content-Type: ${a.mime_type||"application/octet-stream"}; name="${cleanHeader(a.file_name)}"`,`Content-Disposition: attachment; filename="${cleanHeader(a.file_name)}"`,`Content-Transfer-Encoding: base64`,"",a.content);}
  lines.push("",`--${mixed}--`,"");
 }else{lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`,"",`--${alt}`,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: 8bit","",plain,"",`--${alt}`,"Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: 8bit","",html,"",`--${alt}--`,"");}
 return lines.join(crlf);
}
async function sendResend(creds:any,recipient:any,campaign:any,attachments:any[],token:string|null){
 const unsubscribe=`${UNSUBSCRIBE_BASE}?token=${recipient.unsubscribe_token}`;const from=campaign.from_name?`${campaign.from_name} <${campaign.from_email}>`:campaign.from_email;
 const html=`<div style="font-family:Arial,sans-serif">${trackedBody(campaign.body_text,token)}</div><hr style="border:0;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#666">Não deseja mais receber estes e-mails? <a href="${unsubscribe}">Cancelar inscrição</a>.</p>${trackingPixel(token)}`;
 const payload:any={from,to:[recipient.recipient_email],subject:campaign.subject,text:`${campaign.body_text}\n\nPara cancelar o recebimento: ${unsubscribe}`,html,headers:{"List-Unsubscribe":`<${unsubscribe}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}};
 if(attachments.length)payload.attachments=attachments.map(a=>({path:a.signed_url,filename:a.file_name}));
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${creds.access_token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});const d=await r.json();return {ok:r.ok,status:r.status,id:d?.id||null,error:d?.message||d?.error||(!r.ok?`Resend HTTP ${r.status}`:null)};
}
async function sendGmail(creds:any,recipient:any,campaign:any,attachments:any[],token:string|null){
 const unsubscribe=`${UNSUBSCRIBE_BASE}?token=${recipient.unsubscribe_token}`;const files=attachments.length?await gmailAttachmentData(attachments):[];const mime=buildMime(campaign.from_email,campaign.from_name,recipient.recipient_email,campaign.subject,campaign.body_text,unsubscribe,files,token);const raw=base64urlText(mime);
 const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${creds.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({raw})});const d=await r.json();return {ok:r.ok,status:r.status,id:d?.id||null,error:d?.error?.message||(!r.ok?`Gmail HTTP ${r.status}`:null)};
}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const expected=await processorSecret();const provided=req.headers.get("X-Processor-Secret")||"";if(!expected||provided!==expected)return json({error:"Unauthorized"},401);
  let processed=0,sent=0,failed=0,retried=0;
  for(let i=0;i<20;i++){
   const {data:claim,error:claimError}=await admin.rpc("email_claim_next_recipient");if(claimError)throw claimError;const c=claim?.[0];if(!c)break;
   processed++;
   try{
    const [{data:recipient,error:rErr},{data:campaign,error:cErr},attachments,creds]=await Promise.all([
     admin.from("email_campaign_recipients").select("id,recipient_email,recipient_name,unsubscribe_token").eq("id",c.recipient_id).single(),
     admin.from("email_campaigns").select("id,organization_id,subject,body_text,from_email,from_name,provider,status,metrics_enabled").eq("id",c.campaign_id).single(),
     signedAttachments(c.campaign_id),usableCreds(c.organization_id),
    ]);
    if(rErr)throw rErr;if(cErr)throw cErr;if(!recipient||!campaign)throw new Error("Campanha ou destinatário não encontrado.");
    if(creds.provider!==campaign.provider)throw new Error("O provedor conectado mudou após a criação da campanha. Cancele e recrie a campanha.");
    let trackingToken:string|null=null;
    if(campaign.metrics_enabled){const {data,error}=await admin.rpc("email_tracking_prepare",{p_recipient_id:recipient.id});if(error||!data)throw new Error("Não foi possível preparar o acompanhamento seguro deste e-mail.");trackingToken=String(data);}
    const result=creds.provider==="resend"?await sendResend(creds,recipient,campaign,attachments,trackingToken):await sendGmail(creds,recipient,campaign,attachments,trackingToken);
    if(result.ok){await admin.rpc("email_complete_recipient",{p_recipient_id:recipient.id,p_success:true,p_provider_message_id:result.id,p_error:null,p_retry_after_seconds:null});sent++;}
    else{const retry=[401,403,429,500,502,503,504].includes(Number(result.status))?3600:null;await admin.rpc("email_complete_recipient",{p_recipient_id:recipient.id,p_success:false,p_provider_message_id:null,p_error:result.error,p_retry_after_seconds:retry});if(retry)retried++;else failed++;}
   }catch(e){const msg=e instanceof Error?e.message:String(e);await admin.rpc("email_complete_recipient",{p_recipient_id:c.recipient_id,p_success:false,p_provider_message_id:null,p_error:msg,p_retry_after_seconds:3600});retried++;if(/token|oauth|autoriz|credencial|conect/i.test(msg))await admin.from("email_connections").update({status:"error",last_error:msg,updated_at:new Date().toISOString()}).eq("organization_id",c.organization_id);}
  }
  return json({ok:true,processed,sent,failed,retried});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});