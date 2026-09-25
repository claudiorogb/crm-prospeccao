import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const TZ = "America/Sao_Paulo";
const DEFAULT_START = "08:00";
const DEFAULT_END = "18:00";
const DEFAULT_DAILY_LIMIT = 20;
const DEFAULT_DAYS = [1, 3, 5];

function normalizePhone(value: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function renderTemplate(body: string, lead: any) {
  return String(body || "")
    .replaceAll("{empresa}", lead?.business_name || "")
    .replaceAll("{cidade}", lead?.city || "")
    .replaceAll("{uf}", lead?.state || "")
    .replaceAll("{telefone}", lead?.phone || "")
    .replaceAll("{segmento}", lead?.segment || "");
}

function localDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateKey: string, days: number) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00-03:00`).getUTCDay();
}

function normalizeTime(value: unknown, fallback: string) {
  const text = String(value || fallback);
  const match = text.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function localTimeToUtc(dateKey: string, hhmm: string) {
  return new Date(`${dateKey}T${hhmm}:00-03:00`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const organizationId = String(body?.organization_id || "");
    const leadIds = Array.isArray(body?.lead_ids)
      ? [...new Set(body.lead_ids.map((x: unknown) => String(x)).filter(Boolean))]
      : [];

    if (!organizationId || !leadIds.length) {
      return new Response(JSON.stringify({ error: "organization_id and lead_ids are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (leadIds.length > 1000) {
      return new Response(JSON.stringify({ error: "Maximum 1000 leads per scheduling operation" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: membership }, { data: organization }, { data: systemAdmin }] = await Promise.all([
      admin
        .from("organization_members")
        .select("organization_id,is_active,deleted_at")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .maybeSingle(),
      admin
        .from("organizations")
        .select("id,is_active,deleted_at,is_sandbox")
        .eq("id", organizationId)
        .maybeSingle(),
      admin
        .from("system_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const hasMemberAccess = Boolean(membership?.is_active && !membership?.deleted_at);
    const hasSandboxAdminAccess = Boolean(systemAdmin && organization?.is_sandbox === true);
    if (!organization?.is_active || organization?.deleted_at || (!hasMemberAccess && !hasSandboxAdminAccess)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings, error: settingsError } = await admin
      .from("organization_settings")
      .select("whatsapp_send_interval_seconds,whatsapp_daily_send_limit,whatsapp_sending_paused,allowed_send_start,allowed_send_end,default_cadence_days")
      .eq("organization_id", organizationId)
      .single();

    if (settingsError || !settings) throw new Error("Organization settings not found");
    if (settings.whatsapp_sending_paused) {
      return new Response(JSON.stringify({ error: "WhatsApp sending is paused for this organization" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const intervalSeconds = Math.max(1, Number(settings.whatsapp_send_interval_seconds || 120));
    const dailyLimit = Math.max(1, Number(settings.whatsapp_daily_send_limit || DEFAULT_DAILY_LIMIT));
    const allowedStart = normalizeTime(settings.allowed_send_start, DEFAULT_START);
    const allowedEnd = normalizeTime(settings.allowed_send_end, DEFAULT_END);
    if (allowedStart >= allowedEnd) {
      return new Response(JSON.stringify({ error: "O horário inicial precisa ser anterior ao horário final." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allowedDays = Array.isArray(settings.default_cadence_days) && settings.default_cadence_days.length
      ? settings.default_cadence_days.map(Number).filter((n: number) => n >= 0 && n <= 6)
      : DEFAULT_DAYS;

    const { data: sender, error: senderError } = await admin
      .from("whatsapp_numbers")
      .select("id,alias,phone_e164,connection_status,credential_configured")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .eq("is_default", true)
      .maybeSingle();
    if (senderError) throw senderError;
    if (!sender) {
      return new Response(JSON.stringify({ error: "No active default WhatsApp number configured" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: leads, error: leadsError } = await admin
      .from("leads")
      .select("id,campaign_id,target_segment_id,business_name,segment,phone,city,state,status")
      .eq("organization_id", organizationId)
      .in("id", leadIds);
    if (leadsError) throw leadsError;

    const { data: deliveryStates, error: deliveryStatesError } = await admin
      .from("outbound_messages")
      .select("lead_id,status")
      .eq("organization_id", organizationId)
      .in("lead_id", leadIds)
      .in("status", ["queued", "ready", "processing", "failed"]);
    if (deliveryStatesError) throw deliveryStatesError;

    const activeDeliveryLeadIds = new Set(
      (deliveryStates || [])
        .filter((row: any) => ["queued", "ready", "processing"].includes(row.status))
        .map((row: any) => row.lead_id)
    );
    const failedDeliveryLeadIds = new Set(
      (deliveryStates || [])
        .filter((row: any) => row.status === "failed")
        .map((row: any) => row.lead_id)
    );
    const unresolvedFailedLeadIds = new Set(
      [...failedDeliveryLeadIds].filter((leadId: any) => !activeDeliveryLeadIds.has(leadId))
    );

    const targetIds = [...new Set((leads || []).map((l: any) => l.target_segment_id).filter(Boolean))];
    const { data: templates, error: templatesError } = targetIds.length
      ? await admin
          .from("message_templates")
          .select("id,target_segment_id,body,is_default_for_target,created_at")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .in("target_segment_id", targetIds)
          .order("is_default_for_target", { ascending: false })
          .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (templatesError) throw templatesError;

    const templateByTarget = new Map<string, any>();
    for (const template of templates || []) {
      if (!templateByTarget.has(template.target_segment_id)) templateByTarget.set(template.target_segment_id, template);
    }

    const eligible: any[] = [];
    const skipped: any[] = [];
    for (const lead of leads || []) {
      const phone = normalizePhone(lead.phone);
      const template = templateByTarget.get(lead.target_segment_id);
      if (["discarded", "won", "lost", "not_interested", "queued"].includes(lead.status)) {
        skipped.push({ lead_id: lead.id, reason: `status_${lead.status}` });
        continue;
      }
      if (unresolvedFailedLeadIds.has(lead.id)) {
        skipped.push({ lead_id: lead.id, reason: "unresolved_failed_message" });
        continue;
      }
      if (!phone) {
        skipped.push({ lead_id: lead.id, reason: "missing_phone" });
        continue;
      }
      if (!template) {
        skipped.push({ lead_id: lead.id, reason: "missing_template" });
        continue;
      }
      eligible.push({ lead, phone, template });
    }

    if (!eligible.length) {
      return new Response(JSON.stringify({ error: "No eligible leads to queue", skipped }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const historyStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: occupiedRows, error: occupiedError } = await admin
      .from("outbound_messages")
      .select("status,scheduled_for,sent_at,created_at")
      .eq("organization_id", organizationId)
      .in("status", ["queued", "ready", "processing", "sent"])
      .gte("created_at", historyStart);
    if (occupiedError) throw occupiedError;

    const occupiedCount = new Map<string, number>();
    const latestScheduled = new Map<string, number>();
    for (const row of occupiedRows || []) {
      const timestamp = row.status === "sent" ? row.sent_at : row.scheduled_for;
      if (!timestamp) continue;
      const d = new Date(timestamp);
      const key = localDateKey(d);
      occupiedCount.set(key, (occupiedCount.get(key) || 0) + 1);
      if (row.status !== "sent") {
        latestScheduled.set(key, Math.max(latestScheduled.get(key) || 0, d.getTime()));
      }
    }

    const scheduledDates: Date[] = [];
    let dateKey = localDateKey(now);
    let safety = 0;
    while (scheduledDates.length < eligible.length) {
      if (++safety > 5000) throw new Error("Could not allocate messages inside the configured schedule");
      if (!allowedDays.includes(weekday(dateKey))) {
        dateKey = addDays(dateKey, 1);
        continue;
      }

      let used = occupiedCount.get(dateKey) || 0;
      if (used >= dailyLimit) {
        dateKey = addDays(dateKey, 1);
        continue;
      }

      const dayStart = localTimeToUtc(dateKey, allowedStart);
      const dayEnd = localTimeToUtc(dateKey, allowedEnd);
      let candidateMs = dayStart.getTime();
      if (dateKey === localDateKey(now)) candidateMs = Math.max(candidateMs, now.getTime());
      const previousMs = latestScheduled.get(dateKey);
      if (previousMs) candidateMs = Math.max(candidateMs, previousMs + intervalSeconds * 1000);

      while (scheduledDates.length < eligible.length && used < dailyLimit && candidateMs <= dayEnd.getTime()) {
        scheduledDates.push(new Date(candidateMs));
        used += 1;
        occupiedCount.set(dateKey, used);
        latestScheduled.set(dateKey, candidateMs);
        candidateMs += intervalSeconds * 1000;
      }

      dateKey = addDays(dateKey, 1);
    }

    const startAt = scheduledDates[0];
    const campaignIds = [...new Set(eligible.map((x) => x.lead.campaign_id).filter(Boolean))];
    const eligibleTargetIds = [...new Set(eligible.map((x) => x.lead.target_segment_id).filter(Boolean))];

    const { data: batch, error: batchError } = await admin
      .from("outbound_batches")
      .insert({
        organization_id: organizationId,
        campaign_id: campaignIds.length === 1 ? campaignIds[0] : null,
        target_segment_id: eligibleTargetIds.length === 1 ? eligibleTargetIds[0] : null,
        whatsapp_number_id: sender.id,
        name: `Envio ${new Date().toLocaleString("pt-BR", { timeZone: TZ })}`,
        channel: "whatsapp",
        status: "queued",
        total_recipients: eligible.length,
        interval_seconds: intervalSeconds,
        scheduled_start_at: startAt.toISOString(),
        created_by: user.id,
      })
      .select("id")
      .single();
    if (batchError || !batch) throw batchError || new Error("Could not create batch");

    const messageRows = eligible.map((item, index) => ({
      organization_id: organizationId,
      batch_id: batch.id,
      lead_id: item.lead.id,
      template_id: item.template.id,
      whatsapp_number_id: sender.id,
      channel: "whatsapp",
      recipient: item.phone,
      rendered_message: renderTemplate(item.template.body, item.lead),
      status: "queued",
      queued_at: now.toISOString(),
      scheduled_for: scheduledDates[index].toISOString(),
    }));

    const { error: messageError } = await admin.from("outbound_messages").insert(messageRows);
    if (messageError) throw messageError;

    const idsToMarkQueued = eligible
      .filter((x) => x.lead.status !== "captured_pending")
      .map((x) => x.lead.id);

    if (idsToMarkQueued.length) {
      await admin
        .from("leads")
        .update({ status: "queued" })
        .eq("organization_id", organizationId)
        .in("id", idsToMarkQueued);
    }

    await admin.from("audit_logs").insert({
      organization_id: organizationId,
      actor_user_id: user.id,
      action: "whatsapp_batch_queued",
      entity_type: "outbound_batch",
      entity_id: batch.id,
      metadata: {
        total: eligible.length,
        interval_seconds: intervalSeconds,
        daily_limit: dailyLimit,
        allowed_days: allowedDays,
        allowed_send_start: allowedStart,
        allowed_send_end: allowedEnd,
        sender_whatsapp_number_id: sender.id,
        skipped,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      batch_id: batch.id,
      queued: eligible.length,
      skipped,
      interval_seconds: intervalSeconds,
      daily_limit: dailyLimit,
      allowed_days: allowedDays,
      allowed_send_start: allowedStart,
      allowed_send_end: allowedEnd,
      sender: { id: sender.id, alias: sender.alias, phone_e164: sender.phone_e164 },
      first_scheduled_for: messageRows[0]?.scheduled_for || null,
      last_scheduled_for: messageRows[messageRows.length - 1]?.scheduled_for || null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});