-- supabase/migrations/202610070001_open_banking_connections.sql

alter table public.consent_acceptances drop constraint if exists consent_acceptances_purpose_check;
alter table public.consent_acceptances add constraint consent_acceptances_purpose_check
  check (purpose in ('cloud_sync', 'open_banking'));

create table if not exists public.open_banking_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null check (length(source_id) between 1 and 100),
  status text not null default 'active' check (status in ('active', 'revoked')),
  consent_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.open_banking_tokens (
  connection_id uuid primary key references public.open_banking_connections(id) on delete cascade,
  encrypted_refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.open_banking_connections enable row level security;
alter table public.open_banking_tokens enable row level security;

revoke all on table public.open_banking_connections from anon, authenticated;
grant select on table public.open_banking_connections to authenticated;
grant insert (user_id, source_id, status, consent_expires_at) on table public.open_banking_connections to authenticated;
grant update (status, consent_expires_at) on table public.open_banking_connections to authenticated;
grant delete on table public.open_banking_connections to authenticated;

create policy "users read their own connections" on public.open_banking_connections for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users create their own connections" on public.open_banking_connections for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users update their own connections" on public.open_banking_connections for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users delete their own connections" on public.open_banking_connections for delete to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

-- Tokens carry no user_id of their own: ownership is proven by joining back to the
-- connection row, so a token can never be read, written or deleted without also
-- passing the connections policy above.
revoke all on table public.open_banking_tokens from anon, authenticated;
grant select on table public.open_banking_tokens to authenticated;
grant insert (connection_id, encrypted_refresh_token) on table public.open_banking_tokens to authenticated;
grant update (encrypted_refresh_token) on table public.open_banking_tokens to authenticated;
grant delete on table public.open_banking_tokens to authenticated;

create policy "users read their own tokens" on public.open_banking_tokens for select to authenticated
using (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
));
create policy "users write their own tokens" on public.open_banking_tokens for insert to authenticated
with check (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
));
create policy "users update their own tokens" on public.open_banking_tokens for update to authenticated
using (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
));
create policy "users delete their own tokens" on public.open_banking_tokens for delete to authenticated
using (exists (
  select 1 from public.open_banking_connections c
  where c.id = connection_id and c.user_id = (select auth.uid())
));

drop trigger if exists open_banking_tokens_touch_updated_at on public.open_banking_tokens;
create trigger open_banking_tokens_touch_updated_at
before update on public.open_banking_tokens
for each row execute function public.touch_app_snapshot_updated_at();

comment on table public.open_banking_connections is 'A household''s connection to one Open Banking source. No account number or card number is stored here.';
comment on table public.open_banking_tokens is 'The encrypted refresh token for one connection. Encrypted by the server before it arrives; never readable as plaintext from Postgres.';
