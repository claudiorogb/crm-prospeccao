import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Resend } from "npm:resend@6.28.1";
import PostalMime from "npm:postal-mime@latest";

// AXIVA company mailboxes only. Authenticated From stays on our verified domain.
// Gmail displays the original correspondent and replies go to their real address.
const DESTINATION = "axivainvest@gmail.com";
const INBOUND_ADDRESSES = new Set(["contato@axiva.com.br", "axiva@auth.axiva.com.br"]);
const FORWARD_FROM = "encaminhamento@axiva.com.br";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const validAddress = (address: unknown): address is string => typeof address === "string" && address.length <= 254 && /^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/.test(address);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const apiKey = Deno.env.get("AXIVA_RESEND_INBOUND_API_KEY");
  const webhookSecret = Deno.env.get("AXIVA_RESEND_INBOUND_WEBHOOK_SECRET");
  const dbUrl = Deno.env.get("SUPABASE_URL");
  const dbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !webhookSecret || !dbUrl || !dbKey) return json({ error: "Forwarding is not configured" }, 503);

  const resend = new Resend(apiKey);
  let event: any;
  let verifiedEventId = "";
  try {
    const body = await request.text();
    const id = request.headers.get("svix-id");
    const timestamp = request.headers.get("svix-timestamp");
    const signature = request.headers.get("svix-signature");
    if (!id || !timestamp || !signature) return json({ error: "Missing webhook signature" }, 401);
    event = resend.webhooks.verify({ payload: body, headers: { id, timestamp, signature }, webhookSecret });
    verifiedEventId = id;
  } catch { return json({ error: "Invalid webhook signature" }, 401); }

  if (event?.type !== "email.received") {
    const permitted = new Set(["email.sent", "email.delivered", "email.delivery_delayed", "email.opened", "email.clicked", "email.bounced", "email.complained", "email.failed", "email.suppressed"]);
    if (!permitted.has(String(event?.type || ""))) return json({ ok: true, ignored: true });
    const providerMessageId = event?.data?.email_id;
    const recipients = event?.data?.to;
    const recipientEmail = Array.isArray(recipients) && recipients.length === 1 ? recipients[0] : null;
    const fromRaw = String(event?.data?.from || "").trim();
    const senderEmail = fromRaw.match(/<([^<>]+)>\s*$/)?.[1] || fromRaw;
    if (typeof providerMessageId !== "string" || !/^[a-zA-Z0-9_-]{10,255}$/.test(providerMessageId) || !validAddress(recipientEmail) || !validAddress(senderEmail)) return json({ ok: true, ignored: true });
    const eventAt = new Date(String(event?.created_at || ""));
    if (!Number.isFinite(eventAt.getTime())) return json({ ok: true, ignored: true });
    const reason = event?.data?.bounce?.message || event?.data?.error?.message || event?.data?.reason || null;
    const admin = createClient(dbUrl, dbKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.rpc("email_ingest_resend_event", {
      p_event_id: verifiedEventId, p_provider_message_id: providerMessageId, p_event_type: event.type,
      p_recipient_email: recipientEmail, p_sender_email: senderEmail,
      p_event_at: eventAt.toISOString(), p_reason: typeof reason === "string" ? reason.slice(0, 1000) : null,
    });
    return error ? json({ error: "Unable to record campaign event" }, 503) : json({ ok: true });
  }

  const receivedId = event?.data?.email_id;
  if (typeof receivedId !== "string" || !/^[a-zA-Z0-9-]{10,128}$/.test(receivedId)) return json({ error: "Invalid email ID" }, 400);
  const recipients = Array.isArray(event?.data?.to) ? event.data.to : [];
  if (!recipients.some((value: unknown) => typeof value === "string" && INBOUND_ADDRESSES.has(value.trim().toLowerCase()))) return json({ ok: true, ignored: true });

  const admin = createClient(dbUrl, dbKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: claimed, error: claimError } = await admin.rpc("axiva_claim_inbound_forward", { p_email_id: receivedId });
  if (claimError) return json({ error: "Unable to claim email" }, 503);
  if (!claimed) return json({ ok: true, duplicate: true });

  try {
    const { data: received, error: receivingError } = await resend.emails.receiving.get(receivedId);
    if (receivingError || !received?.raw?.download_url) throw new Error("Unable to retrieve original email");
    const raw = await fetch(received.raw.download_url);
    if (!raw.ok) throw new Error("Unable to download original email");
    const original = await PostalMime.parse(await raw.arrayBuffer(), { attachmentEncoding: "base64" });
    const sender = original.from && "address" in original.from ? original.from.address : undefined;
    if (!validAddress(sender)) throw new Error("Original sender address is missing or invalid");
    const preferredReply = original.replyTo?.find((address) => "address" in address && validAddress(address.address));
    const replyAddress = preferredReply && "address" in preferredReply ? preferredReply.address : sender;
    const display = sender.replace(/["\\\r\n<>]/g, "").slice(0, 200);
    const attachments = original.attachments.map((attachment) => ({
      filename: attachment.filename || "anexo",
      content: String(attachment.content),
      content_type: attachment.mimeType,
      content_id: attachment.contentId?.replace(/^<|>$/g, "") || undefined,
    }));
    const { data, error } = await resend.emails.send({
      from: `"${display} via AXIVA" <${FORWARD_FROM}>`,
      to: [DESTINATION],
      replyTo: replyAddress,
      subject: original.subject || received.subject || "(sem assunto)",
      text: original.text || undefined,
      html: original.html || undefined,
      attachments: attachments.length ? attachments : undefined,
      headers: { "X-AXIVA-Original-From": sender },
    });
    if (error || !data?.id) throw new Error(`Resend forward failed: ${error?.name || "provider error"}`);
    const { error: saveError } = await admin.from("axiva_inbound_forwarding").update({ status: "forwarded", forwarded_email_id: data.id, updated_at: new Date().toISOString(), last_error: null }).eq("received_email_id", receivedId);
    if (saveError) throw new Error("Unable to record successful forwarding");
    return json({ ok: true });
  } catch (error) {
    await admin.from("axiva_inbound_forwarding").update({ status: "failed", updated_at: new Date().toISOString(), last_error: error instanceof Error ? error.message.slice(0, 160) : "Forwarding failed" }).eq("received_email_id", receivedId);
    return json({ error: "Forwarding failed, retry requested" }, 503);
  }
});