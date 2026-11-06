import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Envia por e-mail o link do AXIVA CRM (app instalável no celular).
// Somente administrador do sistema ativo pode usar; o destinatário é o e-mail digitado na Administração.
const APP_URL = "https://crm.axiva.com.br/";
const FROM = "AXIVA CRM <no-reply@auth.axiva.com.br>";
const ALLOWED_ORIGINS = new Set(["https://crm.axiva.com.br", "https://crm-prospeccao-app.vercel.app"]);
const PREVIEW_ORIGIN = /^https:\/\/crm-prospeccao-[a-z0-9]+-claudiorogb-3509\.vercel\.app$/;

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allow = ALLOWED_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin) ? origin : "https://crm.axiva.com.br";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function buildHtml() {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F8FAFC;font-family:Arial,Helvetica,sans-serif;color:#0B192C;line-height:1.55">
<div style="max-width:560px;margin:32px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px">
<h2 style="margin:0 0 12px;font-size:22px">Instale o AXIVA CRM no seu celular</h2>
<p style="margin:0 0 20px;color:#475569">Acesse o link abaixo pelo celular, entre com o seu e-mail e senha e siga o passo a passo para colocar o app na tela inicial. Não precisa de loja de aplicativos.</p>
<p style="margin:0 0 24px"><a href="${APP_URL}" style="display:inline-block;background:#00A88F;color:#0B192C;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:12px">Abrir o AXIVA CRM</a></p>
<p style="margin:0 0 6px"><b>iPhone (Safari):</b> toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p>
<p style="margin:0 0 20px"><b>Android (Chrome):</b> toque no menu do navegador e em “Instalar app” (ou, dentro do CRM, em “Instalar CRM no celular”).</p>
<p style="margin:0;color:#64748b;font-size:13px">Se o botão não funcionar, copie e cole este endereço no navegador do celular:<br>${APP_URL}</p>
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "Método não permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    if (!url || !service || !resendKey) return json(req, { error: "Serviço indisponível." }, 503);

    const header = req.headers.get("Authorization") || "";
    if (!header.startsWith("Bearer ")) return json(req, { error: "Sessão inválida." }, 401);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(header.slice(7));
    const user = authData?.user;
    if (authError || !user) return json(req, { error: "Sessão inválida." }, 401);

    const { data: sysAdmin } = await admin.from("system_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    const { data: profile } = await admin.from("profiles").select("account_status").eq("id", user.id).maybeSingle();
    if (!sysAdmin || profile?.account_status !== "active") return json(req, { error: "Acesso negado." }, 403);

    let body: any = {};
    try { body = await req.json(); } catch { /* corpo vazio */ }
    const email = String(body?.email || "").trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) {
      return json(req, { error: "Informe um e-mail válido." }, 400);
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [email], subject: "Instale o AXIVA CRM no seu celular", html: buildHtml() }),
    });
    if (!response.ok) {
      console.error("send-app-link: falha no Resend", response.status);
      return json(req, { error: "Não foi possível enviar o e-mail agora. Tente novamente em instantes." }, 502);
    }
    return json(req, { ok: true });
  } catch (error) {
    console.error("send-app-link error", error);
    return json(req, { error: "Não foi possível enviar o e-mail." }, 500);
  }
});
