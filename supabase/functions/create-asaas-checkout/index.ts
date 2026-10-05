import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLANS: Record<string, { name: string; value: number }> = {
  axiva: { name: "AXIVA", value: 45 },
  axiva_plus: { name: "AXIVA Plus", value: 79.8 },
  axiva_max: { name: "AXIVA Max", value: 164.8 },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function brazilDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function ensureAsaasWebhook(apiKey: string, admin: any) {
  const webhookUrl = supabaseUrlForWebhook();
  const events = [
    "CHECKOUT_CREATED",
    "CHECKOUT_PAID",
    "CHECKOUT_CANCELED",
    "CHECKOUT_EXPIRED",
    "SUBSCRIPTION_CREATED",
    "SUBSCRIPTION_UPDATED",
    "SUBSCRIPTION_INACTIVATED",
    "SUBSCRIPTION_DELETED",
    "PAYMENT_CONFIRMED",
    "PAYMENT_RECEIVED",
    "PAYMENT_OVERDUE",
    "PAYMENT_REFUNDED",
    "PAYMENT_CHARGEBACK_REQUESTED",
  ];

  const { data: config } = await admin
    .from("axiva_asaas_config")
    .select("id,webhook_id,webhook_token")
    .eq("id", 1)
    .maybeSingle();

  if (!config?.webhook_token) throw new Error("Configuração do Webhook Asaas indisponível.");

  if (config.webhook_id) {
    const existingResponse = await fetch("https://api.asaas.com/v3/webhooks/" + encodeURIComponent(config.webhook_id), {
      headers: { access_token: apiKey, Accept: "application/json" },
    });
    if (existingResponse.ok) {
      const existing = await existingResponse.json();
      if (existing?.enabled && existing?.url === webhookUrl) return;
    }
  }

  const listResponse = await fetch("https://api.asaas.com/v3/webhooks", {
    headers: { access_token: apiKey, Accept: "application/json" },
  });
  if (listResponse.ok) {
    const list = await listResponse.json();
    const existing = (list?.data || []).find((item: any) => item?.url === webhookUrl);
    if (existing?.id) {
      await admin.from("axiva_asaas_config")
        .update({ webhook_id: existing.id, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (existing.enabled) return;
    }
  }

  const createResponse = await fetch("https://api.asaas.com/v3/webhooks", {
    method: "POST",
    headers: {
      access_token: apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: "AXIVA CRM - Cobranças",
      url: webhookUrl,
      email: "resposta@axiva.com.br",
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: config.webhook_token,
      sendType: "SEQUENTIALLY",
      events,
    }),
  });

  if (!createResponse.ok) {
    const raw = await createResponse.text();
    throw new Error("Não foi possível configurar o Webhook do Asaas: " + raw.slice(0, 220));
  }

  const created = await createResponse.json();
  await admin.from("axiva_asaas_config")
    .update({ webhook_id: created.id, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

function supabaseUrlForWebhook() {
  const base = Deno.env.get("SUPABASE_URL") || "";
  return base.replace(/\/$/, "") + "/functions/v1/asaas-webhook";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("ASAAS_API_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!apiKey || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "A integração de cobrança ainda não foi configurada no servidor." }, 503);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = authHeader.slice(7);
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  const user = userResult?.user;
  if (userError || !user) return json({ error: "Sessão inválida." }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,full_name,account_status,deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || profile.account_status !== "active" || profile.deleted_at) {
    return json({ error: "Acesso indisponível para esta conta." }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const planId = String(body?.planId || "");
  const plan = PLANS[planId];
  if (!plan) return json({ error: "Plano inválido." }, 400);

  const { data: memberships, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id,role,is_active,deleted_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .limit(2);

  if (membershipError || (memberships || []).length !== 1) {
    return json({ error: "Não foi possível identificar uma única organização ativa para esta contratação." }, 403);
  }

  const organizationId = String(memberships[0].organization_id);

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id,name,is_active,deleted_at,cnpj")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError || !organization?.is_active || organization.deleted_at) {
    return json({ error: "Organização indisponível para contratação." }, 403);
  }

  const { data: currentPlan } = await admin
    .from("user_plan_assignments")
    .select("plan_id,status,trial_ends_at")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (currentPlan?.status === "active" && !currentPlan?.trial_ends_at) {
    return json({ error: "Esta conta já possui um plano pago ativo." }, 409);
  }

  const { data: contract, error: contractError } = await admin
    .from("axiva_paid_contract_acceptances")
    .select("id,plan_id,status,accepted_at,signer_name,signer_email")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("plan_id", planId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (contractError || !contract) {
    return json({ error: "O contrato de uso precisa ser aceito antes do pagamento." }, 409);
  }

  try { await ensureAsaasWebhook(apiKey, admin); } catch (webhookError) { return json({ error: String(webhookError?.message || webhookError) }, 503); }

  const externalReference = "axiva-contract:" + contract.id;
  const nextDueDate = brazilDate();

  const payload: Record<string, unknown> = {
    billingTypes: ["PIX", "CREDIT_CARD"],
    chargeTypes: ["RECURRENT"],
    minutesToExpire: 60,
    externalReference,
    callback: {
      successUrl: "https://crm.axiva.com.br/?billing=success",
      cancelUrl: "https://crm.axiva.com.br/?billing=cancelled",
      expiredUrl: "https://crm.axiva.com.br/?billing=expired",
    },
    items: [{
      name: "AXIVA CRM - " + plan.name,
      description: "Assinatura mensal do AXIVA CRM",
      quantity: 1,
      value: plan.value,
    }],
    subscription: {
      cycle: "MONTHLY",
      nextDueDate,
    },
    customerData: {
      name: String(organization.name || profile.full_name || user.email || "Cliente AXIVA"),
      cpfCnpj: String(organization.cnpj || ""),
      email: String(user.email || ""),
    },
  };

  try {
    const response = await fetch("https://api.asaas.com/v3/checkouts", {
      method: "POST",
      headers: {
        access_token: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }

    if (!response.ok) {
      return json({
        error: "Não foi possível criar o checkout no Asaas.",
        details: data?.errors || undefined,
      }, response.status >= 500 ? 502 : 400);
    }

    const checkoutId = String(data?.id || "");
    const checkoutUrl = String(data?.link || (checkoutId
      ? "https://asaas.com/checkoutSession/show?id=" + encodeURIComponent(checkoutId)
      : ""));

    if (!checkoutUrl || !checkoutId) {
      return json({ error: "O Asaas não retornou um checkout válido." }, 502);
    }

    const { error: saveError } = await admin
      .from("axiva_paid_contract_acceptances")
      .update({ checkout_id: checkoutId, updated_at: new Date().toISOString() })
      .eq("id", contract.id);

    if (saveError) return json({ error: "Checkout criado, mas não foi possível registrar a contratação. Não prossiga com outro pagamento; entre em contato com o suporte." }, 500);

    return json({ checkoutUrl, checkoutId, planId, planName: plan.name, value: plan.value });
  } catch (error) {
    return json({
      error: "Não foi possível conectar ao Asaas.",
      details: String(error?.message || error).slice(0, 180),
    }, 502);
  }
});
