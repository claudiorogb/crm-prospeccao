-- V70: nome comercial único por organização e métricas completas do Kanban.
-- A migração é retrocompatível com a V69: apenas adiciona dados ao retorno do RPC.

alter table public.organization_members
  add column if not exists display_name text;

update public.organization_members om
set display_name = btrim(p.full_name)
from public.profiles p
where p.id = om.user_id
  and nullif(btrim(om.display_name), '') is null;

alter table public.profiles
  alter column full_name set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_full_name_valid'
  ) then
    alter table public.profiles
      add constraint profiles_full_name_valid
      check (char_length(btrim(full_name)) between 2 and 80);
  end if;
end
$$;

alter table public.organization_members
  alter column display_name set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organization_members'::regclass
      and conname = 'organization_members_display_name_valid'
  ) then
    alter table public.organization_members
      add constraint organization_members_display_name_valid
      check (char_length(btrim(display_name)) between 2 and 80);
  end if;
end
$$;

create unique index if not exists organization_members_active_display_name_unique
  on public.organization_members (
    organization_id,
    lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g'))
  )
  where deleted_at is null and is_active = true;

create or replace function private.set_organization_member_display_name()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
begin
  select btrim(p.full_name)
    into v_name
  from public.profiles p
  where p.id = new.user_id;

  if v_name is null or char_length(v_name) < 2 then
    raise exception 'O usuário precisa informar como deseja ser chamado antes de entrar na empresa.';
  end if;

  new.display_name := regexp_replace(v_name, '\s+', ' ', 'g');
  return new;
end;
$$;

revoke all on function private.set_organization_member_display_name() from public;

drop trigger if exists trg_set_organization_member_display_name on public.organization_members;
create trigger trg_set_organization_member_display_name
before insert or update of user_id, organization_id, display_name
on public.organization_members
for each row
execute function private.set_organization_member_display_name();

create or replace function private.sync_profile_display_name_to_memberships()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.organization_members
  set display_name = regexp_replace(btrim(new.full_name), '\s+', ' ', 'g')
  where user_id = new.id;
  return new;
end;
$$;

revoke all on function private.sync_profile_display_name_to_memberships() from public;

drop trigger if exists trg_sync_profile_display_name on public.profiles;
create trigger trg_sync_profile_display_name
after update of full_name
on public.profiles
for each row
when (old.full_name is distinct from new.full_name)
execute function private.sync_profile_display_name_to_memberships();

create or replace function public.get_leads_page(
  p_organization_id uuid,
  p_search text default null,
  p_target_segment_id uuid default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  with allowed as (
    select 1
    where private.is_active_org_member(p_organization_id)
       or private.is_system_admin()
  ),
  params as (
    select greatest(1, least(coalesce(p_limit, 50), 100)) lim,
           greatest(coalesce(p_offset, 0), 0) off
  ),
  base as (
    select
      l.id,
      l.status,
      l.created_at,
      l.proposal_value,
      l.renegotiated_value,
      l.contract_value,
      l.next_contact_date,
      l.last_contact_date
    from public.leads l
    join allowed on true
    where l.organization_id = p_organization_id
      and l.deleted_at is null
      and (p_target_segment_id is null or l.target_segment_id = p_target_segment_id)
      and (p_status is null or l.status = p_status)
      and (
        p_search is null
        or btrim(p_search) = ''
        or l.business_name ilike '%' || btrim(p_search) || '%'
        or l.city ilike '%' || btrim(p_search) || '%'
        or l.phone ilike '%' || btrim(p_search) || '%'
      )
  ),
  status_summary as (
    select
      coalesce(jsonb_object_agg(status, lead_count), '{}'::jsonb) counts,
      coalesce(jsonb_object_agg(status, total_value), '{}'::jsonb) value_totals,
      coalesce(jsonb_object_agg(status, overdue_count), '{}'::jsonb) overdue_counts
    from (
      select
        status,
        count(*)::bigint lead_count,
        coalesce(sum(coalesce(contract_value, renegotiated_value, proposal_value, 0)), 0)::numeric total_value,
        count(*) filter (
          where status not in ('won', 'lost', 'not_interested', 'discarded')
            and next_contact_date < (now() at time zone 'America/Sao_Paulo')::date
            and (last_contact_date is null or last_contact_date < next_contact_date)
        )::bigint overdue_count
      from base
      group by status
    ) summary
  ),
  page_ids as (
    select b.id
    from base b, params p
    order by b.created_at desc, b.id desc
    limit (select lim from params)
    offset (select off from params)
  ),
  page_rows as (
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'organization_id', l.organization_id,
      'campaign_id', l.campaign_id,
      'target_segment_id', l.target_segment_id,
      'business_name', l.business_name,
      'segment', l.segment,
      'phone', l.phone,
      'website', l.website,
      'email', l.email,
      'address', l.address,
      'city', l.city,
      'state', l.state,
      'status', l.status,
      'contact_name', l.contact_name,
      'last_contact_date', l.last_contact_date,
      'last_contacted_at', l.last_contacted_at,
      'next_contact_date', l.next_contact_date,
      'commercial_notes', l.commercial_notes,
      'proposal_value', l.proposal_value,
      'proposal_sent_at', l.proposal_sent_at,
      'renegotiated_value', l.renegotiated_value,
      'contract_value', l.contract_value,
      'contract_signed_at', l.contract_signed_at,
      'lost_from_status', l.lost_from_status,
      'captured_by', l.captured_by,
      'assigned_to', l.assigned_to,
      'seller_id', coalesce(l.assigned_to, l.captured_by),
      'seller_name', coalesce(nullif(btrim(om.display_name), ''), 'Não atribuído'),
      'created_at', l.created_at,
      'campaigns', case when c.id is null then null else jsonb_build_object('name', c.name) end,
      'target_segments', case when ts.id is null then null else jsonb_build_object('name', ts.name) end
    ) order by l.created_at desc, l.id desc) rows
    from page_ids p
    join public.leads l on l.id = p.id
    left join public.campaigns c on c.id = l.campaign_id
    left join public.target_segments ts on ts.id = l.target_segment_id
    left join public.organization_members om
      on om.organization_id = l.organization_id
     and om.user_id = coalesce(l.assigned_to, l.captured_by)
     and om.deleted_at is null
     and om.is_active = true
  )
  select jsonb_build_object(
    'total', (select count(*)::bigint from base),
    'status_counts', (select counts from status_summary),
    'status_value_totals', (select value_totals from status_summary),
    'status_overdue_counts', (select overdue_counts from status_summary),
    'rows', coalesce((select rows from page_rows), '[]'::jsonb)
  );
$$;

revoke all on function public.get_leads_page(uuid, text, uuid, text, integer, integer) from public;
grant execute on function public.get_leads_page(uuid, text, uuid, text, integer, integer) to authenticated;
