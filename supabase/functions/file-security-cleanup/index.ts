import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server not configured" }, 503);

  const auth = req.headers.get("Authorization") || "";
  const apiKey = req.headers.get("apikey") || "";
  if (!auth.includes(key) && apiKey !== key) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await admin.from("file_security_scans")
    .select("id,quarantine_path")
    .lt("created_at", cutoff)
    .not("quarantine_path", "is", null)
    .limit(500);

  if (error) return json({ error: error.message }, 500);
  const paths = (rows || []).map((row: any) => String(row.quarantine_path || "")).filter(Boolean);

  let deleted = 0;
  if (paths.length) {
    const { error: removeError } = await admin.storage.from("file-quarantine").remove(paths);
    if (removeError) return json({ error: removeError.message, deleted }, 500);
    deleted = paths.length;
    await admin.from("file_security_scans").update({ quarantine_path: null })
      .in("id", (rows || []).map((row: any) => row.id));
  }

  await admin.from("file_security_scans").delete().lt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  return json({ ok: true, deleted_quarantine_files: deleted });
});
