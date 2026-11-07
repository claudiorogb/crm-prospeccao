import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Cancelamento do plano (Billing V2) pelo proprietario/administrador da empresa.
// action "status": diz se a empresa tem plano ativo, se ja foi cancelado e ate quando vai o acesso.
// action "cancel": encerra as cobrancas futuras no Asaas (remove as assinaturas) e mantem o acesso
// ate o vencimento do periodo atual (access_until). O fim do acesso e feito pelo job diario
// axiva_billing_v2_finish_cancellations. Os dados do CRM sao preservados.
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json","Cache-Control":"no-store"};
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS });
const brDate = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

function asaasFor(env: string) {
  const sandbox = env === "sandbox";
  const base = sandbox ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
  const key = Deno.env.get(sandbox ? "ASAAS_SANDBOX_API_KEY" : "ASAAS_API_KEY") || "";
  return async (path: string, init: RequestInit = {}) => {
    if (!key) throw new Error("ASAAS_NOT_CONFIGURED");
    const r = await fetch(base + path, { ...init, headers: { access_token: key, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) } });
    const raw = await r.text();
    if (!r.ok) throw new Error("ASAAS_HTTP_" + r.status + ":" + raw.slice(0, 300));
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  };
}

// E-mail de confirmacao do cancelamento (texto definido pelo proprietario da AXIVA). Falha nao desfaz o cancelamento.
// Informa ate quando o acesso vale (accessUntil, AAAA-MM-DD) e que os dados ficam guardados.
async function sendCancellationEmail(to: string[], accessUntil: string) {
  const key = Deno.env.get("RESEND_API_KEY") || "";
  if (!key || !to.length) return;
  const [y, m, d] = String(accessUntil).slice(0, 10).split("-");
  const date = y && m && d ? d + "/" + m + "/" + y : "";
  const isToday = String(accessUntil).slice(0, 10) === brDate();
  const accessHtml = date ? "<p>Você pode continuar usando o AXIVA CRM normalmente até <strong>" + (isToday ? "hoje, " : "") + date + "</strong>. Seus dados não serão apagados: depois dessa data, o CRM fica restrito à visualização do Kanban e ao download dos seus dados comerciais.</p>" : "";
  const accessText = date ? "Você pode continuar usando o AXIVA CRM normalmente até " + (isToday ? "hoje, " : "") + date + ". Seus dados não serão apagados: depois dessa data, o CRM fica restrito à visualização do Kanban e ao download dos seus dados comerciais.\n\n" : "";
  const html = "<div style='font-family:Arial,sans-serif;color:#0B192C;max-width:560px;margin:40px auto;line-height:1.5'>"
    + "<p>Olá,</p>"
    + "<p>Seu plano do AXIVA CRM foi cancelado com sucesso.</p>"
    + accessHtml
    + "<p>Sentimos muito por sua decisão. Agradecemos por ter utilizado o AXIVA CRM e esperamos que nossa solução tenha contribuído para o seu trabalho.</p>"
    + "<p>Se quiser voltar a utilizar o AXIVA CRM no futuro, basta acessar:</p>"
    + "<p><a href='https://axiva.com.br/crm' style='color:#00A88F'>axiva.com.br/crm</a></p>"
    + "<p>Até breve,<br>Equipe AXIVA</p></div>";
  const text = "Olá,\n\nSeu plano do AXIVA CRM foi cancelado com sucesso.\n\n" + accessText + "Sentimos muito por sua decisão. Agradecemos por ter utilizado o AXIVA CRM e esperamos que nossa solução tenha contribuído para o seu trabalho.\n\nSe quiser voltar a utilizar o AXIVA CRM no futuro, basta acessar:\n\naxiva.com.br/crm\n\nAté breve,\nEquipe AXIVA";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "AXIVA CRM <no-reply@auth.axiva.com.br>", to, subject: "Cancelamento do seu plano AXIVA CRM", html, text }),
  });
  if (!r.ok) throw new Error("RESEND_SEND_FAILED:" + (await r.text()).slice(0, 200));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const a = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const h = req.headers.get("Authorization") || "";
    if (!h.startsWith("Bearer ")) return json({ error: "Sessão inválida." }, 401);
    const { data: me } = await a.auth.getUser(h.slice(7));
    if (!me?.user) return json({ error: "Sessão inválida." }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");

    const { data: m } = await a.from("organization_members").select("organization_id,role").eq("user_id", me.user.id).eq("is_active", true).is("deleted_at", null)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!m) return json({ ok: true, hasPlan: false });
    const org = m.organization_id;
    const canManage = ["owner", "admin"].includes(String(m.role || ""));

    const { data: acc } = await a.from("axiva_billing_v2_accounts").select("id,environment,status,asaas_subscription_id,cancelled_at,access_until").eq("organization_id", org).maybeSingle();
    const { data: ls } = await a.from("axiva_billing_v2_licenses").select("id,status,asaas_subscription_id").eq("organization_id", org).in("status", ["active", "past_due"]);
    const hasPlan = !!acc && ["active", "past_due"].includes(String(acc.status)) && (!!acc.cancelled_at || (ls || []).length > 0);
    if (!hasPlan) return json({ ok: true, hasPlan: false, canManage });
    const api = asaasFor(String(acc.environment || "production"));

    if (acc.cancelled_at) return json({ ok: true, hasPlan: true, canManage, cancelled: true, accessUntil: acc.access_until });

    const mainSid = String(acc.asaas_subscription_id || (ls || []).find((l: any) => l.asaas_subscription_id)?.asaas_subscription_id || "");
    let nextDue = "";
    if (mainSid) {
      const sub = await api("/subscriptions/" + encodeURIComponent(mainSid)).catch(() => null);
      nextDue = /^\d{4}-\d{2}-\d{2}$/.test(String(sub?.nextDueDate || "")) ? String(sub.nextDueDate) : "";
    }
    // Em atraso: o periodo atual nao foi pago, entao o acesso termina hoje.
    const accessUntil = acc.status === "past_due" ? brDate() : (nextDue || brDate());

    if (action === "status") return json({ ok: true, hasPlan: true, canManage, cancelled: false, accessUntil });
    if (action !== "cancel") return json({ error: "Ação inválida." });
    if (!canManage) return json({ error: "Somente o proprietário ou administrador da empresa pode cancelar o plano." });

    // Marca o cancelamento ANTES de remover no Asaas: o webhook de assinatura removida nao encontra licenca ativa
    // e por isso nao bloqueia o acesso na hora. Se o Asaas falhar, desfaz.
    const now = new Date().toISOString();
    const prev = (ls || []).map((l: any) => ({ id: l.id, status: l.status }));
    const subs = [...new Set([mainSid, ...(ls || []).map((l: any) => String(l.asaas_subscription_id || ""))].filter(Boolean))];
    await a.from("axiva_billing_v2_accounts").update({ cancelled_at: now, access_until: accessUntil, updated_at: now }).eq("id", acc.id);
    await a.from("axiva_billing_v2_licenses").update({ status: "cancelled", updated_at: now }).eq("organization_id", org).in("status", ["active", "past_due"]);

    const removed: string[] = [];
    try {
      for (const sid of subs) {
        await api("/subscriptions/" + encodeURIComponent(sid), { method: "DELETE" });
        removed.push(sid);
      }
    } catch (e) {
      console.error("billing-v2-cancel asaas delete failed", org, String((e as any)?.message || e).slice(0, 250));
      if (!removed.length) {
        await a.from("axiva_billing_v2_accounts").update({ cancelled_at: null, access_until: null, updated_at: new Date().toISOString() }).eq("id", acc.id);
        for (const l of prev) await a.from("axiva_billing_v2_licenses").update({ status: l.status, updated_at: new Date().toISOString() }).eq("id", l.id);
        return json({ error: "Não foi possível cancelar o plano agora. Tente novamente em alguns minutos." });
      }
    }

    // Envia para quem cancelou e para o e-mail de quem paga no Asaas (se for outro).
    try {
      const to = new Set<string>();
      if (me.user.email) to.add(String(me.user.email).toLowerCase());
      const { data: acc2 } = await a.from("axiva_billing_v2_accounts").select("asaas_customer_id").eq("id", acc.id).maybeSingle();
      if (acc2?.asaas_customer_id) {
        const c = await api("/customers/" + encodeURIComponent(acc2.asaas_customer_id)).catch(() => null);
        const ce = String(c?.email || "").trim().toLowerCase();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ce)) to.add(ce);
      }
      await sendCancellationEmail([...to], accessUntil);
    } catch (e) {
      console.error("billing-v2-cancel email failed", org, String((e as any)?.message || e).slice(0, 250));
    }

    await a.from("audit_logs").insert({ organization_id: org, actor_user_id: me.user.id, action: "billing_v2_plan_cancelled", entity_type: "axiva_billing_v2_account", entity_id: acc.id, metadata: { access_until: accessUntil, subscriptions: subs, removed } });
    return json({ ok: true, hasPlan: true, canManage, cancelled: true, accessUntil });
  } catch (e) {
    console.error("billing-v2-cancel error", String((e as any)?.message || e).slice(0, 250));
    return json({ error: "Não foi possível consultar o plano."});
  }
});
