-- AXIVA CRM - central file security gate
-- Quarantine is private and accessible only through trusted server-side code.
create table if not exists public.file_security_scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  source text not null,
  target_bucket text not null,
  target_path text not null,
  quarantine_path text,
  original_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  policy_status text not null check (policy_status in ('allowed','blocked','error')),
  antivirus_status text not null default 'not_configured' check (antivirus_status in ('not_configured','clean','infected','error')),
  scan_engine text not null default 'builtin-policy',
  findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  scanned_at timestamptz not null default now()
);

create index if not exists file_security_scans_org_created_idx
  on public.file_security_scans (organization_id, created_at desc);

create index if not exists file_security_scans_sha256_idx
  on public.file_security_scans (sha256);

alter table public.file_security_scans enable row level security;

revoke all on table public.file_security_scans from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('file-quarantine', 'file-quarantine', false, 15728640)
on conflict (id) do update
set public = false,
    file_size_limit = 15728640;
