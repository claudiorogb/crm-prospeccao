import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "Server not configured" }, 503);

  const token = req.headers.get("x-cleanup-token") || "";
  if (!token) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: valid, error: verifyError } = await admin.rpc("verify_whatsapp_media_cleanup_token", {
    p_token: token,
  });
  if (verifyError || valid !== true) return json({ error: "Unauthorized" }, 401);

  let deleted = 0;
  let metadataUpdated = 0;

  for (let batch = 0; batch < 10; batch += 1) {
    const { data: rows, error: listError } = await admin.rpc("list_expired_whatsapp_media", {
      p_limit: 500,
    });
    if (listError) return json({ error: listError.message, deleted, metadata_updated: metadataUpdated }, 500);

    const paths = (rows || []).map((row: any) => String(row.name || "")).filter(Boolean);
    if (!paths.length) break;

    const { error: removeError } = await admin.storage.from("whatsapp-media").remove(paths);
    if (removeError) return json({ error: removeError.message, deleted, metadata_updated: metadataUpdated }, 500);

    deleted += paths.length;

    const { data: marked, error: markError } = await admin.rpc("mark_whatsapp_media_expired", {
      p_paths: paths,
    });
    if (markError) return json({ error: markError.message, deleted, metadata_updated: metadataUpdated }, 500);

    metadataUpdated += Number(marked || 0);
    if (paths.length < 500) break;
  }

  return json({
    ok: true,
    retention_days: 90,
    deleted,
    metadata_updated: metadataUpdated,
  });
});
