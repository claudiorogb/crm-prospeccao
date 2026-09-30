import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function digits(v: unknown){return String(v||"").replace(/\D/g,"")}
function normalizePhone(v: unknown){const d=digits(v);if(d.startsWith("55")&&d.length>=12)return d;if(d.length===10||d.length===11)return `55${d}`;return d}
function normalizeText(value:string){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim()}
function isAutomaticReply(text:string){
  const t=normalizeText(text);if(!t)return false;
  const patterns=[
    /mensagem automatica/,/resposta automatica/,/atendimento automatico/,/assistente virtual/,
    /fora do horario de atendimento/,/nosso horario de atendimento/,/retornaremos assim que possivel/,
    /logo (responderei|responderemos|retornarei|retornaremos)/,/aguarde.*(atendente|atendimento|retorno)/,
    /direcionad[oa] ao setor responsavel/,/selecione uma opcao/,/escolha uma opcao/,
    /digite [0-9].*(para|opcao)/,/menu de atendimento/,/agradece(mos)? (o |seu )?contato/,
    /qual seu nome e (sua )?necessidade/,/numero de ticket/,/ticket.*foi finalizado/
  ];
  if(patterns.some(p=>p.test(t)))return true;
  return ["ola! em que posso ajudar?","ola, em que posso ajudar?","ola! como posso ajudar?","ola, como posso ajudar?"].includes(t);
}
function messageText(message:any){
  const type=String(message?.type||"");
  if(type==="text")return String(message?.text?.body||"").trim();
  if(type==="button")return String(message?.button?.text||"").trim();
  if(type==="interactive")return String(message?.interactive?.button_reply?.title||message?.interactive?.list_reply?.title||"").trim();
  if(["image","video","document"].includes(type))return String(message?.[type]?.caption||"").trim();
  return "";
}
function mediaMetadata(message:any){
  const type=String(message?.type||"");
  const media=message?.[type];
  if(!media||!["image","video","audio","document","sticker"].includes(type))return {};
  return {id:media.id||null,mime_type:media.mime_type||null,sha256:media.sha256||null,filename:media.filename||null,voice:media.voice||false};
}
async function validSignature(raw:string,received:string,secret:string){
  if(!received.startsWith("sha256=")||!secret)return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw));
  const expected="sha256="+Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,"0")).join("");
  if(expected.length!==received.length)return false;
  let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^received.charCodeAt(i);
  return diff===0;
}
function occurredAt(timestamp:any){
  const n=Number(timestamp||0);if(!n)return new Date().toISOString();
  return new Date(n<10_000_000_000?n*1000:n).toISOString();
}

Deno.serve(async(req)=>{
  const verifyToken=Deno.env.get("META_WEBHOOK_VERIFY_TOKEN")||"";
  const appSecret=Deno.env.get("META_APP_SECRET")||"";

  if(req.method==="GET"){
    const url=new URL(req.url);
    if(url.searchParams.get("hub.mode")==="subscribe"&&verifyToken&&url.searchParams.get("hub.verify_token")===verifyToken){
      return new Response(url.searchParams.get("hub.challenge")||"",{status:200,headers:{"Content-Type":"text/plain"}});
    }
    return new Response("Forbidden",{status:403});
  }
  if(req.method!=="POST")return json({error:"Method not allowed"},405);

  const raw=await req.text();
  if(!(await validSignature(raw,req.headers.get("x-hub-signature-256")||"",appSecret)))return json({error:"Invalid signature"},401);

  let payload:any;try{payload=JSON.parse(raw)}catch{return json({error:"Invalid JSON"},400)}
  if(payload?.object!=="whatsapp_business_account")return json({ok:true,ignored:true});

  const supabaseUrl=Deno.env.get("SUPABASE_URL"),serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl||!serviceRole)return json({error:"Server not configured"},503);
  const admin=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});

  try{
    for(const entry of payload?.entry||[]){
      for(const change of entry?.changes||[]){
        if(change?.field!=="messages")continue;
        const value=change?.value||{};
        const phoneNumberId=String(value?.metadata?.phone_number_id||"");
        if(!phoneNumberId)continue;

        const {data:numberRow}=await admin.from("whatsapp_numbers")
          .select("id,organization_id")
          .eq("provider","meta")
          .eq("provider_phone_number_id",phoneNumberId)
          .eq("is_active",true)
          .is("deleted_at",null)
          .maybeSingle();
        if(!numberRow)continue;

        for(const status of value?.statuses||[]){
          const messageId=String(status?.id||"");if(!messageId)continue;
          const mapped=String(status?.status||"");
          await admin.from("whatsapp_messages").update({delivery_status:mapped||"unknown"})
            .eq("organization_id",numberRow.organization_id).eq("provider","meta").eq("provider_message_id",messageId);
        }

        for(const message of value?.messages||[]){
          const providerMessageId=String(message?.id||"");if(!providerMessageId)continue;
          const senderPhone=normalizePhone(message?.from);if(!senderPhone)continue;
          const text=messageText(message);
          const contactName=String((value?.contacts||[]).find((c:any)=>normalizePhone(c?.wa_id)===senderPhone)?.profile?.name||"").trim();

          const {data:existing}=await admin.from("whatsapp_inbound_events").select("id")
            .eq("organization_id",numberRow.organization_id).eq("provider_message_id",providerMessageId).maybeSingle();
          if(existing?.id)continue;

          const {data:leadRows,error:leadError}=await admin.from("leads")
            .select("id,status,phone,whatsapp_phone,campaign_id")
            .eq("organization_id",numberRow.organization_id).is("deleted_at",null).neq("status","discarded");
          if(leadError)throw leadError;

          const candidates=(leadRows||[]).filter((lead:any)=>[normalizePhone(lead.whatsapp_phone),normalizePhone(lead.phone)].filter(Boolean).includes(senderPhone));
          let classification=isAutomaticReply(text)?"automatic":"human";
          let lead:any=null;
          if(candidates.length===1)lead=candidates[0];
          else if(candidates.length>1)classification="ambiguous";
          else classification="ignored";

          const receivedAt=occurredAt(message?.timestamp);
          const {error:eventError}=await admin.from("whatsapp_inbound_events").insert({
            organization_id:numberRow.organization_id,
            lead_id:lead?.id||null,
            whatsapp_number_id:numberRow.id,
            provider_message_id:providerMessageId,
            sender_phone:senderPhone,
            message_text:text||null,
            classification,
            received_at:receivedAt,
            raw_event:{provider:"meta",message,contact:value?.contacts||[],metadata:value?.metadata||{}}
          });
          if(eventError)throw eventError;

          await admin.from("whatsapp_messages").update({
            message_type:String(message?.type||"unknown"),
            media_metadata:mediaMetadata(message)
          }).eq("organization_id",numberRow.organization_id).eq("provider","meta").eq("provider_message_id",providerMessageId);

          if(contactName){
            await admin.from("whatsapp_conversations").update({contact_name:contactName,updated_at:new Date().toISOString()})
              .eq("organization_id",numberRow.organization_id).eq("whatsapp_number_id",numberRow.id).eq("contact_phone",senderPhone);
          }

          if(!lead)continue;
          const notePrefix=classification==="automatic"?"Resposta automática detectada (não alterou o funil)":"Resposta recebida pelo WhatsApp";
          await admin.from("activities").insert({
            organization_id:numberRow.organization_id,lead_id:lead.id,campaign_id:lead.campaign_id||null,
            activity_type:classification==="automatic"?"auto_reply_received":"reply_received",channel:"whatsapp",
            notes:text?`${notePrefix}: ${text.slice(0,3000)}`:notePrefix,occurred_at:receivedAt,created_by:null
          });

          if(classification==="human"&&["new","queued","contacted","contacted_pending"].includes(lead.status)){
            const localDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(receivedAt));
            await admin.from("leads").update({status:"replied",last_contact_date:localDate,updated_at:new Date().toISOString()})
              .eq("id",lead.id).eq("organization_id",numberRow.organization_id)
              .in("status",["new","queued","contacted","contacted_pending"]);
          }
        }
      }
    }
    return json({ok:true});
  }catch(error){
    return json({error:error instanceof Error?error.message:String(error)},500);
  }
});