import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Only randomized, per-recipient capability tokens can record campaign engagement.
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="), c => c.charCodeAt(0));
const gif = () => new Response(PIXEL, { status: 200, headers: { "Content-Type": "image/gif", "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" } });
const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const getUrls = (body: string) => [...body.matchAll(/https?:\/\/[^\s<>"']+/gi)].slice(0, 30).map(m => String(m[0]).replace(/[.,;!?)\]]+$/, ""));
// Keep the original lookup for previously sent links; v=2 includes domains without a protocol.
const getUrlsV2 = (body: string) => [...body.matchAll(/https?:\/\/[^\s<>"']+|(?<![@\w./-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s<>"']*)?/gi)].slice(0, 30).map(m => String(m[0]).replace(/[.,;!?)\]]+$/, ""));

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  if (!UUID.test(token)) return missing();
  const link = url.searchParams.get("l");
  if (link === null) {
    // Scanners, proxies and privacy software may fetch pixels; this is an estimate, not proof of reading.
    try { await db.rpc("email_tracking_record", { p_token: token, p_kind: "open" }); } catch { /* Image must never reveal recipient data. */ }
    return gif();
  }
  if (!/^(0|[1-9]\d?)$/.test(link) || Number(link) >= 30) return missing();
  const { data: body, error } = await db.rpc("email_tracking_click_body", { p_token: token });
  if (error || typeof body !== "string") return missing();
  const original = (url.searchParams.get("v") === "2" ? getUrlsV2(body) : getUrls(body))[Number(link)];
  if (!original) return missing();
  let destination: URL;
  try { destination = new URL(/^https?:\/\//i.test(original) ? original : `https://${original}`); } catch { return missing(); }
  if (!["http:", "https:"].includes(destination.protocol) || destination.username || destination.password) return missing();
  try { await db.rpc("email_tracking_record", { p_token: token, p_kind: "click" }); } catch { /* Do not break the customer's original link. */ }
  return new Response(null, { status: 302, headers: { Location: destination.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
});