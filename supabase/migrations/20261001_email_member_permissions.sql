-- Allow active organization members to use the CRM e-mail features exposed in the UI.
-- Keeps all existing organization/account checks in private.has_org_role.

do $$
declare
  r record;
  ddl text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'add_manual_email_prospect',
        'cancel_email_campaign',
        'clone_email_campaign_for_resend',
        'confirm_email_campaign_compliance',
        'create_email_campaign',
        'create_email_campaign_v2',
        'create_email_prospecting_sequence',
        'import_email_marketing_contacts',
        'queue_email_campaign',
        'register_email_campaign_attachment',
        'set_email_campaign_recipients'
      )
  loop
    ddl := pg_get_functiondef(r.oid);
    ddl := replace(ddl, 'ARRAY[''admin'',''owner'']::text[]', 'ARRAY[''member'',''admin'',''owner'']::text[]');
    ddl := replace(ddl, 'array[''admin'',''owner'']::text[]', 'array[''member'',''admin'',''owner'']::text[]');
    execute ddl;
  end loop;
end
$$;