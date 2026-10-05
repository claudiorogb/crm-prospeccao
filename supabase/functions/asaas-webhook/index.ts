import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WEBHOOK_TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") || "resposta@axiva.com.br";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const corsHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const PLAN_NAMES: Record<string, string> = {
  axiva: "AXIVA",
  axiva_plus: "AXIVA Plus",
  axiva_max: "AXIVA Max",
};

async function sendContractEmail(contractId: string) {
  if (!RESEND_API_KEY) return false;

  const { data: contract } = await admin
    .from("axiva_paid_contract_acceptances")
    .select("id,organization_id,plan_id,contract_version,signer_name,signer_email,cnpj,accepted_at")
    .eq("id", contractId)
    .maybeSingle();

  if (!contract?.signer_email) return false;

  const { data: organization } = await admin
    .from("organizations")
    .select("name")
    .eq("id", contract.organization_id)
    .maybeSingle();

  const planName = PLAN_NAMES[contract.plan_id] || contract.plan_id;
  const acceptedAt = new Date(contract.accepted_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#0b192c;line-height:1.6">
    <h2>Contrato de Licença e Uso do AXIVA CRM</h2>
    <p>Olá, ${escapeHtml(contract.signer_name)}.</p>
    <p>Registramos a contratação do plano <strong>${escapeHtml(planName)}</strong> para a organização <strong>${escapeHtml(organization?.name || "")}</strong>.</p>
    <p>Esta mensagem contém uma cópia das condições aceitas no momento da contratação.</p>
    <h3>Registro do aceite</h3>
    <p><strong>Contratante:</strong> ${escapeHtml(contract.signer_name)}<br>
    <strong>E-mail:</strong> ${escapeHtml(contract.signer_email)}<br>
    <strong>CNPJ:</strong> ${escapeHtml(contract.cnpj || "")}<br>
    <strong>Plano:</strong> ${escapeHtml(planName)}<br>
    <strong>Versão:</strong> ${escapeHtml(contract.contract_version)}<br>
    <strong>Data e hora do aceite:</strong> ${escapeHtml(acceptedAt)}</p>
    <h3>Contrato</h3>
    <p><strong>1. Partes.</strong> O AXIVA CRM, da marca AXIVA, é oferecido por Claudio Rogério Borges, pessoa física, e o presente contrato é celebrado com a empresa identificada pelo CNPJ cadastrado no CRM, representada pelo responsável que realiza a contratação.</p>
    <p><strong>2. Objeto.</strong> O contrato concede ao cliente uma licença de uso não exclusiva do AXIVA CRM, conforme o plano contratado, para organização de contatos, prospecção comercial, relacionamento com clientes e acompanhamento de oportunidades.</p>
    <p><strong>3. Plano, preço e cobrança.</strong> O cliente contrata o plano ${escapeHtml(planName)}. A cobrança é recorrente e mensal, realizada pelo Asaas conforme as condições apresentadas no checkout.</p>
    <p><strong>4. Vigência e cancelamento.</strong> A contratação permanece vigente enquanto houver assinatura ativa e pagamentos regulares. O cancelamento seguirá as condições disponibilizadas pelo serviço de cobrança.</p>
    <p><strong>5. Responsabilidade do cliente.</strong> O cliente é responsável pelos dados cadastrados, importados ou utilizados no AXIVA CRM e pela legitimidade de sua obtenção e utilização.</p>
    <p><strong>6. Uso permitido.</strong> É proibido utilizar o AXIVA CRM para fraude, envio abusivo de mensagens, distribuição de conteúdo ilícito, violação de direitos de terceiros, acesso não autorizado ou tentativa de comprometer a segurança da plataforma.</p>
    <p><strong>7. Dados e privacidade.</strong> O tratamento de dados pessoais seguirá a Política de Privacidade do AXIVA e a legislação aplicável.</p>
    <p><strong>8. Termos complementares.</strong> Integram este contrato os Termos de Serviço e a Política de Privacidade publicados pelo AXIVA.</p>
    <p><strong>9. Aceite eletrônico.</strong> O aceite realizado no CRM registra o nome informado, a conta autenticada, o CNPJ da organização, a versão do contrato e a data e hora do aceite.</p>
    <p><a href="https://axiva.com.br/termos">Termos de Serviço</a> · <a href="https://axiva.com.br/privacidade">Política de Privacidade</a></p>
    <p>AXIVA CRM</p>
  </body></html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [contract.signer_email],
      subject: "Contrato de uso do AXIVA CRM — " + planName,
      html,
      text: "Contrato de Licença e Uso do AXIVA CRM. Plano: " + planName + ". Versão: " + contract.contract_version + ". Aceite registrado em " + acceptedAt + ". Consulte os Termos de Serviço em https://axiva.com.br/termos.",
    }),
  });

  if (!response.ok) return false;

  await admin.from("axiva_paid_contract_acceptances")
    .update({ contract_email_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", contractId);

  return true;
}

async function activateContract(contractId: string, customerId?: string, subscriptionId?: string) {
  const { data: contract } = await admin
    .from("axiva_paid_contract_acceptances")
    .select("id,organization_id,user_id,plan_id,status,signer_email")
    .eq("id", contractId)
    .maybeSingle();

  if (!contract) return;

  const updates: Record<string, unknown> = { status: "paid", updated_at: new Date().toISOString() };
  if (customerId) updates.asaas_customer_id = customerId;
  if (subscriptionId) updates.asaas_subscription_id = subscriptionId;

  await admin.from("axiva_paid_contract_acceptances").update(updates).eq("id", contractId);

  await admin.from("user_plan_assignments").upsert({
    organization_id: contract.organization_id,
    user_id: contract.user_id,
    plan_id: contract.plan_id,
    status: "active",
    trial_started_at: null,
    trial_ends_at: null,
    assigned_at: new Date().toISOString(),
    assigned_by: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,user_id" });

  await sendContractEmail(contractId);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!WEBHOOK_TOKEN) return json({ error: "Webhook não configurado." }, 503);

  const receivedToken = req.headers.get("asaas-access-token") || "";
  if (receivedToken !== WEBHOOK_TOKEN) return json({ error: "Unauthorized" }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }

  const eventId = String(payload?.id || "");
  const event = String(payload?.event || "");
  if (!eventId || !event) return json({ error: "Evento inválido." }, 400);

  const { error: insertError } = await admin
    .from("axiva_asaas_webhook_events")
    .insert({ id: eventId, event, payload });

  if (insertError) {
    if (String(insertError.message || "").toLowerCase().includes("duplicate")) return json({ ok: true, duplicate: true });
    return json({ error: "Não foi possível registrar o evento." }, 500);
  }

  try {
    const checkout = payload?.checkout;
    const subscription = payload?.subscription;
    const payment = payload?.payment;

    if (event === "CHECKOUT_PAID" && checkout?.id) {
      const { data: contract } = await admin
        .from("axiva_paid_contract_acceptances")
        .select("id")
        .eq("checkout_id", String(checkout.id))
        .maybeSingle();

      if (contract) await activateContract(contract.id, checkout.customer || undefined);
    }

    if (event === "CHECKOUT_CANCELED" && checkout?.id) {
      await admin.from("axiva_paid_contract_acceptances")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("checkout_id", String(checkout.id))
        .eq("status", "accepted");
    }

    if (event === "CHECKOUT_EXPIRED" && checkout?.id) {
      await admin.from("axiva_paid_contract_acceptances")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("checkout_id", String(checkout.id))
        .eq("status", "accepted");
    }

    if (event === "SUBSCRIPTION_CREATED" || event === "SUBSCRIPTION_UPDATED") {
      const externalReference = String(subscription?.externalReference || "");
      const contractId = externalReference.startsWith("axiva-contract:")
        ? externalReference.slice("axiva-contract:".length)
        : "";

      if (contractId) {
        await admin.from("axiva_paid_contract_acceptances")
          .update({
            asaas_subscription_id: String(subscription.id || ""),
            asaas_customer_id: String(subscription.customer || ""),
            updated_at: new Date().toISOString(),
          })
          .eq("id", contractId);
      } else if (subscription?.id) {
        await admin.from("axiva_paid_contract_acceptances")
          .update({ asaas_subscription_id: String(subscription.id), asaas_customer_id: String(subscription.customer || ""), updated_at: new Date().toISOString() })
          .eq("asaas_subscription_id", String(subscription.id));
      }
    }

    if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
      const subscriptionId = String(payment?.subscription || "");
      const customerId = String(payment?.customer || "");
      const query = admin.from("axiva_paid_contract_acceptances").select("id,organization_id,user_id,plan_id").eq("status", "paid").limit(1);
      const { data: contracts } = subscriptionId
        ? await admin.from("axiva_paid_contract_acceptances").select("id,organization_id,user_id,plan_id").eq("asaas_subscription_id", subscriptionId).limit(1)
        : await admin.from("axiva_paid_contract_acceptances").select("id,organization_id,user_id,plan_id").eq("asaas_customer_id", customerId).eq("status", "paid").order("updated_at", { ascending: false }).limit(1);

      const contract = contracts?.[0];
      if (contract) {
        await admin.from("user_plan_assignments").upsert({
          organization_id: contract.organization_id,
          user_id: contract.user_id,
          plan_id: contract.plan_id,
          status: "active",
          trial_started_at: null,
          trial_ends_at: null,
          assigned_at: new Date().toISOString(),
          assigned_by: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id,user_id" });
      }
    }

    if (event === "PAYMENT_OVERDUE" || event === "PAYMENT_REFUNDED" || event === "PAYMENT_CHARGEBACK_REQUESTED") {
      const subscriptionId = String(payment?.subscription || "");
      if (subscriptionId) {
        const { data: contract } = await admin
          .from("axiva_paid_contract_acceptances")
          .select("organization_id,user_id")
          .eq("asaas_subscription_id", subscriptionId)
          .maybeSingle();

        if (contract) {
          await admin.from("user_plan_assignments")
            .update({ status: "suspended", updated_at: new Date().toISOString() })
            .eq("organization_id", contract.organization_id)
            .eq("user_id", contract.user_id);
        }
      }
    }

    if (event === "SUBSCRIPTION_INACTIVATED" || event === "SUBSCRIPTION_DELETED") {
      const subscriptionId = String(subscription?.id || "");
      if (subscriptionId) {
        const { data: contract } = await admin
          .from("axiva_paid_contract_acceptances")
          .select("organization_id,user_id")
          .eq("asaas_subscription_id", subscriptionId)
          .maybeSingle();

        if (contract) {
          await admin.from("user_plan_assignments")
            .update({ status: "suspended", updated_at: new Date().toISOString() })
            .eq("organization_id", contract.organization_id)
            .eq("user_id", contract.user_id);
        }
      }
    }

    await admin.from("axiva_asaas_webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
    return json({ ok: true });
  } catch (error) {
    return json({ error: "Evento recebido, mas o processamento falhou.", details: String(error?.message || error).slice(0, 200) }, 500);
  }
});
