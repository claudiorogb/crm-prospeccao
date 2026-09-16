create or replace function public.axiva_claim_inbound_forward(p_email_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id text;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if p_email_id is null or length(p_email_id) < 10 or length(p_email_id) > 128 then raise exception 'Invalid email ID'; end if;
  insert into public.axiva_inbound_forwarding(received_email_id)
  values (p_email_id)
  on conflict (received_email_id) do update set
    status = 'processing', attempts = axiva_inbound_forwarding.attempts + 1,
    last_error = null, updated_at = now()
  where axiva_inbound_forwarding.status = 'failed'
     or (axiva_inbound_forwarding.status = 'processing' and axiva_inbound_forwarding.updated_at < now() - interval '10 minutes')
  returning received_email_id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.axiva_claim_inbound_forward(text) from public, anon, authenticated;
grant execute on function public.axiva_claim_inbound_forward(text) to service_role;
