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
function isAutomaticReply(text: string) {
  const t = normalizeText(text);
  if (!t) return false;

  // Sinais explícitos de automação têm prioridade sobre saudações ou frases de cortesia.
  const explicitAutomationPatterns = [
    /mensagem automatica/,
    /resposta automatica/,
    /atendimento automatico/,
    /esta e uma mensagem automatica/,
    /esta e uma resposta automatica/,
    /nao responda esta mensagem/,
    /assistente virtual/,
    /robo de atendimento/,
    /bot de atendimento/,
    /fora do horario de atendimento/,
    /no momento estamos (ausentes|indisponiveis|fora do horario)/,
    /nao estamos disponiveis no momento/,
    /retornaremos assim que possivel/,
    /retornaremos em instantes/,
    /logo (responderei|responderemos|retornarei|retornaremos)/,
    /em breve (um de nossos|nossa equipe|iremos) (atendentes|retornar|responder|entrar em contato)/,
    /aguarde.*(atendente|atendimento|retorno)/,
    /sendo transferid[oa].*(fila|atendimento|setor|departamento)/,
    /transferid[oa] para (a )?fila de atendimento/,
    /direcionad[oa] ao setor responsavel/,
    /assunto sera direcionado/,
    /selecione uma opcao/,
    /escolha uma opcao/,
    /digite [0-9].*(para|opcao)/,
    /digite com qual (departamento|setor).*(deseja|quer).*(falar|atendimento)/,
    /para continuar.*digite/,
    /menu de atendimento/,
    /numero de ticket/,
    /ticket (n[ºo.]*)?\s*#?\d+/,
    /ticket.*foi finalizado/,
    /nao identificamos seu contato em nossa base/,
  ];

  if (explicitAutomationPatterns.some(pattern => pattern.test(t))) return true;

  // Uma apresentação pessoal acompanhada de oferta direta de atendimento não é,
  // sozinha, evidência de automação (ex.: "sou o Evandro e estarei atendendo").
  const humanIntroduction =
    /\bsou (?:o|a) [a-z]{2,}\b.*\b(?:estarei|estou|vou|irei)\b.*\b(?:prestando|realizando|fazendo|dando|atendendo|atendimento)\b/;
  if (humanIntroduction.test(t)) return false;

  const contextualAutomationPatterns = [
    /nosso horario de atendimento/,
    /horario de atendimento e/,
    /bem[- ]?vindo.*atendimento/,
    /obrigad[oa] por entrar em contato.*(em breve|horario|atendimento|retorn)/,
    /agradecemos (seu|o) contato.*(em breve|horario|atendimento|retorn)/,
    /recebemos sua mensagem.*(em breve|horario|atendimento|retorn)/,
    /sua mensagem (ja )?(chegou|foi recebida).*(em breve|horario|atendimento|retorn|instantes)/,
    /qual seu nome e (sua )?necessidade/,
    /conte (um pouco )?mais sobre o que voce precisa/,
    /para que possamos te ajudar com agilidade/,
    /novo atendimento/,
  ];

  if (contextualAutomationPatterns.some(pattern => pattern.test(t))) return true;

  const exactShortReplies = [
    "ola! em que posso ajudar?",
    "ola, em que posso ajudar?",
    "ola! como posso ajudar?",
    "ola, como posso ajudar?",
    "oi! em que posso ajudar?",
    "oi, em que posso ajudar?",
    "oi! como posso ajudar?",
    "oi, como posso ajudar?",
  ];

  if (exactShortReplies.includes(t)) return true;

  const numberedOptions = (t.match(/(?:^|\s)[1-9]\s*[-.)]/g) || []).length;
  if (numberedOptions >= 3 && /(departamento|setor|atendimento|opcao|digite)/.test(t)) return true;

  return false;
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

          if(classification==="human"){
            const localDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(receivedAt));
            const leadUpdate: Record<string, unknown> = {
              status:"replied",
              last_contact_date:localDate,
              updated_at:new Date().toISOString()
            };
            if(lead.status==="lost")leadUpdate.lost_from_status=null;
            const {error:updateError}=await admin.from("leads").update(leadUpdate)
              .eq("id",lead.id).eq("organization_id",numberRow.organization_id)
              .neq("status","discarded");
            if(updateError)throw updateError;
          }
        }
      }
    }
    return json({ok:true});
  }catch(error){
    return json({error:error instanceof Error?error.message:String(error)},500);
  }
});