import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Resend } from "npm:resend@latest";

// Forward AXIVA corporate mail only. Not an organization-wide CRM email handler.
const DESTINATION = "axivainvest@gmail.com";
const INBOUND = "contato@axiva.com.br";
const FORWARD_FROM = "encaminhamento@axiva.com.br";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = Deno.env.get("AXIVA_RESEND_INBOUND_API_KEY");
  const webhookSecret = Deno.env.get("AXIVA_RESEND_INBOUND_WEBHOOK_SECRET");
  const dbUrl = Deno.env.get("SUPABASE_URL");
  const dbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !webhookSecret || !dbUrl || !dbKey) return json({ error: "Forwarding is not configured" }, 503);

  const resend = new Resend(apiKey);
  let event: any;
  try {
    const body = await request.text();
    const id = request.headers.get("svix-id");
    const timestamp = request.headers.get("svix-timestamp");
    const signature = request.headers.get("svix-signature");
    if (!id || !timestamp || !signature) return json({ error: "Missing webhook signature" }, 401);
    event = resend.webhooks.verify({ payload: body, headers: { id, timestamp, signature }, webhookSecret });
  } catch { return json({ error: "Invalid webhook signature" }, 401); }

  if (event?.type !== "email.received") return json({ ok: true, ignored: true });
  const receivedId = event?.data?.email_id;
  if (typeof receivedId !== "string" || !/^[a-zA-Z0-9-]{10,128}$/.test(receivedId)) return json({ error: "Invalid email ID" }, 400);
  const recipients = Array.isArray(event?.data?.to) ? event.data.to : [];
  if (!recipients.some((value: unknown) => typeof value === "string" && value.trim().toLowerCase() === INBOUND)) return json({ ok: true, ignored: true });

  const admin = createClient(dbUrl, dbKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: claimed, error: claimError } = await admin.rpc("axiva_claim_inbound_forward", { p_email_id: receivedId });
  if (claimError) return json({ error: "Unable to claim email" }, 503);
  if (!claimed) return json({ ok: true, duplicate: true });

  try {
    const { data, error } = await resend.emails.receiving.forward({ emailId: receivedId, to: DESTINATION, from: FORWARD_FROM });
    if (error) throw new Error(`Resend forward failed: ${error.name || "provider error"}`);
    const { error: saveError } = await admin.from("axiva_inbound_forwarding").update({
      status: "forwarded", forwarded_email_id: data?.id || null, updated_at: new Date().toISOString(), last_error: null,
    }).eq("received_email_id", receivedId);
    if (saveError) throw new Error("Unable to record successful forwarding");
    return json({ ok: true });
  } catch (error) {
    await admin.from("axiva_inbound_forwarding").update({ status: "failed", updated_at: new Date().toISOString(), last_error: error instanceof Error ? error.message.slice(0, 160) : "Forwarding failed" }).eq("received_email_id", receivedId);
    return json({ error: "Forwarding failed, retry requested" }, 503);
  }
});