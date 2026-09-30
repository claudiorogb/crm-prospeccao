import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value: unknown) {
  const d = digits(value);
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function brazilDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

async function providerJson(response: Response) {
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || data?.error || raw || `HTTP ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

function mediaTypeFromMime(mime: string) {
  const value = String(mime || "").toLowerCase();
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  return "document";
}

function base64Bytes(value: string) {
  const clean = String(value || "").replace(/^data:[^;]+;base64,/, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeFileName(value: string) {
  return String(value || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "arquivo";
}

async function storeMedia(admin: any, path: string, base64: string, mimeType: string) {
  const bytes = base64Bytes(base64);
  const { error } = await admin.storage
    .from("whatsapp-media")
    .upload(path, bytes, { contentType: mimeType || "application/octet-stream", upsert: true });
  if (error) throw error;
  const { data, error: signedError } = await admin.storage
    .from("whatsapp-media")
    .createSignedUrl(path, 60 * 60);
  if (signedError) throw signedError;
  return data?.signedUrl || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "Server not configured" }, 503);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = authHeader.slice(7);
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  const user = userResult?.user;
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const organizationId = String(body?.organization_id || "");
  const action = String(body?.action || "");
  if (!organizationId || !action) return json({ error: "organization_id and action are required" }, 400);

  const { data: membership } = await admin
    .from("organization_members")
    .select("role,is_active,deleted_at")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (!membership) return json({ error: "Forbidden" }, 403);

  if (action === "start_conversation") {
    const whatsappNumberId = String(body?.whatsapp_number_id || "");
    const phone = normalizePhone(body?.phone);
    const leadIdRaw = String(body?.lead_id || "");
    const contactNameRaw = String(body?.contact_name || "").trim();

    if (!whatsappNumberId) return json({ error: "Selecione o número de WhatsApp remetente." }, 400);
    if (!phone || phone.length < 12) return json({ error: "Informe um número de WhatsApp válido com DDD." }, 400);

    const { data: numberRow, error: numberError } = await admin
      .from("whatsapp_numbers")
      .select("id,provider,is_active,deleted_at")
      .eq("id", whatsappNumberId)
      .eq("organization_id", organizationId)
      .eq("provider", "evolution")
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (numberError || !numberRow) return json({ error: "Número de WhatsApp não disponível." }, 409);

    let leadId: string | null = leadIdRaw || null;
    let contactName = contactNameRaw || null;

    if (leadId) {
      const { data: lead, error: leadError } = await admin
        .from("leads")
        .select("id,business_name,contact_name,phone,whatsapp_phone")
        .eq("id", leadId)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .maybeSingle();

      if (leadError || !lead) return json({ error: "Lead não encontrado." }, 404);
      contactName = contactName || String(lead.contact_name || lead.business_name || "").trim() || null;
    }

    const { data: existing, error: existingError } = await admin
      .from("whatsapp_conversations")
      .select("id,lead_id,contact_name,status")
      .eq("organization_id", organizationId)
      .eq("whatsapp_number_id", whatsappNumberId)
      .eq("contact_phone", phone)
      .maybeSingle();

    if (existingError) return json({ error: existingError.message }, 500);

    if (existing?.id) {
      const patch: any = {
        status: "open",
        updated_at: new Date().toISOString(),
      };
      if (!existing.lead_id && leadId) patch.lead_id = leadId;
      if ((!existing.contact_name || contactNameRaw) && contactName) patch.contact_name = contactName;

      const { data: updated, error: updateError } = await admin
        .from("whatsapp_conversations")
        .update(patch)
        .eq("id", existing.id)
        .eq("organization_id", organizationId)
        .select("id,lead_id,contact_phone,contact_name")
        .single();

      if (updateError || !updated) return json({ error: updateError?.message || "Não foi possível abrir a conversa." }, 500);
      return json({ ok: true, conversation: updated, existing: true });
    }

    const { data: created, error: createError } = await admin
      .from("whatsapp_conversations")
      .insert({
        organization_id: organizationId,
        whatsapp_number_id: whatsappNumberId,
        lead_id: leadId,
        provider: "evolution",
        contact_phone: phone,
        contact_name: contactName,
        status: "open",
        unread_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id,lead_id,contact_phone,contact_name")
      .single();

    if (createError || !created) return json({ error: createError?.message || "Não foi possível iniciar a conversa." }, 500);
    return json({ ok: true, conversation: created, existing: false });
  }

  const conversationId = String(body?.conversation_id || "");
  if (!conversationId) return json({ error: "conversation_id is required" }, 400);

  const { data: conversation, error: conversationError } = await admin
    .from("whatsapp_conversations")
    .select("id,organization_id,whatsapp_number_id,lead_id,provider,contact_phone,contact_name,status,assigned_to")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (conversationError || !conversation) return json({ error: "Conversation not found" }, 404);

  if (action === "mark_read") {
    const now = new Date().toISOString();
    const { error } = await admin
      .from("whatsapp_conversations")
      .update({ unread_count: 0, last_read_at: now, updated_at: now })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "set_status") {
    const status = String(body?.status || "");
    if (!["open", "archived"].includes(status)) return json({ error: "Invalid status" }, 400);
    const { error } = await admin
      .from("whatsapp_conversations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status });
  }

  if (action === "rename_contact") {
    const name = String(body?.name || "").trim();
    if (!name || name.length > 120) return json({ error: "Informe um nome válido." }, 400);
    const now = new Date().toISOString();
    const { error } = await admin.from("whatsapp_conversations")
      .update({ contact_name: name, updated_at: now })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
    if (error) return json({ error: error.message }, 500);

    if (conversation.lead_id) {
      const { data: lead } = await admin.from("leads")
        .select("business_name")
        .eq("id", conversation.lead_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      const patch: any = { contact_name: name, updated_at: now };
      if (String(lead?.business_name || "").startsWith("Contato WhatsApp")) patch.business_name = name;
      await admin.from("leads").update(patch)
        .eq("id", conversation.lead_id)
        .eq("organization_id", organizationId);
    }
    return json({ ok: true, name });
  }

  if (action === "assign_to") {
    const assignedTo = body?.user_id ? String(body.user_id) : null;
    if (assignedTo) {
      const { data: member } = await admin.from("organization_members")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("user_id", assignedTo)
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle();
      if (!member) return json({ error: "Usuário não pertence a esta organização." }, 400);
    }
    const { error } = await admin.from("whatsapp_conversations")
      .update({ assigned_to: assignedTo, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, assigned_to: assignedTo });
  }

  if (action === "associate_lead") {
    const leadId = String(body?.lead_id || "");
    if (!leadId) return json({ error: "lead_id is required" }, 400);
    const { data: lead, error: leadError } = await admin.from("leads")
      .select("id,business_name,contact_name")
      .eq("id", leadId)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (leadError || !lead) return json({ error: "Lead not found" }, 404);

    const name = String(lead.contact_name || lead.business_name || conversation.contact_name || "").trim() || null;
    const now = new Date().toISOString();
    const { error } = await admin.from("whatsapp_conversations")
      .update({ lead_id: leadId, contact_name: name, updated_at: now })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
    if (error) return json({ error: error.message }, 500);

    await admin.from("whatsapp_messages")
      .update({ lead_id: leadId })
      .eq("conversation_id", conversationId)
      .eq("organization_id", organizationId);

    return json({ ok: true, lead_id: leadId, name });
  }

  if (action === "create_lead") {
    if (conversation.lead_id) return json({ ok: true, lead_id: conversation.lead_id, existing: true });

    const phone = normalizePhone(conversation.contact_phone);
    const { data: candidateRows, error: candidateError } = await admin
      .from("leads")
      .select("id,phone,whatsapp_phone,deleted_at")
      .eq("organization_id", organizationId)
      .is("deleted_at", null);

    if (candidateError) return json({ error: candidateError.message }, 500);

    const existing = (candidateRows || []).find((lead: any) =>
      [normalizePhone(lead.phone), normalizePhone(lead.whatsapp_phone)].filter(Boolean).includes(phone)
    );

    let leadId = existing?.id || null;

    if (!leadId) {
      const contactName = String(conversation.contact_name || "").trim();
      const fallbackName = phone ? `Contato WhatsApp ${phone.slice(-4)}` : "Contato WhatsApp";
      const { data: created, error: createError } = await admin
        .from("leads")
        .insert({
          organization_id: organizationId,
          business_name: contactName || fallbackName,
          segment: "WhatsApp",
          phone: phone || conversation.contact_phone,
          whatsapp_phone: phone || conversation.contact_phone,
          contact_name: contactName || null,
          status: "new",
          source: "other",
          customer_origin: "WhatsApp",
          captured_by: user.id,
          capture_notes: "Contato criado a partir de uma conversa recebida pelo WhatsApp.",
        })
        .select("id")
        .single();

      if (createError || !created) return json({ error: createError?.message || "Unable to create lead" }, 500);
      leadId = created.id;
    }

    const now = new Date().toISOString();
    await admin
      .from("whatsapp_conversations")
      .update({ lead_id: leadId, updated_at: now })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);

    await admin
      .from("whatsapp_messages")
      .update({ lead_id: leadId })
      .eq("conversation_id", conversationId)
      .eq("organization_id", organizationId)
      .is("lead_id", null);

    return json({ ok: true, lead_id: leadId, existing: Boolean(existing) });
  }

  const { data: numberRow, error: numberError } = await admin
    .from("whatsapp_numbers")
    .select("id,provider,phone_e164,connection_status,evolution_instance_name,provider_phone_number_id,credential_configured,is_active,deleted_at")
    .eq("id", conversation.whatsapp_number_id)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (numberError || !numberRow) return json({ error: "WhatsApp number not available" }, 409);

  const provider = String(numberRow.provider || conversation.provider || "evolution");
  const apiKey = Deno.env.get("EVOLUTION_API_KEY");
  const baseUrl = Deno.env.get("EVOLUTION_API_URL") || "https://evolution-api-production-f25e4.up.railway.app";

  if (action === "get_media") {
    const messageId = Number(body?.message_id || 0);
    if (!Number.isFinite(messageId) || messageId <= 0) return json({ error: "message_id is required" }, 200);

    const { data: message, error: messageError } = await admin.from("whatsapp_messages")
      .select("id,provider_message_id,message_type,media_metadata,provider,direction")
      .eq("id", messageId)
      .eq("conversation_id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (messageError || !message) return json({ error: "Mensagem de mídia não encontrada." }, 200);
    if (message.provider !== "evolution" || !numberRow.evolution_instance_name || !apiKey) {
      return json({ error: "Mídia indisponível para esta conexão." }, 200);
    }

    const existingPath = String(message.media_metadata?.storage_path || "");
    if (existingPath) {
      const { data, error } = await admin.storage.from("whatsapp-media").createSignedUrl(existingPath, 60 * 60);
      if (!error && data?.signedUrl) {
        return json({
          ok: true,
          signed_url: data.signedUrl,
          mimetype: message.media_metadata?.mime_type || null,
          file_name: message.media_metadata?.file_name || null,
          media_type: message.message_type,
          caption: message.media_metadata?.caption || null,
        });
      }
    }

    let providerMessage = message.media_metadata?.provider_message || null;

    if (!providerMessage) {
      const { data: event } = await admin.from("whatsapp_inbound_events")
        .select("raw_event")
        .eq("organization_id", organizationId)
        .eq("provider_message_id", message.provider_message_id)
        .maybeSingle();
      providerMessage = event?.raw_event?.data || event?.raw_event || null;
    }

    if (!providerMessage) {
      try {
        const findResponse = await fetch(
          `${baseUrl}/chat/findMessages/${encodeURIComponent(numberRow.evolution_instance_name)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: apiKey },
            body: JSON.stringify({
              where: { key: { id: message.provider_message_id } },
              limit: 1,
            }),
          }
        );
        if (findResponse.ok) {
          const found = await findResponse.json();
          providerMessage =
            found?.messages?.records?.[0] ||
            found?.messages?.[0] ||
            found?.records?.[0] ||
            found?.[0] ||
            null;
        }
      } catch {
        // O fallback abaixo exibirá uma mensagem amigável.
      }
    }

    if (!providerMessage) {
      return json({ error: "Esta mídia antiga não pôde ser recuperada. Novas mídias ficarão armazenadas para abertura no CRM." }, 200);
    }

    try {
      const response = await fetch(
        `${baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(numberRow.evolution_instance_name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: apiKey },
          body: JSON.stringify({ message: providerMessage }),
        }
      );
      const data = await providerJson(response);
      const mediaBase64 = String(data?.base64 || "");
      const mimeType = String(data?.mimetype || message.media_metadata?.mime_type || "application/octet-stream");
      const fileName = safeFileName(data?.fileName || message.media_metadata?.file_name || `${message.message_type}-${message.id}`);
      if (!mediaBase64) return json({ error: "A Evolution não retornou o conteúdo desta mídia." }, 200);

      const storagePath = `${organizationId}/${conversationId}/${message.provider_message_id}-${fileName}`;
      const signedUrl = await storeMedia(admin, storagePath, mediaBase64, mimeType);

      await admin.from("whatsapp_messages")
        .update({
          media_metadata: {
            ...(message.media_metadata || {}),
            storage_path: storagePath,
            file_name: fileName,
            mime_type: mimeType,
          }
        })
        .eq("id", message.id)
        .eq("organization_id", organizationId);

      return json({
        ok: true,
        signed_url: signedUrl,
        mimetype: mimeType,
        file_name: fileName,
        media_type: data?.mediaType || message.message_type,
        caption: data?.caption || message.media_metadata?.caption || null,
      });
    } catch (error) {
      return json({
        error: `Não foi possível abrir esta mídia: ${error instanceof Error ? error.message : String(error)}`
      }, 200);
    }
  }

  if (action === "send_media") {
    if (provider !== "evolution") return json({ error: "Envio de anexos disponível atualmente na Evolution API." }, 409);
    if (!apiKey || !numberRow.evolution_instance_name) return json({ error: "Evolution API not configured for this number" }, 409);

    const fileName = String(body?.file_name || "arquivo").trim().slice(0, 180);
    const mimeType = String(body?.mime_type || "application/octet-stream").trim();
    const caption = String(body?.caption || "").trim().slice(0, 4096);
    const base64 = String(body?.base64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!base64) return json({ error: "Arquivo vazio." }, 400);
    const approximateBytes = Math.floor(base64.length * 3 / 4);
    if (approximateBytes > 8 * 1024 * 1024) return json({ error: "O anexo deve ter no máximo 8 MB." }, 413);

    const messageType = mediaTypeFromMime(mimeType);
    let providerMessageId = "";
    try {
      let response: Response;
      if (messageType === "audio") {
        response = await fetch(
          `${baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(numberRow.evolution_instance_name)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: apiKey },
            body: JSON.stringify({
              number: normalizePhone(conversation.contact_phone),
              audio: base64,
              encoding: true,
            }),
          }
        );
      } else {
        response = await fetch(
          `${baseUrl}/message/sendMedia/${encodeURIComponent(numberRow.evolution_instance_name)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: apiKey },
            body: JSON.stringify({
              number: normalizePhone(conversation.contact_phone),
              mediatype: messageType,
              mimetype: mimeType,
              caption,
              media: base64,
              fileName,
            }),
          }
        );
      }
      const data = await providerJson(response);
      providerMessageId = String(data?.key?.id || data?.messageId || data?.id || "");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }

    if (!providerMessageId) providerMessageId = `local-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const preview = caption || (messageType === "image" ? "Imagem enviada" : messageType === "video" ? "Vídeo enviado" : messageType === "audio" ? "Áudio enviado" : "Documento enviado");

    const storedFileName = safeFileName(fileName);
    const storagePath = `${organizationId}/${conversationId}/${providerMessageId}-${storedFileName}`;
    try {
      await storeMedia(admin, storagePath, base64, mimeType);
    } catch {
      // O envio do WhatsApp não deve falhar se apenas o cache de mídia ficar indisponível.
    }

    const { error: insertError } = await admin.from("whatsapp_messages").insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      whatsapp_number_id: numberRow.id,
      lead_id: conversation.lead_id || null,
      provider: "evolution",
      provider_message_id: providerMessageId,
      direction: "outbound",
      message_type: messageType,
      text_body: caption || null,
      media_metadata: { file_name: storedFileName, mime_type: mimeType, caption: caption || null, storage_path: storagePath },
      delivery_status: "sent",
      is_automatic: false,
      source: "crm",
      sent_by_user_id: user.id,
      occurred_at: now,
    });
    if (insertError) return json({ error: insertError.message }, 500);

    await admin.from("whatsapp_conversations")
      .update({
        last_message_at: now,
        last_message_preview: preview.slice(0, 240),
        last_outbound_at: now,
        updated_at: now,
      })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);

    if (conversation.lead_id) {
      await admin.from("activities").insert({
        organization_id: organizationId,
        lead_id: conversation.lead_id,
        activity_type: "message_sent",
        channel: "whatsapp",
        notes: `${preview} pela Central WhatsApp.`,
        occurred_at: now,
        created_by: user.id,
      });
      await admin.from("leads").update({
        last_contact_date: brazilDate(new Date()),
        last_contacted_at: now,
        updated_at: now,
      }).eq("id", conversation.lead_id).eq("organization_id", organizationId);
    }

    return json({ ok: true, provider: "evolution", provider_message_id: providerMessageId, message_type: messageType });
  }

  if (action !== "send_message") return json({ error: "Unsupported action" }, 400);

  const text = String(body?.text || "").trim();
  if (!text) return json({ error: "Message is empty" }, 400);
  if (text.length > 4096) return json({ error: "Message exceeds 4096 characters" }, 400);

  let providerMessageId = "";
  const deliveryStatus = "sent";

  try {
    if (provider === "evolution") {
      if (!apiKey || !numberRow.evolution_instance_name) throw new Error("Evolution API not configured for this number");
      const response = await fetch(
        `${baseUrl}/message/sendText/${encodeURIComponent(numberRow.evolution_instance_name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: apiKey },
          body: JSON.stringify({ number: normalizePhone(conversation.contact_phone), text }),
        }
      );
      const data = await providerJson(response);
      providerMessageId = String(data?.key?.id || data?.messageId || data?.id || "");
    } else if (provider === "meta") {
      const graphVersion = Deno.env.get("META_GRAPH_API_VERSION");
      if (!graphVersion) throw new Error("META_GRAPH_API_VERSION is not configured");
      if (!numberRow.provider_phone_number_id || !numberRow.credential_configured) {
        throw new Error("Meta WhatsApp connection is incomplete");
      }
      const { data: secret, error: secretError } = await admin.rpc("read_whatsapp_provider_secret", { p_number_id: numberRow.id });
      if (secretError || !secret) throw new Error("Meta credential is unavailable");
      const response = await fetch(
        `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(numberRow.provider_phone_number_id)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: normalizePhone(conversation.contact_phone),
            type: "text",
            text: { preview_url: false, body: text },
          }),
        }
      );
      const data = await providerJson(response);
      providerMessageId = String(data?.messages?.[0]?.id || "");
    } else {
      throw new Error("Unsupported WhatsApp provider");
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }

  if (!providerMessageId) providerMessageId = `local-${crypto.randomUUID()}`;

  const now = new Date().toISOString();
  const { error: messageError } = await admin.from("whatsapp_messages").insert({
    organization_id: organizationId,
    conversation_id: conversationId,
    whatsapp_number_id: numberRow.id,
    lead_id: conversation.lead_id || null,
    provider,
    provider_message_id: providerMessageId,
    direction: "outbound",
    message_type: "text",
    text_body: text,
    media_metadata: {},
    delivery_status: deliveryStatus,
    is_automatic: false,
    source: "crm",
    sent_by_user_id: user.id,
    occurred_at: now,
  });
  if (messageError) return json({ error: messageError.message }, 500);

  await admin
    .from("whatsapp_conversations")
    .update({
      provider,
      last_message_at: now,
      last_message_preview: text.slice(0, 240),
      last_outbound_at: now,
      updated_at: now,
    })
    .eq("id", conversationId)
    .eq("organization_id", organizationId);

  if (conversation.lead_id) {
    await admin.from("activities").insert({
      organization_id: organizationId,
      lead_id: conversation.lead_id,
      activity_type: "message_sent",
      channel: "whatsapp",
      notes: `Mensagem enviada pela Central WhatsApp: ${text.slice(0, 3000)}`,
      occurred_at: now,
      created_by: user.id,
    });

    await admin.from("leads").update({
      last_contact_date: brazilDate(new Date()),
      last_contacted_at: now,
      updated_at: now,
    }).eq("id", conversation.lead_id).eq("organization_id", organizationId);
  }

  return json({ ok: true, provider, provider_message_id: providerMessageId });
});
