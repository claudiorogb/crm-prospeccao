-- Página "Tutoriais": vídeos do YouTube organizados por categoria.
-- Todos os usuários logados leem; somente administradores do sistema criam, editam e apagam.

create table if not exists public.tutorial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tutorial_videos (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.tutorial_categories(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 140),
  description text check (description is null or char_length(description) <= 2000),
  youtube_id text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tutorial_videos_category_idx on public.tutorial_videos(category_id, position);

alter table public.tutorial_categories enable row level security;
alter table public.tutorial_videos enable row level security;

revoke all on public.tutorial_categories from anon, authenticated;
revoke all on public.tutorial_videos from anon, authenticated;
grant select, insert, update, delete on public.tutorial_categories to authenticated;
grant select, insert, update, delete on public.tutorial_videos to authenticated;

create policy tutorial_categories_read on public.tutorial_categories
  for select to authenticated using (true);
create policy tutorial_categories_admin_write on public.tutorial_categories
  for all to authenticated
  using ((select private.is_system_admin()))
  with check ((select private.is_system_admin()));

create policy tutorial_videos_read on public.tutorial_videos
  for select to authenticated using (true);
create policy tutorial_videos_admin_write on public.tutorial_videos
  for all to authenticated
  using ((select private.is_system_admin()))
  with check ((select private.is_system_admin()));
