import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Lembretes automáticos para quem se cadastrou e ainda não confirmou o e-mail.
// Dias após o cadastro: 1, 2, 3, 4, 5, 10 e 15. Para de enviar quando o e-mail é confirmado
// e depois do 7º e-mail. Nunca exclui contas.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const REDIRECT = "https://crm.axiva.com.br/?confirmed=1";
const ARCHIVED_EMAIL_DOMAIN = "@arquivado.axiva.com.br";
const DAY_MS = 24 * 60 * 60 * 1000;
const STEP_DAYS = [1, 2, 3, 4, 5, 10, 15];
const MAX_SENDS_PER_RUN = 150;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const esc = (v: unknown) => String(v ?? "").replace(/[<>&"']/g, "");

type Mail = { subject: (first: string) => string; body: (name: string) => string };
const hello = (name: string) => (name ? `Olá, ${name}.` : "Olá.");
const MAILS: Mail[] = [
  {
    subject: () => "Falta só um passo para acessar o AXIVA CRM",
    body: (n) => `${hello(n)} Seu cadastro no AXIVA CRM foi criado, mas ainda falta confirmar seu e-mail. Leva menos de 1 minuto: clique no botão abaixo e comece a usar.`,
  },
  {
    subject: (f) => (f ? `${f}, seu acesso ao AXIVA CRM está esperando` : "Seu acesso ao AXIVA CRM está esperando"),
    body: () => "Não perca a oportunidade de utilizar o AXIVA CRM por 30 dias grátis. Se o e-mail anterior foi parar no spam ou na aba Promoções, aqui está um link novo. Clique no botão abaixo e comece a usar.",
  },
  {
    subject: () => "Precisa de ajuda para confirmar seu e-mail?",
    body: () => `Seu cadastro continua pendente. Se algo deu errado, responda este e-mail ou escreva para <a href="mailto:contato@axiva.com.br">contato@axiva.com.br</a> que a gente resolve. Se estiver tudo certo, é só clicar no botão.`,
  },
  {
    subject: () => "Organize seus leads com o AXIVA CRM",
    body: () => "Com o AXIVA CRM você captura leads, acompanha o funil no Kanban e faz o follow-up por WhatsApp e e-mail em um só lugar. Vamos começar? É só confirmar seu e-mail clicando no botão abaixo.",
  },
  {
    subject: () => "Seu cadastro ainda não foi confirmado",
    body: () => "Faz 5 dias que você criou sua conta mas ainda não acessou o AXIVA CRM. Confirme seu e-mail clicando no botão abaixo para liberar o acesso.",
  },
  {
    subject: () => "Ainda quer usar o AXIVA CRM?",
    body: () => "Seu cadastro segue pendente há 10 dias. Se ainda tiver interesse, confirme seu e-mail pelo botão abaixo.",
  },
  {
    subject: () => "Último lembrete: confirme seu e-mail no AXIVA CRM",
    body: () => "Não perca a oportunidade de utilizar um CRM desenvolvido para facilitar e organizar seu fluxo comercial. Você pode testar o AXIVA CRM por 30 dias totalmente grátis, confirme seu e-mail agora clicando no botão abaixo.",
  },
];

function plain(htmlText: string) {
  return htmlText.replace(/<a [^>]*>([^<]*)<\/a>/g, "$1").replace(/<[^>]+>/g, "");
}

function render(step: number, name: string, link: string) {
  const mail = MAILS[step - 1];
  const first = name.split(" ")[0] || "";
  const body = mail.body(esc(name));
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#0B192C;line-height:1.5"><div style="max-width:560px;margin:40px auto;padding:32px;border:1px solid #e2e8f0;border-radius:14px"><h2>${esc(mail.subject(esc(first)))}</h2><p>${body}</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#00A88F;color:#fff;text-decoration:none;border-radius:8px">Confirmar e-mail</a></p><p style="font-size:13px;color:#64748b">Se você não criou esta conta, ignore esta mensagem.</p><p style="font-size:13px;color:#64748b">Equipe AXIVA CRM</p></div></body></html>`;
  const text = `${plain(body)}\n\nConfirmar e-mail: ${link}\n\nSe você não criou esta conta, ignore esta mensagem.\nEquipe AXIVA CRM`;
  return { subject: mail.subject(first), html, text };
}

async function listAllAuthUsers() {
  const users: any[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    users.push(...(data.users || []));
    if ((data.users || []).length < 100) break;
  }
  return users;
}

async function makeLink(email: string) {
  let r = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: REDIRECT } });
  let link = r.data?.properties?.action_link;
  if (r.error || !link) {
    r = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: REDIRECT } });
    link = r.data?.properties?.action_link;
  }
  return link || "";
}

async function send(to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "AXIVA CRM <no-reply@auth.axiva.com.br>", reply_to: "contato@axiva.com.br", to: [to], subject, html, text }),
  });
  if (!res.ok) console.error("signup-confirmation-reminders resend error", (await res.text()).slice(0, 300));
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { data: expected, error: secretError } = await admin.rpc("email_get_processor_secret");
    if (secretError) throw secretError;
    const provided = req.headers.get("X-Processor-Secret") || "";
    if (!expected || provided !== String(expected)) return json({ error: "Unauthorized" }, 401);
    if (!RESEND_KEY) return json({ error: "RESEND_API_KEY ausente" }, 503);

    const now = Date.now();
    const users = (await listAllAuthUsers()).filter((u: any) =>
      !u.email_confirmed_at && !u.invited_at && u.email && !String(u.email).endsWith(ARCHIVED_EMAIL_DOMAIN) &&
      (now - new Date(u.created_at).getTime()) >= STEP_DAYS[0] * DAY_MS &&
      (now - new Date(u.created_at).getTime()) < (STEP_DAYS[STEP_DAYS.length - 1] + 1) * DAY_MS
    );
    if (!users.length) return json({ ok: true, candidates: 0, sent: 0 });

    const ids = users.map((u: any) => u.id);
    const [{ data: profiles }, { data: sentRows }] = await Promise.all([
      admin.from("profiles").select("id,deleted_at,account_status").in("id", ids),
      admin.from("signup_confirmation_reminders").select("user_id,last_step").in("user_id", ids),
    ]);
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
    const stepMap = new Map((sentRows || []).map((r: any) => [r.user_id, Number(r.last_step) || 0]));

    let sent = 0;
    const failed: string[] = [];
    for (const u of users) {
      if (sent >= MAX_SENDS_PER_RUN) break;
      const profile: any = profileMap.get(u.id);
      if (profile?.deleted_at) continue;
      const ageDays = (now - new Date(u.created_at).getTime()) / DAY_MS;
      // O e-mail do dia N só sai durante o dia N (janela de 24h); nunca acumula e-mails atrasados.
      const step = STEP_DAYS.findIndex((d) => ageDays >= d && ageDays < d + 1) + 1;
      if (!step) continue;
      const previous = stepMap.get(u.id) || 0;
      if (previous >= step) continue;

      // Confere de novo, agora, se continua sem confirmar (cancela se o cliente confirmou).
      const fresh = await admin.auth.admin.getUserById(u.id);
      if (fresh.error || !fresh.data?.user || fresh.data.user.email_confirmed_at) continue;

      // Reserva o envio antes de mandar, para nunca duplicar.
      const claim = await admin.from("signup_confirmation_reminders")
        .upsert({ user_id: u.id, last_step: step, last_sent_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (claim.error) { failed.push(u.id); continue; }

      const name = String(u.user_metadata?.full_name || "").trim();
      const link = await makeLink(String(u.email));
      const mail = link ? render(step, name, link) : null;
      const ok = mail ? await send(String(u.email), mail.subject, mail.html, mail.text) : false;
      if (!ok) {
        await admin.from("signup_confirmation_reminders").upsert({ user_id: u.id, last_step: previous }, { onConflict: "user_id" });
        failed.push(u.id);
        continue;
      }
      sent += 1;
    }
    return json({ ok: true, candidates: users.length, sent, failed: failed.length });
  } catch (error) {
    console.error("signup-confirmation-reminders error", error);
    return json({ error: "Falha ao processar lembretes." }, 500);
  }
});
