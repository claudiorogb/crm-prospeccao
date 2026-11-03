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

const TYPE_PREVIEW: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Arquivo",
  sticker: "Figurinha",
  contact: "Contato",
};

// Apaga a mensagem SOMENTE no CRM (não mexe no WhatsApp). A linha fica com o texto e os
// metadados limpos para que o provedor não a recrie ao reenviar o mesmo evento.
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
  const { data: userResult, error: userError } = await admin.auth.getUser(authHeader.slice(7));
  const user = userResult?.user;
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const messageId = Number(body?.message_id);
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return json({ error: "Mensagem inválida." }, 400);

  // A empresa vem da mensagem e é conferida contra a associação ativa do usuário.
  const { data: message } = await admin
    .from("whatsapp_messages")
    .select("id,organization_id,conversation_id,direction,sent_by_user_id,deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return json({ error: "Mensagem não encontrada." }, 404);

  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", message.organization_id)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (!membership) return json({ error: "Forbidden" }, 403);

  const isAdmin = ["admin", "owner"].includes(String(membership.role));
  const isOwnSent = message.direction === "outbound" && message.sent_by_user_id === user.id;
  if (!isAdmin && !isOwnSent) {
    return json({ error: "Somente administradores podem apagar esta mensagem. Você pode apagar as mensagens que você mesmo enviou." }, 403);
  }

  if (!message.deleted_at) {
    const now = new Date().toISOString();
    const { error } = await admin
      .from("whatsapp_messages")
      .update({ deleted_at: now, deleted_by: user.id, text_body: null, media_metadata: {} })
      .eq("id", messageId)
      .eq("organization_id", message.organization_id);
    if (error) return json({ error: "Não foi possível apagar a mensagem." }, 500);
  }

  // Atualiza a prévia da conversa com a última mensagem que sobrou.
  const { data: last } = await admin
    .from("whatsapp_messages")
    .select("text_body,message_type,occurred_at")
    .eq("organization_id", message.organization_id)
    .eq("conversation_id", message.conversation_id)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const preview = last
    ? String(last.text_body || TYPE_PREVIEW[String(last.message_type)] || "Mensagem").slice(0, 120)
    : null;
  await admin
    .from("whatsapp_conversations")
    .update({ last_message_preview: preview })
    .eq("id", message.conversation_id)
    .eq("organization_id", message.organization_id);

  return json({ ok: true });
});
