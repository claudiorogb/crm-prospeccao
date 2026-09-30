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
  let d = digits(value);
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

  const conversationId = String(body?.conversation_id || "");
  if (!conversationId) return json({ error: "conversation_id is required" }, 400);

  const { data: conversation, error: conversationError } = await admin
    .from("whatsapp_conversations")
    .select("id,organization_id,whatsapp_number_id,lead_id,provider,contact_phone,contact_name,status")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (conversationError || !conversation) return json({ error: "Conversation not found" }, 404);

  if (action === "mark_read") {
    const { error } = await admin
      .from("whatsapp_conversations")
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
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

  if (action !== "send_message") return json({ error: "Unsupported action" }, 400);

  const text = String(body?.text || "").trim();
  if (!text) return json({ error: "Message is empty" }, 400);
  if (text.length > 4096) return json({ error: "Message exceeds 4096 characters" }, 400);

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
  let providerMessageId = "";
  let deliveryStatus = "sent";

  try {
    if (provider === "evolution") {
      const apiKey = Deno.env.get("EVOLUTION_API_KEY");
      const baseUrl = Deno.env.get("EVOLUTION_API_URL") || "https://evolution-api-production-f25e4.up.railway.app";
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

      const { data: secret, error: secretError } = await admin.rpc("read_whatsapp_provider_secret", {
        p_number_id: numberRow.id,
      });
      if (secretError || !secret) throw new Error("Meta credential is unavailable");

      const response = await fetch(
        `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(numberRow.provider_phone_number_id)}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${secret}`,
          },
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