create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_locale text not null default 'he' check (preferred_locale in ('he', 'en', 'am', 'fr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  schema_version integer not null default 1 check (schema_version = 1),
  updated_at timestamptz not null default now(),
  constraint app_snapshots_payload_size check (octet_length(payload::text) <= 1000000)
);

create table if not exists public.consent_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose = 'cloud_sync'),
  statement_version text not null check (length(statement_version) between 1 and 80),
  locale text not null check (locale in ('he', 'en', 'am', 'fr')),
  accepted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (user_id, purpose, statement_version)
);

alter table public.user_profiles enable row level security;
alter table public.app_snapshots enable row level security;
alter table public.consent_acceptances enable row level security;

revoke all on table public.user_profiles from anon, authenticated;
grant select on table public.user_profiles to authenticated;
grant insert (user_id, preferred_locale) on table public.user_profiles to authenticated;
grant update (preferred_locale) on table public.user_profiles to authenticated;

create policy "users read their own profile" on public.user_profiles for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users create their own profile" on public.user_profiles for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users update their own profile" on public.user_profiles for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on table public.app_snapshots from anon, authenticated;
grant select on table public.app_snapshots to authenticated;
grant insert (user_id, payload, schema_version) on table public.app_snapshots to authenticated;
grant update (payload, schema_version) on table public.app_snapshots to authenticated;
grant delete on table public.app_snapshots to authenticated;

create policy "users read their own snapshot"
on public.app_snapshots for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "users create their own snapshot"
on public.app_snapshots for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "users update their own snapshot"
on public.app_snapshots for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "users delete their own snapshot"
on public.app_snapshots for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on table public.consent_acceptances from anon, authenticated;
grant select on table public.consent_acceptances to authenticated;
grant insert (user_id, purpose, statement_version, locale) on table public.consent_acceptances to authenticated;
grant update (locale, accepted_at, withdrawn_at) on table public.consent_acceptances to authenticated;

create policy "users read their own consent" on public.consent_acceptances for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users record their own consent" on public.consent_acceptances for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users update their own consent" on public.consent_acceptances for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.touch_app_snapshot_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_app_snapshot_updated_at() from public, anon, authenticated;

drop trigger if exists app_snapshots_touch_updated_at on public.app_snapshots;
create trigger app_snapshots_touch_updated_at
before update on public.app_snapshots
for each row execute function public.touch_app_snapshot_updated_at();
