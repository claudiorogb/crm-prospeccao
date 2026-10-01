import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Resend } from "npm:resend@6.28.1";
import PostalMime from "npm:postal-mime@latest";

const DESTINATION = "axivainvest@gmail.com";
const INBOUND_ADDRESSES = new Set(["contato@axiva.com.br", "axiva@auth.axiva.com.br"]);
const FORWARD_FROM = "encaminhamento@axiva.com.br";
const TECHNICAL_REPLY = /^reply-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@auth\.axiva\.com\.br$/i;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const validAddress = (address: unknown): address is string => typeof address === "string" && address.length <= 254 && /^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/.test(address);
const normalizeMessageId=(value:unknown)=>String(value||"").trim();
function replyReferences(original:any){
  const values:string[]=[];
  const add=(v:unknown)=>{
    if(Array.isArray(v)){for(const x of v)add(x);return;}
    const s=String(v||"").trim();if(!s)return;
    const matches=s.match(/<[^<>]+>/g);
    if(matches?.length)values.push(...matches.map(normalizeMessageId));else values.push(normalizeMessageId(s));
  };
  add(original?.inReplyTo);add(original?.references);
  for(const h of original?.headers||[]){
    const name=String(h?.key||h?.name||"").toLowerCase();
    if(name==="in-reply-to"||name==="references")add(h?.value);
  }
  return Array.from(new Set(values.filter(Boolean))).slice(0,50);
}

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
  } catch {
    return json({ error: "Invalid webhook signature" }, 401);
  }

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

  const recipients = Array.isArray(event?.data?.to) ? event.data.to.map((v:any)=>String(v||"").trim().toLowerCase()) : [];
  let replyToken: string | null = null;
  for (const value of recipients) {
    const match = value.match(TECHNICAL_REPLY);
    if (match) { replyToken = match[1]; break; }
  }
  const isMailboxInbound = recipients.some((value:string) => INBOUND_ADDRESSES.has(value));
  const admin = createClient(dbUrl, dbKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const {data:platformReply}=await admin.from("email_platform_config").select("generic_reply_address,generic_reply_status").eq("singleton",true).maybeSingle();
  const systemReply=platformReply?.generic_reply_status==="verified"?String(platformReply?.generic_reply_address||"").trim().toLowerCase():"";
  let customReplyConnection:any=null;
  if(!replyToken&&!isMailboxInbound&&recipients.length){
    const {data}=await admin.from("email_connections")
      .select("organization_id,custom_reply_email,custom_reply_status")
      .eq("reply_mode","custom").eq("custom_reply_status","verified")
      .in("custom_reply_email",recipients).limit(2);
    if(Array.isArray(data)&&data.length===1)customReplyConnection=data[0];
  }
  const isSystemReply=Boolean(systemReply&&recipients.includes(systemReply));
  const isCustomReply=Boolean(customReplyConnection);
  if (!replyToken && !isMailboxInbound && !isSystemReply && !isCustomReply) return json({ ok: true, ignored: true });

  const { data: claimed, error: claimError } = await admin.rpc("axiva_claim_inbound_forward", { p_email_id: receivedId });
  if (claimError) return json({ error: "Unable to claim email" }, 503);
  if (!claimed) return json({ ok: true, duplicate: true });

  try {
    const { data: received, error: receivingError } = await resend.emails.receiving.get(receivedId);
    if (receivingError || !received) throw new Error("Unable to retrieve original email");
    const eventFromRaw = String(event?.data?.from || "").trim();
    const eventSender = eventFromRaw.match(/<([^<>]+)>\s*$/)?.[1] || eventFromRaw;
    let original:any = {
      from: validAddress(eventSender) ? { address: eventSender } : undefined,
      replyTo: [],
      attachments: [],
      subject: received.subject || event?.data?.subject || "",
      text: received.text || "",
      html: received.html || "",
      headers: received.headers || []
    };
    if (received?.raw?.download_url) {
      try {
        const raw = await fetch(received.raw.download_url);
        if (raw.ok) {
          const parsed = await PostalMime.parse(await raw.arrayBuffer(), { attachmentEncoding: "base64" });
          if (parsed) original = parsed;
        }
      } catch (parseError) {
        console.error("Inbound raw parse fallback", parseError);
      }
    }
    const parsedSender = original.from && "address" in original.from ? original.from.address : undefined;
    const sender = validAddress(parsedSender) ? parsedSender : eventSender;
    if (!validAddress(sender)) throw new Error("Original sender address is missing or invalid");
    const preferredReply = original.replyTo?.find((address) => "address" in address && validAddress(address.address));
    const replyAddress = preferredReply && "address" in preferredReply ? preferredReply.address : sender;

    let target = DESTINATION;
    let matchedRecipient:any=null;
    if (replyToken) {
      const { data: recipient, error: recipientError } = await admin
        .from("email_campaign_recipients")
        .select("id,organization_id,campaign_id,recipient_email")
        .eq("reply_token", replyToken)
        .maybeSingle();
      if (recipientError) throw recipientError;
      matchedRecipient=recipient;
    } else if(isSystemReply||isCustomReply) {
      const refs=replyReferences(original);
      if(refs.length){
        let query=admin.from("email_campaign_recipients")
          .select("id,organization_id,campaign_id,recipient_email")
          .eq("recipient_email",sender.toLowerCase())
          .overlaps("resend_message_ids",refs)
          .limit(2);
        if(isCustomReply&&customReplyConnection?.organization_id)query=query.eq("organization_id",customReplyConnection.organization_id);
        const {data:matches,error:matchError}=await query;
        if(matchError)throw matchError;
        if(Array.isArray(matches)&&matches.length===1)matchedRecipient=matches[0];
      }
    }
    if(replyToken||isSystemReply||isCustomReply){
      if(!matchedRecipient){
        await admin.from("axiva_inbound_forwarding").update({ status: "failed", updated_at: new Date().toISOString(), last_error: "Prospecting reply could not be matched safely" }).eq("received_email_id", receivedId);
        return json({ ok: true, ignored: true });
      }
      const { data: campaign, error: campaignError } = await admin
        .from("email_campaigns")
        .select("provider,sequence_mode")
        .eq("id", matchedRecipient.campaign_id)
        .eq("organization_id", matchedRecipient.organization_id)
        .maybeSingle();
      if (campaignError) throw campaignError;
      if (!campaign?.sequence_mode || campaign?.provider !== "resend") {
        await admin.from("axiva_inbound_forwarding").update({ status: "failed", updated_at: new Date().toISOString(), last_error: "Reply is not attached to an active Resend prospecting sequence" }).eq("received_email_id", receivedId);
        return json({ ok: true, ignored: true });
      }
      const { error: markError } = await admin.rpc("email_mark_prospecting_reply", { p_recipient_id: matchedRecipient.id });
      if (markError) throw markError;
      const { data: connection, error: connectionError } = await admin
        .from("email_connections")
        .select("sender_email,email_address,reply_forward_email,connected_by")
        .eq("organization_id", matchedRecipient.organization_id)
        .maybeSingle();
      if (connectionError) throw connectionError;
      let configuredTarget = String(connection?.reply_forward_email || "").trim().toLowerCase();
      if (!validAddress(configuredTarget) && connection?.connected_by) {
        const { data: connectedUser } = await admin.auth.admin.getUserById(connection.connected_by);
        configuredTarget = String(connectedUser?.user?.email || "").trim().toLowerCase();
      }
      if (!validAddress(configuredTarget)) configuredTarget = String(connection?.sender_email || connection?.email_address || "").trim().toLowerCase();
      if (validAddress(configuredTarget) && !INBOUND_ADDRESSES.has(configuredTarget)) target = configuredTarget;
    }

    const display = sender.replace(/["\\\r\n<>]/g, "").slice(0, 200);
    const attachments = (original.attachments || []).map((attachment:any) => ({
      filename: attachment.filename || "anexo",
      content: String(attachment.content),
      content_type: attachment.mimeType,
      content_id: attachment.contentId?.replace(/^<|>$/g, "") || undefined,
    }));
    const { data, error } = await resend.emails.send({
      from: `"${display} via AXIVA" <${FORWARD_FROM}>`,
      to: [target],
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
    return json({ ok: true, prospecting_reply: Boolean(replyToken||isSystemReply||isCustomReply) });
  } catch (error) {
    console.error("Inbound forwarding error", error);
    const failureMessage = error instanceof Error ? error.message : String((error as any)?.message || error || "Forwarding failed");
    await admin.from("axiva_inbound_forwarding").update({ status: "failed", updated_at: new Date().toISOString(), last_error: failureMessage.slice(0, 160) }).eq("received_email_id", receivedId);
    return json({ error: "Forwarding failed, retry requested" }, 503);
  }
});