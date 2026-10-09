import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    if (actorProfile?.account_status !== "active") return json({ error: "Forbidden" }, 403);

    const body = await req.json();
    const action = String(body?.action || "");
    const memberActions = new Set(["list_members", "add_member", "update_member", "remove_member"]);

    let actorOrgRole: string | null = null;
    if (memberActions.has(action)) {
      const organizationId = String(body?.organization_id || "");
      if (!organizationId) return json({ error: "organization_id is required" }, 400);

      const { data: actorMembership } = await admin
        .from("organization_members")
        .select("role,is_active,deleted_at")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .maybeSingle();

      actorOrgRole = actorMembership?.is_active && !actorMembership?.deleted_at
        ? String(actorMembership.role || "")
        : null;

      if (!sysAdmin && !["owner", "admin"].includes(actorOrgRole)) {
        return json({ error: "Você não tem permissão para gerenciar os usuários desta empresa." }, 403);
      }
    } else if (!sysAdmin) {
      return json({ error: "Forbidden" }, 403);
    }

    if (action === "list_users") {
      const authUsers = await listAllAuthUsers(admin);
      const ids = authUsers.map((u: any) => u.id);
      const [{ data: profiles }, { data: platformAdmins }, { data: memberships }] = await Promise.all([
        ids.length ? admin.from("profiles").select("id,full_name,account_status,created_at,status_changed_at,deleted_at").in("id", ids) : { data: [] },
        ids.length ? admin.from("system_admins").select("user_id").in("user_id", ids) : { data: [] },
        ids.length ? admin.from("organization_members").select("organization_id,user_id,role,is_active,organizations(id,name,is_active)").in("user_id", ids).is("deleted_at", null) : { data: [] },
      ]);
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      const adminSet = new Set((platformAdmins || []).map((a: any) => a.user_id));
      const memberMap = new Map<string, any[]>();
      for (const m of memberships || []) {
        if (!memberMap.has(m.user_id)) memberMap.set(m.user_id, []);
        memberMap.get(m.user_id)!.push(m);
      }
      return json({
        // Usuários arquivados ("Excluir") ficam preservados no banco, mas fora da lista.
        users: authUsers
          .filter((u: any) => !(profileMap.get(u.id) as any)?.deleted_at)
          .map((u: any) => {
            const profile: any = profileMap.get(u.id) || {};
            return {
              id: u.id,
              email: u.email || null,
              full_name: profile.full_name || u.user_metadata?.full_name || null,
              account_status: profile.account_status || "active",
              is_platform_admin: adminSet.has(u.id),
              organizations: memberMap.get(u.id) || [],
              email_confirmed_at: u.email_confirmed_at || null,
              last_sign_in_at: u.last_sign_in_at || null,
              created_at: u.created_at || profile.created_at || null,
            };
          }),
      });
    }

    if (action === "set_account_status") {
      const userId = String(body?.user_id || "");
      const status = String(body?.status || "");
      if (!userId || !["active", "inactive", "suspended"].includes(status)) return json({ error: "Invalid user status" }, 400);
      if (userId === user.id && status !== "active") return json({ error: "Você não pode bloquear o próprio usuário administrador." }, 400);
      const { error } = await admin.from("profiles").update({
        account_status: status, status_changed_at: new Date().toISOString(), status_changed_by: user.id,
      }).eq("id", userId);
      if (error) throw error;
      await admin.from("audit_logs").insert({ actor_user_id: user.id, action: "user_account_status_changed", entity_type: "user", entity_id: userId, metadata: { status } });
      return json({ ok: true });
    }

    if (action === "set_platform_role") {
      const userId = String(body?.user_id || "");
      const isAdmin = Boolean(body?.is_admin);
      if (!userId) return json({ error: "user_id is required" }, 400);
      if (userId === user.id && !isAdmin) return json({ error: "Você não pode remover o próprio acesso de administrador." }, 400);
      if (isAdmin) {
        const { error: adminError } = await admin.from("system_admins").upsert({ user_id: userId });
        if (adminError) throw adminError;
        const { error: unlinkError } = await admin.from("organization_members").delete().eq("user_id", userId);
        if (unlinkError) throw unlinkError;
      } else {
        const { error } = await admin.from("system_admins").delete().eq("user_id", userId);
        if (error) throw error;
      }
      await admin.from("audit_logs").insert({ actor_user_id: user.id, action: isAdmin ? "user_promoted_platform_admin" : "user_demoted_platform_admin", entity_type: "user", entity_id: userId });
      return json({ ok: true });
    }

    if (action === "assign_user_organization") {
      const userId = String(body?.user_id || "");
      const organizationId = String(body?.organization_id || "");
      const role = ["owner", "admin", "member"].includes(String(body?.role)) ? String(body.role) : "member";
      if (!userId || !organizationId) return json({ error: "user_id and organization_id are required" }, 400);
      const { data: platformAdmin } = await admin.from("system_admins").select("user_id").eq("user_id", userId).maybeSingle();
      if (platformAdmin) return json({ error: "Administrador da plataforma não pode ser vinculado a uma organização." }, 400);
      const { error: removeError } = await admin.from("organization_members").delete().eq("user_id", userId);
      if (removeError) throw removeError;
      const { error: addError } = await admin.from("organization_members").insert({ organization_id: organizationId, user_id: userId, role, is_active: true });
      if (addError) throw addError;
      if (role === "owner") {
        const { error: ownerError } = await admin.from("organizations").update({ created_by: userId, updated_at: new Date().toISOString() }).eq("id", organizationId);
        if (ownerError) throw ownerError;
      }
      await admin.from("audit_logs").insert({ organization_id: organizationId, actor_user_id: user.id, action: "user_assigned_organization", entity_type: "user", entity_id: userId, metadata: { role } });
      return json({ ok: true });
    }

    if (action === "remove_user_organization") {
      const userId = String(body?.user_id || "");
      const organizationId = body?.organization_id ? String(body.organization_id) : null;
      if (!userId) return json({ error: "user_id is required" }, 400);
      let query = admin.from("organization_members").delete().eq("user_id", userId);
      if (organizationId) query = query.eq("organization_id", organizationId);
      const { error } = await query;
      if (error) throw error;
      await admin.from("audit_logs").insert({ organization_id: organizationId, actor_user_id: user.id, action: "user_unlinked_organization", entity_type: "user", entity_id: userId });
      return json({ ok: true });
    }

    if (action === "delete_user") {
      const userId = String(body?.user_id || "");
      if (!userId) return json({ error: "user_id is required" }, 400);
      if (userId === user.id) return json({ error: "Você não pode excluir o próprio usuário administrador." }, 400);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
      await admin.from("audit_logs").insert({ actor_user_id: user.id, action: "user_deleted", entity_type: "user", entity_id: userId });
      return json({ ok: true });
    }

    if (action === "list_members") {
      const organizationId = String(body?.organization_id || "");
      const { data: memberships, error } = await admin.from("organization_members")
        .select("organization_id,user_id,role,is_active,created_at,display_name")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("created_at");
      if (error) throw error;
      const ids = (memberships || []).map((m: any) => m.user_id);
      const authUsers = ids.length ? await listAllAuthUsers(admin) : [];
      const users: Record<string, any> = {};
      for (const u of authUsers) if (ids.includes(u.id)) users[u.id] = { email: u.email || null, last_sign_in_at: u.last_sign_in_at || null };
      const { data: profiles } = ids.length ? await admin.from("profiles").select("id,account_status").in("id", ids) : { data: [] };
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      return json({ members: (memberships || []).map((m: any) => ({
        ...m, ...users[m.user_id], account_status: profileMap.get(m.user_id)?.account_status || "active",
      })) });
    }

    if (action === "add_member") {
      const organizationId = String(body?.organization_id || "");
      const email = String(body?.email || "").trim().toLowerCase();
      const role = ["owner", "admin", "member"].includes(String(body?.role)) ? String(body.role) : "member";
      if (!organizationId || !email) return json({ error: "organization_id and email are required" }, 400);
      if (role === "owner" && actorOrgRole !== "owner" && !sysAdmin) return json({ error: "Somente o proprietário pode definir outro proprietário." }, 403);

      const authUsers = await listAllAuthUsers(admin);
      let found = authUsers.find((u: any) => String(u.email || "").toLowerCase() === email) || null;

      if (found) {
        const { data: platformAdmin } = await admin.from("system_admins").select("user_id").eq("user_id", found.id).maybeSingle();
        if (platformAdmin) return json({ error: "Administrador da plataforma não pode ser vinculado a uma organização." }, 400);
        const { data: existingOrg } = await admin.from("organization_members").select("organization_id,role,is_active").eq("user_id", found.id).neq("organization_id", organizationId).eq("is_active", true).maybeSingle();
        if (existingOrg) return json({ error: "Este usuário já está vinculado a outra empresa." }, 409);
      } else {
        const { data: generated, error: generateError } = await admin.auth.admin.generateLink({
          type: "invite",
          email,
        });
        if (generateError || !generated?.user?.id || !generated?.properties?.action_link) {
          return json({ error: generateError?.message || "Não foi possível criar o convite para este e-mail." }, 400);
        }
        found = generated.user;
        const resendKey = Deno.env.get("RESEND_API_KEY") || "";
        if (!resendKey) {
          await admin.auth.admin.deleteUser(found.id);
          return json({ error: "Serviço de e-mail do CRM não está configurado." }, 503);
        }
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "AXIVA CRM <no-reply@auth.axiva.com.br>",
            to: [email],
            subject: "Convite para acessar o AXIVA CRM",
            html: `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#0B192C;line-height:1.5"><div style="max-width:560px;margin:40px auto;padding:32px;border:1px solid #e2e8f0;border-radius:14px"><h2>Convite para o AXIVA CRM</h2><p>Você foi convidado para acessar o AXIVA CRM.</p><p><a href="${generated.properties.action_link}" style="display:inline-block;padding:12px 20px;background:#00A88F;color:#fff;text-decoration:none;border-radius:8px">Aceitar convite</a></p></div></body></html>`
          }),
        });
        if (!emailResponse.ok) {
          const raw = await emailResponse.text();
          console.error("Resend invite error", raw.slice(0, 300));
          await admin.auth.admin.deleteUser(found.id);
          return json({ error: "Não foi possível enviar o convite por e-mail." }, 502);
        }
      }

      const { data: existingMembership } = await admin.from("organization_members").select("id,role").eq("organization_id", organizationId).eq("user_id", found.id).maybeSingle();
      if (existingMembership?.role === "owner" && actorOrgRole !== "owner" && !sysAdmin) return json({ error: "Somente o proprietário pode alterar o proprietário da empresa." }, 403);
      if (existingMembership) {
        const { error } = await admin.from("organization_members").update({ role, is_active: true, deleted_at: null, deleted_by: null }).eq("id", existingMembership.id);
        if (error) throw error;
      } else {
        const { error } = await admin.from("organization_members").insert({ organization_id: organizationId, user_id: found.id, role, is_active: true });
        if (error) throw error;
      }

      await admin.from("audit_logs").insert({ organization_id: organizationId, actor_user_id: user.id, action: "organization_member_added", entity_type: "organization_member", entity_id: found.id, metadata: { email, role } });
      return json({ ok: true, user_id: found.id, email, role });
    }

    if (action === "update_member") {
      const organizationId = String(body?.organization_id || "");
      const userId = String(body?.user_id || "");
      const patch: Record<string, unknown> = {};
      if (typeof body?.is_active === "boolean") patch.is_active = body.is_active;
      if (["owner", "admin", "member"].includes(String(body?.role))) patch.role = String(body.role);
      if (!organizationId || !userId || !Object.keys(patch).length) return json({ error: "Invalid member update" }, 400);
      if (userId === user.id && patch.role) return json({ error: "Você não pode alterar o próprio nível hierárquico." }, 400);

      const { data: target } = await admin.from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
      if (!target) return json({ error: "Usuário não pertence a esta empresa." }, 404);
      if (target.role === "owner" && actorOrgRole !== "owner" && !sysAdmin) return json({ error: "Somente o proprietário pode alterar o proprietário da empresa." }, 403);
      if (patch.role === "owner" && actorOrgRole !== "owner" && !sysAdmin) return json({ error: "Somente o proprietário pode definir outro proprietário." }, 403);

      const { error } = await admin.from("organization_members").update(patch).eq("organization_id", organizationId).eq("user_id", userId);
      if (error) throw error;
      if (patch.role === "owner") {
        const { error: ownerError } = await admin.from("organizations").update({ created_by: userId, updated_at: new Date().toISOString() }).eq("id", organizationId);
        if (ownerError) throw ownerError;
      }
      await admin.from("audit_logs").insert({ organization_id: organizationId, actor_user_id: user.id, action: "organization_member_updated", entity_type: "organization_member", entity_id: userId, metadata: patch });
      return json({ ok: true });
    }

    if (action === "remove_member") {
      const organizationId = String(body?.organization_id || "");
      const userId = String(body?.user_id || "");
      if (!organizationId || !userId) return json({ error: "organization_id and user_id are required" }, 400);
      if (userId === user.id) return json({ error: "Você não pode remover o próprio acesso à empresa." }, 400);
      const { data: target } = await admin.from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
      if (!target) return json({ error: "Usuário não pertence a esta empresa." }, 404);
      if (target.role === "owner" && actorOrgRole !== "owner" && !sysAdmin) return json({ error: "Somente o proprietário pode remover o proprietário da empresa." }, 403);
      const { error } = await admin.from("organization_members").update({ is_active: false, deleted_at: new Date().toISOString(), deleted_by: user.id }).eq("organization_id", organizationId).eq("user_id", userId);
      if (error) throw error;
      await admin.from("audit_logs").insert({ organization_id: organizationId, actor_user_id: user.id, action: "organization_member_removed", entity_type: "organization_member", entity_id: userId });
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("admin_manage_organizations error", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
