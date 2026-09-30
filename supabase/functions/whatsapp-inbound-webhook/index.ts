import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const EVOLUTION_URL = "https://evolution-api-production-f25e4.up.railway.app";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value: unknown) {
  let d = digits(value);
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function extractText(data: any) {
  const message = data?.message || data?.data?.message || {};
  const candidates = [
    message?.conversation,
    message?.extendedTextMessage?.text,
    message?.imageMessage?.caption,
    message?.videoMessage?.caption,
    message?.documentMessage?.caption,
    message?.buttonsResponseMessage?.selectedDisplayText,
    message?.listResponseMessage?.title,
    message?.templateButtonReplyMessage?.selectedDisplayText,
    data?.body,
    data?.text,
  ];
  return candidates.find(v => typeof v === "string" && v.trim())?.trim() || "";
}

function extractMessageType(data: any) {
  const explicit = String(data?.messageType || data?.data?.messageType || "").toLowerCase();
  const message = data?.message || data?.data?.message || {};
  const keys = Object.keys(message || {}).map(key => key.toLowerCase());
  const joined = [explicit, ...keys].join(" ");
  if (joined.includes("image")) return "image";
  if (joined.includes("video")) return "video";
  if (joined.includes("audio")) return "audio";
  if (joined.includes("document")) return "document";
  if (joined.includes("sticker")) return "sticker";
  if (joined.includes("contact")) return "contact";
  if (joined.includes("location")) return "location";
  if (joined.includes("conversation") || joined.includes("extendedtext")) return "text";
  return extractText(data) ? "text" : "unknown";
}

function extractMediaMetadata(data: any) {
  const type = extractMessageType(data);
  if (!["image","video","audio","document","sticker"].includes(type)) return {};
  const message = data?.message || data?.data?.message || {};
  const content =
    message?.imageMessage ||
    message?.videoMessage ||
    message?.audioMessage ||
    message?.documentMessage ||
    message?.documentWithCaptionMessage?.message?.documentMessage ||
    message?.stickerMessage ||
    {};
  return {
    file_name: content?.fileName || content?.filename || null,
    mime_type: content?.mimetype || content?.mime_type || null,
    caption: content?.caption || null,
    file_length: content?.fileLength ? String(content.fileLength) : null,
    seconds: content?.seconds ?? null,
    width: content?.width ?? null,
    height: content?.height ?? null,
    provider_message: {
      key: data?.key || data?.data?.key || null,
      message: data?.message || data?.data?.message || null,
      messageType: data?.messageType || data?.data?.messageType || null,
      messageTimestamp: data?.messageTimestamp || data?.timestamp || null,
    },
  };
}

function extractContactName(data: any) {
  const candidates = [
    data?.pushName,
    data?.pushname,
    data?.senderName,
    data?.notifyName,
    data?.data?.pushName,
    data?.data?.pushname,
  ];
  return String(candidates.find(value => typeof value === "string" && value.trim()) || "").trim();
}

function mapDeliveryStatus(value: any) {
  const raw = String(value ?? "").toUpperCase();
  if (["4","READ","READ_ACK"].includes(raw)) return "read";
  if (["5","PLAYED"].includes(raw)) return "played";
  if (["3","DELIVERY_ACK","DELIVERED"].includes(raw)) return "delivered";
  if (["2","SERVER_ACK","SENT"].includes(raw)) return "sent";
  if (["1","PENDING"].includes(raw)) return "pending";
  if (raw === "ERROR" || raw === "FAILED") return "failed";
  return raw ? raw.toLowerCase() : "sent";
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isAutomaticReply(text: string) {
  const t = normalizeText(text);
  if (!t) return false;

  const strongPatterns = [
    /mensagem automatica/,
    /resposta automatica/,
    /atendimento automatico/,
    /esta e uma mensagem automatica/,
    /esta e uma resposta automatica/,
    /nao responda esta mensagem/,
    /assistente virtual/,
    /sou (o|a) assistente virtual/,
    /robo de atendimento/,
    /bot de atendimento/,
    /fora do horario de atendimento/,
    /nosso horario de atendimento/,
    /horario de atendimento e/,
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
    /bem[- ]?vindo.*atendimento/,
    /obrigad[oa] por entrar em contato.*(em breve|horario|atendimento|retorn)/,
    /agradecemos (seu|o) contato.*(em breve|horario|atendimento|retorn)/,
    /agradece(mos)? (o |seu )?contato/,
    /recebemos sua mensagem.*(em breve|horario|atendimento|retorn)/,
    /sua mensagem (ja )?(chegou|foi recebida).*(em breve|horario|atendimento|retorn|instantes)/,
    /qual seu nome e (sua )?necessidade/,
    /conte (um pouco )?mais sobre o que voce precisa/,
    /para que possamos te ajudar com agilidade/,
    /numero de ticket/,
    /ticket (n[ºo.]*)?\s*#?\d+/,
    /ticket.*foi finalizado/,
    /novo atendimento/,
    /nao identificamos seu contato em nossa base/,
  ];

  if (strongPatterns.some(pattern => pattern.test(t))) return true;

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
function eventName(payload: any) {
  return String(payload?.event || payload?.type || "").toUpperCase().replace(/[.\-]/g, "_");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "Server not configured" }, 503);

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const url = new URL(req.url);

  if (url.searchParams.get("configure") === "1") {
    const setupToken = url.searchParams.get("setup") || "";
    const { data: setupSecret } = await admin
      .from("system_runtime_secrets")
      .select("secret_hash")
      .eq("name", "whatsapp_inbound_setup")
      .maybeSingle();

    if (!setupToken || !setupSecret?.secret_hash || (await sha256(setupToken)) !== setupSecret.secret_hash) {
      return json({ error: "Unauthorized" }, 401);
    }

    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!evolutionKey) return json({ error: "Evolution API not configured" }, 503);

    const { data: numbers, error: numberListError } = await admin
      .from("whatsapp_numbers")
      .select("id,evolution_instance_name")
      .eq("is_active", true)
      .is("deleted_at", null)
      .not("evolution_instance_name", "is", null);

    if (numberListError) return json({ error: "Unable to list WhatsApp instances" }, 503);

    const webhookUrl = "https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/whatsapp-inbound-webhook?token=pJVRbLZllIz2WSSdWtrJV-GVstV33ld7Xix5Mc2PIos";
    const results: any[] = [];

    for (const item of numbers || []) {
      const instanceName = String(item.evolution_instance_name || "");
      if (!instanceName) continue;
      try {
        const response = await fetch(`${EVOLUTION_URL}/webhook/set/${encodeURIComponent(instanceName)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: evolutionKey },
          body: JSON.stringify({
            webhook: {
              enabled: true,
              url: webhookUrl,
              webhookByEvents: false,
              webhookBase64: false,
              events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONTACTS_UPSERT", "CONTACTS_UPDATE", "CONNECTION_UPDATE"],
            },
          }),
        });
        const bodyText = await response.text();
        results.push({ instance: instanceName, ok: response.ok, status: response.status, detail: bodyText.slice(0, 500) });
      } catch (error) {
        results.push({ instance: instanceName, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return json({ ok: true, configured: results.filter(r => r.ok).length, results });
  }

  const token = url.searchParams.get("token") || "";
  const { data: secretRow } = await admin
    .from("system_runtime_secrets")
    .select("secret_hash")
    .eq("name", "whatsapp_inbound_webhook")
    .maybeSingle();

  if (!token || !secretRow?.secret_hash || (await sha256(token)) !== secretRow.secret_hash) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const ev = eventName(payload);
  const data = payload?.data || payload;
  const instanceName = String(payload?.instance || data?.instance || payload?.instanceName || "");

  if (ev === "MESSAGES_UPDATE") {
    if (!instanceName) return json({ ok: true, ignored: true, reason: "missing_instance" });
    const { data: numberRow } = await admin
      .from("whatsapp_numbers")
      .select("id,organization_id")
      .eq("evolution_instance_name", instanceName)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (!numberRow) return json({ ok: true, ignored: true, reason: "unknown_instance" });

    const updates = Array.isArray(data) ? data : [data];
    for (const item of updates) {
      const key = item?.key || item?.data?.key || {};
      const messageId = String(key?.id || item?.id || item?.messageId || "");
      if (!messageId) continue;
      const status = mapDeliveryStatus(item?.update?.status ?? item?.status ?? item?.data?.status);
      await admin.from("whatsapp_messages")
        .update({ delivery_status: status })
        .eq("organization_id", numberRow.organization_id)
        .eq("provider", "evolution")
        .eq("provider_message_id", messageId);
    }
    return json({ ok: true, updated: updates.length });
  }

  if (ev === "CONTACTS_UPSERT" || ev === "CONTACTS_UPDATE") {
    if (!instanceName) return json({ ok: true, ignored: true, reason: "missing_instance" });
    const { data: numberRow } = await admin
      .from("whatsapp_numbers")
      .select("id,organization_id")
      .eq("evolution_instance_name", instanceName)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (!numberRow) return json({ ok: true, ignored: true, reason: "unknown_instance" });

    const contacts = Array.isArray(data) ? data : [data];
    let updated = 0;
    for (const contact of contacts) {
      const jid = String(contact?.remoteJid || contact?.id || contact?.jid || "");
      if (!jid || jid.includes("@g.us")) continue;
      const phone = normalizePhone(jid.split("@")[0]);
      const name = String(contact?.pushName || contact?.name || contact?.notify || contact?.verifiedName || "").trim();
      if (!phone || !name) continue;

      const { data: conversation } = await admin.from("whatsapp_conversations")
        .select("id,lead_id")
        .eq("organization_id", numberRow.organization_id)
        .eq("whatsapp_number_id", numberRow.id)
        .eq("contact_phone", phone)
        .maybeSingle();

      if (conversation?.id) {
        await admin.from("whatsapp_conversations")
          .update({ contact_name: name, updated_at: new Date().toISOString() })
          .eq("id", conversation.id)
          .eq("organization_id", numberRow.organization_id);

        if (conversation.lead_id) {
          const { data: lead } = await admin.from("leads")
            .select("id,business_name")
            .eq("id", conversation.lead_id)
            .eq("organization_id", numberRow.organization_id)
            .maybeSingle();
          const patch: any = { contact_name: name, updated_at: new Date().toISOString() };
          if (String(lead?.business_name || "").startsWith("Contato WhatsApp")) patch.business_name = name;
          await admin.from("leads").update(patch)
            .eq("id", conversation.lead_id)
            .eq("organization_id", numberRow.organization_id);
        }
        updated++;
      }
    }
    return json({ ok: true, updated });
  }

  if (ev === "CONNECTION_UPDATE") {
    if (!instanceName) return json({ ok: true, ignored: true, reason: "missing_instance" });

    const { data: numberRow } = await admin
      .from("whatsapp_numbers")
      .select("id,organization_id")
      .eq("evolution_instance_name", instanceName)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (!numberRow) return json({ ok: true, ignored: true, reason: "unknown_instance" });

    const rawState = String(
      data?.state ||
      data?.status ||
      data?.instance?.state ||
      data?.instance?.status ||
      payload?.state ||
      "unknown"
    ).toLowerCase();

    const connected = rawState === "open";
    const terminalDisconnected = ["close", "closed", "disconnected", "logout"].includes(rawState);
    const now = new Date().toISOString();

    await admin.from("whatsapp_numbers").update({
      connection_status: connected ? "connected" : terminalDisconnected ? "disconnected" : rawState,
      evolution_connected_at: connected ? now : terminalDisconnected ? null : undefined,
      evolution_last_sync_at: now,
    }).eq("id", numberRow.id).eq("organization_id", numberRow.organization_id);

    if (terminalDisconnected) {
      await admin.from("outbound_batches").update({
        status: "paused",
        paused_at: now,
        updated_at: now,
      })
        .eq("organization_id", numberRow.organization_id)
        .eq("whatsapp_number_id", numberRow.id)
        .in("status", ["queued", "ready", "processing", "in_progress"]);
    }

    return json({ ok: true, connection_state: rawState, connected, terminal_disconnected: terminalDisconnected });
  }

  if (ev && ev !== "MESSAGES_UPSERT") return json({ ok: true, ignored: true, reason: "event" });

  const key = data?.key || data?.data?.key || {};

  const remoteJid = String(key?.remoteJid || data?.remoteJid || data?.sender || "");
  if (!remoteJid || remoteJid.includes("@g.us") || remoteJid.includes("@broadcast") || remoteJid.includes("status@")) {
    return json({ ok: true, ignored: true, reason: "non_direct_chat" });
  }

  const senderPhone = normalizePhone(remoteJid.split("@")[0]);
  if (!senderPhone) return json({ ok: true, ignored: true, reason: "missing_sender" });

  if (!instanceName) return json({ ok: true, ignored: true, reason: "missing_instance" });

  const { data: numberRow, error: numberError } = await admin
    .from("whatsapp_numbers")
    .select("id,organization_id")
    .eq("evolution_instance_name", instanceName)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (numberError || !numberRow) {
    return json({ ok: true, ignored: true, reason: "unknown_instance" });
  }

  const providerMessageId = String(key?.id || data?.messageId || data?.id || "");
  if (!providerMessageId) return json({ ok: true, ignored: true, reason: "missing_message_id" });

  if (key?.fromMe === true) {
    const text = extractText(data);
    const messageType = extractMessageType(data);
    const mediaMetadata = extractMediaMetadata(data);
    const occurredAtRaw = data?.messageTimestamp || data?.timestamp;
    const occurredAt = occurredAtRaw
      ? new Date(Number(occurredAtRaw) < 10_000_000_000 ? Number(occurredAtRaw) * 1000 : Number(occurredAtRaw)).toISOString()
      : new Date().toISOString();

    const { data: existingMessage } = await admin.from("whatsapp_messages")
      .select("id,source")
      .eq("organization_id", numberRow.organization_id)
      .eq("provider", "evolution")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (existingMessage?.id) {
      await admin.from("whatsapp_messages")
        .update({
          message_type: messageType,
          media_metadata: mediaMetadata,
          delivery_status: mapDeliveryStatus(data?.status || "sent"),
        })
        .eq("id", existingMessage.id)
        .eq("organization_id", numberRow.organization_id);
      return json({ ok: true, duplicate: true, enriched: true, direction: "outbound" });
    }

    const { data: leadRows } = await admin.from("leads")
      .select("id,phone,whatsapp_phone")
      .eq("organization_id", numberRow.organization_id)
      .is("deleted_at", null)
      .neq("status", "discarded");
    const matches = (leadRows || []).filter((lead: any) =>
      [normalizePhone(lead.whatsapp_phone), normalizePhone(lead.phone)].filter(Boolean).includes(senderPhone)
    );
    const leadId = matches.length === 1 ? matches[0].id : null;
    const contactName = extractContactName(data);
    const preview = (text || (messageType === "audio" ? "Áudio enviado pelo celular" : messageType === "image" ? "Imagem enviada pelo celular" : messageType === "video" ? "Vídeo enviado pelo celular" : messageType === "document" ? "Documento enviado pelo celular" : "Mensagem enviada pelo celular")).slice(0, 240);

    const { data: existingConversation } = await admin.from("whatsapp_conversations")
      .select("id,lead_id,contact_name")
      .eq("organization_id", numberRow.organization_id)
      .eq("whatsapp_number_id", numberRow.id)
      .eq("contact_phone", senderPhone)
      .maybeSingle();

    let conversation: any = existingConversation || null;
    if (existingConversation?.id) {
      const { data: updatedConversation, error: updateConversationError } = await admin.from("whatsapp_conversations")
        .update({
          lead_id: existingConversation.lead_id || leadId || null,
          contact_name: contactName || existingConversation.contact_name || null,
          provider: "evolution",
          status: "open",
          last_message_at: occurredAt,
          last_message_preview: preview,
          last_outbound_at: occurredAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingConversation.id)
        .eq("organization_id", numberRow.organization_id)
        .select("id,lead_id")
        .single();
      if (updateConversationError || !updatedConversation) {
        return json({ error: "Unable to sync outbound conversation" }, 503);
      }
      conversation = updatedConversation;
    } else {
      const { data: createdConversation, error: createConversationError } = await admin.from("whatsapp_conversations")
        .insert({
          organization_id: numberRow.organization_id,
          whatsapp_number_id: numberRow.id,
          lead_id: leadId,
          provider: "evolution",
          contact_phone: senderPhone,
          contact_name: contactName || null,
          status: "open",
          last_message_at: occurredAt,
          last_message_preview: preview,
          last_outbound_at: occurredAt,
          updated_at: new Date().toISOString(),
        })
        .select("id,lead_id")
        .single();
      if (createConversationError || !createdConversation) {
        return json({ error: "Unable to sync outbound conversation" }, 503);
      }
      conversation = createdConversation;
    }

    const { error: messageError } = await admin.from("whatsapp_messages").insert({
      organization_id: numberRow.organization_id,
      conversation_id: conversation.id,
      whatsapp_number_id: numberRow.id,
      lead_id: conversation.lead_id || leadId,
      provider: "evolution",
      provider_message_id: providerMessageId,
      direction: "outbound",
      message_type: messageType,
      text_body: text || null,
      media_metadata: mediaMetadata,
      delivery_status: mapDeliveryStatus(data?.status || "sent"),
      is_automatic: false,
      source: "phone",
      occurred_at: occurredAt,
    });
    if (messageError && !String(messageError.message || "").toLowerCase().includes("duplicate")) {
      return json({ error: "Unable to sync outbound message" }, 503);
    }

    if (conversation.lead_id || leadId) {
      const resolvedLeadId = conversation.lead_id || leadId;
      await admin.from("activities").insert({
        organization_id: numberRow.organization_id,
        lead_id: resolvedLeadId,
        activity_type: "message_sent",
        channel: "whatsapp",
        notes: text ? `Mensagem enviada pelo celular: ${text.slice(0, 3000)}` : `${preview}.`,
        occurred_at: occurredAt,
        created_by: null,
      });
      const localDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
      }).format(new Date(occurredAt));
      await admin.from("leads").update({
        last_contact_date: localDate,
        last_contacted_at: occurredAt,
        updated_at: new Date().toISOString(),
      }).eq("id", resolvedLeadId).eq("organization_id", numberRow.organization_id);
    }

    return json({ ok: true, direction: "outbound", lead_id: conversation.lead_id || leadId });
  }

  const { data: existing } = await admin
    .from("whatsapp_inbound_events")
    .select("id")
    .eq("organization_id", numberRow.organization_id)
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();

  if (existing?.id) return json({ ok: true, duplicate: true });

  const { data: leadRows, error: leadError } = await admin
    .from("leads")
    .select("id,status,phone,whatsapp_phone,campaign_id")
    .eq("organization_id", numberRow.organization_id)
    .is("deleted_at", null)
    .neq("status", "discarded");

  if (leadError) return json({ error: "Unable to resolve lead" }, 503);

  const candidates = (leadRows || []).filter((lead: any) => {
    const phones = [normalizePhone(lead.whatsapp_phone), normalizePhone(lead.phone)].filter(Boolean);
    return phones.includes(senderPhone);
  });

  const text = extractText(data);
  let classification = isAutomaticReply(text) ? "automatic" : "human";
  let lead: any = null;

  if (candidates.length === 1) {
    lead = candidates[0];
  } else if (candidates.length > 1) {
    classification = "ambiguous";
  } else {
    classification = "ignored";
  }

  const receivedAtRaw = data?.messageTimestamp || data?.timestamp;
  const receivedAt = receivedAtRaw
    ? new Date(Number(receivedAtRaw) < 10_000_000_000 ? Number(receivedAtRaw) * 1000 : Number(receivedAtRaw)).toISOString()
    : new Date().toISOString();

  const { error: eventError } = await admin.from("whatsapp_inbound_events").insert({
    organization_id: numberRow.organization_id,
    lead_id: lead?.id || null,
    whatsapp_number_id: numberRow.id,
    provider_message_id: providerMessageId,
    sender_phone: senderPhone,
    message_text: text || null,
    classification,
    received_at: receivedAt,
    raw_event: payload,
  });

  if (eventError && !String(eventError.message || "").toLowerCase().includes("duplicate")) {
    return json({ error: "Unable to record inbound event" }, 503);
  }

  const messageType = extractMessageType(data);
  const mediaMetadata = extractMediaMetadata(data);
  const contactName = extractContactName(data);
  await admin.from("whatsapp_messages")
    .update({ message_type: messageType, media_metadata: mediaMetadata, source: "provider" })
    .eq("organization_id", numberRow.organization_id)
    .eq("provider", "evolution")
    .eq("provider_message_id", providerMessageId);

  if (contactName) {
    const { data: conversation } = await admin.from("whatsapp_conversations")
      .select("id,lead_id")
      .eq("organization_id", numberRow.organization_id)
      .eq("whatsapp_number_id", numberRow.id)
      .eq("contact_phone", senderPhone)
      .maybeSingle();
    if (conversation?.id) {
      await admin.from("whatsapp_conversations")
        .update({ contact_name: contactName, updated_at: new Date().toISOString() })
        .eq("id", conversation.id)
        .eq("organization_id", numberRow.organization_id);
    }
    if (lead?.id) {
      const { data: currentLead } = await admin.from("leads")
        .select("business_name")
        .eq("id", lead.id)
        .eq("organization_id", numberRow.organization_id)
        .maybeSingle();
      const patch: any = { contact_name: contactName, updated_at: new Date().toISOString() };
      if (String(currentLead?.business_name || "").startsWith("Contato WhatsApp")) patch.business_name = contactName;
      await admin.from("leads").update(patch)
        .eq("id", lead.id)
        .eq("organization_id", numberRow.organization_id);
    }
  }

  if (!lead) return json({ ok: true, classification, message_type: messageType });

  const notePrefix = classification === "automatic"
    ? "Resposta automática detectada (não alterou o funil)"
    : "Resposta recebida pelo WhatsApp";
  const note = text ? `${notePrefix}: ${text.slice(0, 3000)}` : notePrefix;

  await admin.from("activities").insert({
    organization_id: numberRow.organization_id,
    lead_id: lead.id,
    campaign_id: lead.campaign_id || null,
    activity_type: classification === "automatic" ? "auto_reply_received" : "reply_received",
    channel: "whatsapp",
    notes: note,
    occurred_at: receivedAt,
    created_by: null,
  });

  if (classification === "human" && ["new", "queued", "contacted"].includes(lead.status)) {
    const brazilDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(receivedAt));

    const { error: updateError } = await admin
      .from("leads")
      .update({
        status: "replied",
        last_contact_date: brazilDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.id)
      .eq("organization_id", numberRow.organization_id)
      .in("status", ["new", "queued", "contacted"]);

    if (updateError) return json({ error: "Unable to update lead" }, 503);
  }

  return json({ ok: true, classification, lead_id: lead.id });
});
