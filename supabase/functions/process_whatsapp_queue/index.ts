import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const EVOLUTION_URL = "https://evolution-api-production-f25e4.up.railway.app";
const MAX_PER_RUN = 20;
const STALE_READY_MINUTES = 15;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function validWorkerToken(req: Request, admin: any) {
  const received = req.headers.get("x-worker-token") || "";
  if (!received) return false;
  const { data, error } = await admin
    .from("system_runtime_secrets")
    .select("secret_hash")
    .eq("name", "whatsapp_worker")
    .maybeSingle();
  if (error || !data?.secret_hash) return false;
  return (await sha256(received)) === data.secret_hash;
}

async function evolution(path: string, options: RequestInit = {}) {
  const key = Deno.env.get("EVOLUTION_API_KEY");
  if (!key) throw new Error("EVOLUTION_API_KEY não configurada no Supabase");
  const response = await fetch(`${EVOLUTION_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", apikey: key, ...(options.headers || {}) },
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const detail = data?.response?.message ?? data?.message ?? data?.error ?? text ?? `HTTP ${response.status}`;

    const formatDetail = (value: any): string => {
      if (value == null) return "";
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);

      if (Array.isArray(value)) {
        const missingNumber = value.find((item: any) => item && typeof item === "object" && item.exists === false);
        if (missingNumber) {
          const number = missingNumber.number || missingNumber.jid || "";
          return number
            ? `Número ${String(number).replace(/@.*$/, "")} não encontrado no WhatsApp.`
            : "Número não encontrado no WhatsApp.";
        }
        return value.map(formatDetail).filter(Boolean).join(" • ");
      }

      if (typeof value === "object") {
        if (value.exists === false) {
          const number = value.number || value.jid || "";
          return number
            ? `Número ${String(number).replace(/@.*$/, "")} não encontrado no WhatsApp.`
            : "Número não encontrado no WhatsApp.";
        }

        const nested = value.message ?? value.error ?? value.detail ?? value.response;
        if (nested && nested !== value) {
          const formatted = formatDetail(nested);
          if (formatted) return formatted;
        }

        try { return JSON.stringify(value); } catch { return "Erro retornado pela Evolution API."; }
      }

      return String(value);
    };

    const formatted = formatDetail(detail) || `HTTP ${response.status}`;
    throw new Error(formatted);
  }
  return data;
}

const INBOUND_WEBHOOK_URL = "https://lhnzpxjjfalxmlkjysor.supabase.co/functions/v1/whatsapp-inbound-webhook?token=pJVRbLZllIz2WSSdWtrJV-GVstV33ld7Xix5Mc2PIos";

async function connectionState(instanceName: string) {
  const data = await evolution(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
  return String(data?.instance?.state || data?.instance?.status || data?.state || "unknown").toLowerCase();
}

async function pauseForDisconnectedWhatsApp(admin: any, message: any, detail = "WhatsApp desconectado") {
  const now = new Date().toISOString();

  await admin.from("whatsapp_numbers").update({
    connection_status: "disconnected",
    evolution_last_sync_at: now,
  }).eq("id", message.whatsapp_number_id).eq("organization_id", message.organization_id);

  await admin.from("outbound_batches").update({
    status: "paused",
    paused_at: now,
    updated_at: now,
  }).eq("id", message.batch_id).eq("organization_id", message.organization_id).in("status", ["queued", "ready", "processing", "in_progress"]);

  await admin.from("outbound_messages").update({
    status: "queued",
    error_message: `Envio pausado: ${detail}`,
    updated_at: now,
  }).eq("id", message.id).eq("status", "ready");
}

async function releaseLeadFromQueueIfNoActiveMessage(admin: any, organizationId: string, leadId: string) {
  if (!leadId) return;
  const { data: active } = await admin
    .from("outbound_messages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .in("status", ["queued", "ready", "processing"])
    .limit(1);

  if (active?.length) return;

  await admin
    .from("leads")
    .update({ status: "new", updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .eq("status", "queued");
}

async function refreshBatch(admin: any, batchId: string) {
  const [{ data: rows }, { data: batch }] = await Promise.all([
    admin.from("outbound_messages").select("status").eq("batch_id", batchId),
    admin.from("outbound_batches").select("status").eq("id", batchId).maybeSingle(),
  ]);
  const list = rows || [];
  const sent = list.filter((m: any) => m.status === "sent").length;
  const failed = list.filter((m: any) => m.status === "failed").length;
  const pending = list.filter((m: any) => ["queued", "ready", "processing"].includes(m.status)).length;
  const patch: any = { sent_count: sent, failed_count: failed, updated_at: new Date().toISOString() };

  if (batch?.status === "paused" || batch?.status === "cancelled") {
    // Never undo a pause/cancellation requested by the user or caused by a lost WhatsApp session.
  } else if (!pending && list.length) {
    patch.status = "completed";
    patch.completed_at = new Date().toISOString();
  } else {
    patch.status = "queued";
  }

  await admin.from("outbound_batches").update(patch).eq("id", batchId);
}

async function markStaleReadyAsFailed(admin: any) {
  const cutoff = new Date(Date.now() - STALE_READY_MINUTES * 60_000).toISOString();
  const { data: stale } = await admin.from("outbound_messages").select("id,batch_id,lead_id,organization_id").eq("status", "ready").lt("last_attempt_at", cutoff);
  if (!stale?.length) return 0;
  const ids = stale.map((m: any) => m.id);
  await admin.from("outbound_messages").update({
    status: "failed",
    error_message: "Processamento interrompido antes da confirmação do envio. Revise e use tentar novamente se necessário.",
    updated_at: new Date().toISOString(),
  }).in("id", ids).eq("status", "ready");
  for (const item of stale) {
    await releaseLeadFromQueueIfNoActiveMessage(admin, String(item.organization_id), String(item.lead_id));
  }
  const batchIds = [...new Set(stale.map((m: any) => m.batch_id).filter(Boolean))];
  for (const batchId of batchIds) await refreshBatch(admin, String(batchId));
  return ids.length;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!(await validWorkerToken(req, admin))) return json({ error: "Unauthorized" }, 401);

    const staleFailed = await markStaleReadyAsFailed(admin);
    let processed = 0;
    const results: any[] = [];
    for (let i = 0; i < MAX_PER_RUN; i++) {
      const { data: claimed, error: claimError } = await admin.rpc("claim_next_whatsapp_message");
      if (claimError) throw claimError;
      const message = claimed?.[0];
      if (!message) break;
      try {
        const state = await connectionState(message.evolution_instance_name);
        if (state !== "open") {
          const terminalDisconnected = ["close", "closed", "disconnected", "logout"].includes(state);

          if (terminalDisconnected) {
            await pauseForDisconnectedWhatsApp(admin, message, `conexão do WhatsApp está ${state}`);
            processed++;
            results.push({ id: message.id, status: "paused_disconnected", connection_state: state });
          } else {
            await admin.from("outbound_messages").update({
              status: "queued",
              error_message: null,
              updated_at: new Date().toISOString(),
            }).eq("id", message.id).eq("status", "ready");
            results.push({ id: message.id, status: "waiting_connection", connection_state: state });
          }

          break;
        }

        await admin.from("whatsapp_numbers").update({
          connection_status: "connected",
          evolution_last_sync_at: new Date().toISOString(),
        }).eq("id", message.whatsapp_number_id).eq("organization_id", message.organization_id);

        const result = await evolution(`/message/sendText/${encodeURIComponent(message.evolution_instance_name)}`, {
          method: "POST",
          body: JSON.stringify({ number: message.recipient, text: message.rendered_message }),
        });
        const sentAt = new Date().toISOString();
        const providerMessageId = result?.key?.id || result?.messageId || result?.id || null;
        const { error: updateError } = await admin.from("outbound_messages").update({
          status: "sent", provider_message_id: providerMessageId, sent_at: sentAt, error_message: null, updated_at: sentAt,
        }).eq("id", message.id).eq("status", "ready");
        if (updateError) throw updateError;
        const brazilDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());
        await admin.from("leads").update({ status: "contacted_pending", last_contact_date: brazilDate }).eq("id", message.lead_id).eq("organization_id", message.organization_id);
        await refreshBatch(admin, message.batch_id);
        processed++;
        results.push({ id: message.id, status: "sent" });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const connectionError = /connection closed|connection.*close|disconnected|logout|not connected|connection state/i.test(detail);

        if (connectionError) {
          await pauseForDisconnectedWhatsApp(admin, message, detail);
          processed++;
          results.push({ id: message.id, status: "paused_disconnected", error: detail });
          break;
        }

        await admin.from("outbound_messages").update({
          status: "failed",
          error_message: detail,
          updated_at: new Date().toISOString(),
        }).eq("id", message.id).eq("status", "ready");
        await releaseLeadFromQueueIfNoActiveMessage(admin, String(message.organization_id), String(message.lead_id));
        await refreshBatch(admin, message.batch_id);
        processed++;
        results.push({ id: message.id, status: "failed", error: detail });
      }
    }
    return json({ ok: true, processed, stale_failed: staleFailed, results });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});