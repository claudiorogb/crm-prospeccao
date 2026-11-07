import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { buildReminderMail, daysBetween, reminderKind } from "./rules.js";

// Lembretes por e-mail para empresas com plano cancelado e acesso ainda ativo:
// 7 dias antes, 3 dias antes e no último dia de acesso (access_until). Vai para proprietário e administradores.
// Roda de hora em hora (cron), só envia a partir das 8h (Brasília) e nunca repete: cada lembrete é registrado
// em axiva_cancellation_reminders antes do envio. Só contas de produção. Corpo opcional: { "dry_run": true }.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const ARCHIVED_EMAIL_DOMAIN = "@arquivado.axiva.com.br";
const SEND_FROM_HOUR = 8;
const MAX_ORGS_PER_RUN = 100;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const brParts = (d = new Date()) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

async function recipientsFor(orgId: string): Promise<string[]> {
  const { data: members } = await admin.from("organization_members").select("user_id")
    .eq("organization_id", orgId).in("role", ["owner", "admin"]).eq("is_active", true).is("deleted_at", null);
  const emails = new Set<string>();
  for (const m of members || []) {
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    const email = String(data?.user?.email || "").trim().toLowerCase();
    if (email && !email.endsWith(ARCHIVED_EMAIL_DOMAIN)) emails.add(email);
  }
  return [...emails];
}

async function send(to: string, mail: { subject: string; html: string; text: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "AXIVA CRM <no-reply@auth.axiva.com.br>", reply_to: "contato@axiva.com.br", to: [to], ...mail }),
  });
  if (!res.ok) console.error("cancellation-access-reminders resend error", res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { data: expected, error: secretError } = await admin.rpc("email_get_processor_secret");
    if (secretError) throw secretError;
    const provided = req.headers.get("X-Processor-Secret") || "";
    if (!expected || provided !== String(expected)) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    if (!dryRun && !RESEND_KEY) return json({ error: "RESEND_API_KEY ausente" }, 503);

    const now = brParts();
    if (!dryRun && now.hour < SEND_FROM_HOUR) return json({ ok: true, skipped: "antes das 8h", today: now.date });

    const { data: accounts, error } = await admin.from("axiva_billing_v2_accounts")
      .select("organization_id,access_until,cancelled_at,status,environment")
      .not("cancelled_at", "is", null).not("access_until", "is", null)
      .in("status", ["active", "past_due"]).eq("environment", "production")
      .gte("access_until", now.date).limit(MAX_ORGS_PER_RUN);
    if (error) throw error;

    const planned: any[] = [];
    let sent = 0;
    for (const acc of accounts || []) {
      const until = String(acc.access_until).slice(0, 10);
      const cancelledToday = brParts(new Date(acc.cancelled_at)).date === now.date;
      const kind = reminderKind(daysBetween(now.date, until), cancelledToday);
      if (!kind) continue;
      const recipients = await recipientsFor(acc.organization_id);
      if (!recipients.length) continue;

      if (dryRun) { planned.push({ organization_id: acc.organization_id, kind, access_until: until, recipients }); continue; }

      // Registra antes de enviar: se já existe, outro disparo já cuidou deste lembrete.
      const { error: claimError } = await admin.from("axiva_cancellation_reminders")
        .insert({ organization_id: acc.organization_id, access_until: until, kind, recipients });
      if (claimError) {
        if (claimError.code === "23505") continue;
        throw claimError;
      }
      const mail = buildReminderMail(kind, until);
      const results = await Promise.all(recipients.map((to) => send(to, mail)));
      if (results.some(Boolean)) sent += 1;
      else await admin.from("axiva_cancellation_reminders").delete()
        .eq("organization_id", acc.organization_id).eq("access_until", until).eq("kind", kind); // falhou em todos: tenta de novo na próxima hora
    }
    return json(dryRun ? { ok: true, dry_run: true, today: now.date, hour: now.hour, planned } : { ok: true, today: now.date, sent });
  } catch (e) {
    console.error("cancellation-access-reminders error", String((e as any)?.message || e).slice(0, 300));
    return json({ error: "Falha ao processar os lembretes." }, 500);
  }
});
