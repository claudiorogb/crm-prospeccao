drop function if exists public.admin_set_lead_capture_settings(uuid, integer, integer);

create or replace function public.admin_set_lead_capture_settings(
  p_organization_id uuid,
  p_weekly_limit integer,
  p_leads_per_capture integer,
  p_calls_per_capture integer
)
returns table(weekly_limit integer, leads_per_capture integer, calls_per_capture integer)
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not private.is_system_admin() then raise exception 'Forbidden'; end if;
  if p_weekly_limit is not null and p_weekly_limit < 0 then raise exception 'Weekly limit must be null or zero or greater'; end if;
  if p_leads_per_capture < 1 then raise exception 'Leads per capture must be one or greater'; end if;
  if p_calls_per_capture < 1 or p_calls_per_capture > 20 then raise exception 'Google search calls per capture must be between 1 and 20'; end if;

  update public.organization_settings
  set lead_capture_weekly_limit = p_weekly_limit,
      google_places_leads_per_capture = p_leads_per_capture,
      google_places_calls_per_capture = p_calls_per_capture,
      updated_at = now()
  where organization_id = p_organization_id
  returning lead_capture_weekly_limit, google_places_leads_per_capture, google_places_calls_per_capture
  into weekly_limit, leads_per_capture, calls_per_capture;

  if not found then raise exception 'Organization settings not found'; end if;
  return next;
end;
$function$;