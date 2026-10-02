import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_USER_LIMIT = 100;
const DEFAULT_COMPANY_LIMIT = 1000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function validInteger(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

async function listAllAuthUsers(admin: any) {
  const users: any[] = [];
  let page = 1;
  while (page <= 50) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    users.push(...(data.users || []));
    if ((data.users || []).length < 100) break;
    page += 1;
  }
  return users;
}

async function writeAudit(admin: any, actorId: string, organizationId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
  await admin.from("audit_logs").insert({
    organization_id: organizationId,
    actor_user_id: actorId,
    action,
    entity_type: "ai_limit",
    entity_id: entityId,
    metadata,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const { data: sysAdmin } = await admin
      .from("system_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const { data: actorProfile } = await admin
      .from("profiles")
      .select("account_status")
      .eq("id", user.id)
      .maybeSingle();

    if (!sysAdmin || actorProfile?.account_status !== "active") {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "list_organizations") {
      const { data: organizations, error: orgError } = await admin
        .from("organizations")
        .select("id,name,is_active,is_sandbox,created_at,deleted_at")
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (orgError) throw orgError;

      const ids = (organizations || []).map((org: any) => org.id);
      const [{ data: settings, error: settingsError }, { data: memberships, error: membershipError }] = ids.length
        ? await Promise.all([
            admin.from("ai_organization_settings")
              .select("organization_id,enabled,daily_message_limit,daily_request_limit")
              .in("organization_id", ids),
            admin.from("organization_members")
              .select("organization_id,user_id,is_active,deleted_at")
              .in("organization_id", ids)
              .is("deleted_at", null),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (settingsError) throw settingsError;
      if (membershipError) throw membershipError;

      const settingsMap = new Map((settings || []).map((row: any) => [row.organization_id, row]));
      const memberCounts = new Map<string, number>();
      for (const member of memberships || []) {
        if (!member.is_active) continue;
        memberCounts.set(member.organization_id, (memberCounts.get(member.organization_id) || 0) + 1);
      }

      return json({
        organizations: (organizations || []).map((org: any) => {
          const setting: any = settingsMap.get(org.id) || {};
          return {
            ...org,
            ai_enabled: setting.enabled === true,
            daily_message_limit: Number(setting.daily_message_limit || DEFAULT_USER_LIMIT),
            daily_request_limit: Number(setting.daily_request_limit || DEFAULT_COMPANY_LIMIT),
            active_user_count: memberCounts.get(org.id) || 0,
          };
        }),
      });
    }

    if (action === "list_users") {
      const organizationId = String(body?.organization_id || "");
      if (!organizationId) return json({ error: "organization_id is required" }, 400);

      const { data: organization, error: orgError } = await admin
        .from("organizations")
        .select("id,name,deleted_at")
        .eq("id", organizationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (orgError) throw orgError;
      if (!organization) return json({ error: "Empresa não encontrada." }, 404);

      const [{ data: memberships, error: memberError }, { data: aiSetting, error: settingError }, { data: overrides, error: overrideError }] = await Promise.all([
        admin.from("organization_members")
          .select("organization_id,user_id,role,is_active,created_at,deleted_at,display_name")
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true }),
        admin.from("ai_organization_settings")
          .select("daily_message_limit,daily_request_limit,enabled")
          .eq("organization_id", organizationId)
          .maybeSingle(),
        admin.from("ai_user_settings")
          .select("user_id,daily_message_limit")
          .eq("organization_id", organizationId),
      ]);
      if (memberError) throw memberError;
      if (settingError) throw settingError;
      if (overrideError) throw overrideError;

      const memberIds = (memberships || []).map((member: any) => member.user_id);
      const [{ data: profiles, error: profileError }, authUsers] = memberIds.length
        ? await Promise.all([
            admin.from("profiles").select("id,full_name,account_status").in("id", memberIds),
            listAllAuthUsers(admin),
          ])
        : [{ data: [], error: null }, []];
      if (profileError) throw profileError;

      const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
      const authMap = new Map((authUsers || []).filter((authUser: any) => memberIds.includes(authUser.id)).map((authUser: any) => [authUser.id, authUser]));
      const overrideMap = new Map((overrides || []).map((item: any) => [item.user_id, Number(item.daily_message_limit)]));
      const defaultUserLimit = Number(aiSetting?.daily_message_limit || DEFAULT_USER_LIMIT);

      return json({
        organization: {
          id: organization.id,
          name: organization.name,
          ai_enabled: aiSetting?.enabled === true,
          daily_message_limit: defaultUserLimit,
          daily_request_limit: Number(aiSetting?.daily_request_limit || DEFAULT_COMPANY_LIMIT),
        },
        users: (memberships || []).map((member: any) => {
          const profile: any = profileMap.get(member.user_id) || {};
          const authUser: any = authMap.get(member.user_id) || {};
          const override = overrideMap.has(member.user_id) ? overrideMap.get(member.user_id) : null;
          return {
            user_id: member.user_id,
            full_name: profile.full_name || member.display_name || authUser.user_metadata?.full_name || null,
            email: authUser.email || null,
            role: member.role,
            is_active: member.is_active === true,
            account_status: profile.account_status || "active",
            daily_message_limit_override: override,
            effective_daily_message_limit: override ?? defaultUserLimit,
          };
        }),
      });
    }

    if (action === "save_organization_limits") {
      const organizationId = String(body?.organization_id || "");
      const dailyMessageLimit = validInteger(body?.daily_message_limit, 1, 1000);
      const dailyRequestLimit = validInteger(body?.daily_request_limit, 1, 100000);
      if (!organizationId || dailyMessageLimit === null || dailyRequestLimit === null) {
        return json({ error: "Informe limites válidos: padrão por usuário entre 1 e 1000 e total da empresa entre 1 e 100000." }, 400);
      }

      const { data: organization, error: orgError } = await admin
        .from("organizations")
        .select("id")
        .eq("id", organizationId)
        .is("deleted_at", null)
        .maybeSingle();
      if (orgError) throw orgError;
      if (!organization) return json({ error: "Empresa não encontrada." }, 404);

      const { data: current, error: currentError } = await admin
        .from("ai_organization_settings")
        .select("enabled")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (currentError) throw currentError;

      const { error: saveError } = await admin.from("ai_organization_settings").upsert({
        organization_id: organizationId,
        enabled: current?.enabled === true,
        daily_message_limit: dailyMessageLimit,
        daily_request_limit: dailyRequestLimit,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id" });
      if (saveError) throw saveError;

      await writeAudit(admin, user.id, organizationId, "ai_company_limits_updated", organizationId, {
        daily_message_limit: dailyMessageLimit,
        daily_request_limit: dailyRequestLimit,
      });
      return json({ ok: true });
    }

    if (action === "save_user_limit") {
      const organizationId = String(body?.organization_id || "");
      const userId = String(body?.user_id || "");
      const rawLimit = body?.daily_message_limit;
      const removeOverride = rawLimit === null || rawLimit === "";
      const dailyMessageLimit = removeOverride ? null : validInteger(rawLimit, 1, 1000);
      if (!organizationId || !userId || (!removeOverride && dailyMessageLimit === null)) {
        return json({ error: "Informe um usuário e um limite individual entre 1 e 1000, ou deixe em branco para usar o padrão da empresa." }, 400);
      }

      const { data: membership, error: memberError } = await admin
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!membership) return json({ error: "Esse usuário não pertence à empresa selecionada." }, 404);

      if (removeOverride) {
        const { error } = await admin.from("ai_user_settings")
          .delete()
          .eq("organization_id", organizationId)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { error } = await admin.from("ai_user_settings").upsert({
          organization_id: organizationId,
          user_id: userId,
          daily_message_limit: dailyMessageLimit,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id,user_id" });
        if (error) throw error;
      }

      await writeAudit(admin, user.id, organizationId, "ai_user_limit_updated", userId, {
        daily_message_limit: dailyMessageLimit,
        uses_company_default: removeOverride,
      });
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
