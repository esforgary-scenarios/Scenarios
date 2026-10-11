-- Run once in the Supabase SQL editor. Safe to rerun for this application.
-- Disable public sign-ups in Authentication settings; create your owner account there.
create schema if not exists private;

-- The browser's 40-day deadline is also enforced at the database and storage layers.
-- Only the authenticated caller's own session is inspected; no auth rows are exposed.
create or replace function private.kadr_session_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions as s
    where s.id::text = (select auth.jwt() ->> 'session_id')
      and s.user_id = (select auth.uid())
      and s.created_at > now() - interval '40 days'
  );
$$;
revoke all on function private.kadr_session_active() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.kadr_session_active() to authenticated;

-- A narrow RPC lets the client distinguish an expired session from an empty workspace.
create or replace function public.kadr_session_active()
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.kadr_session_active(); $$;
revoke all on function public.kadr_session_active() from public, anon;
grant execute on function public.kadr_session_active() to authenticated;

create table if not exists public.workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  videos jsonb not null default '[]'::jsonb check (jsonb_typeof(videos) = 'array'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
-- Independent phrase library, also applied safely when upgrading an existing workspace.
alter table public.workspaces
  add column if not exists quotes jsonb not null default '[]'::jsonb
  check (jsonb_typeof(quotes) = 'array');
-- Shared Google Fonts collection. Editable photo projects live inside their video snapshots.
alter table public.workspaces
  add column if not exists fonts jsonb not null default '[]'::jsonb
  check (jsonb_typeof(fonts) = 'array');
revoke all on public.workspaces from anon, authenticated;
grant select, insert, update on public.workspaces to authenticated;

create or replace function private.kadr_workspace_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists kadr_workspace_revision on public.workspaces;
create trigger kadr_workspace_revision before update on public.workspaces
for each row execute function private.kadr_workspace_revision();

drop policy if exists kadr_workspace_select on public.workspaces;
create policy kadr_workspace_select on public.workspaces for select to authenticated
using (user_id = (select auth.uid()) and (select private.kadr_session_active()));
drop policy if exists kadr_workspace_insert on public.workspaces;
create policy kadr_workspace_insert on public.workspaces for insert to authenticated
with check (user_id = (select auth.uid()) and (select private.kadr_session_active()));
drop policy if exists kadr_workspace_update on public.workspaces;
create policy kadr_workspace_update on public.workspaces for update to authenticated
using (user_id = (select auth.uid()) and (select private.kadr_session_active()))
with check (user_id = (select auth.uid()) and (select private.kadr_session_active()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('script-assets', 'script-assets', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists kadr_images_select on storage.objects;
create policy kadr_images_select on storage.objects for select to authenticated
using (bucket_id = 'script-assets' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.kadr_session_active()));
drop policy if exists kadr_images_insert on storage.objects;
create policy kadr_images_insert on storage.objects for insert to authenticated
with check (bucket_id = 'script-assets' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.kadr_session_active()));
drop policy if exists kadr_images_delete on storage.objects;
create policy kadr_images_delete on storage.objects for delete to authenticated
using (bucket_id = 'script-assets' and (storage.foldername(name))[1] = (select auth.uid())::text and (select private.kadr_session_active()));
