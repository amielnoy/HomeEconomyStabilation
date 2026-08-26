/* PostgREST's `resolution=merge-duplicates` compiles to
   `insert ... on conflict (pk) do update set <every column in the body> = excluded.<column>`,
   and the body must carry the conflict key to identify the row. The column-level
   update grants therefore have to cover the key columns too, or the *second* save of
   a profile, snapshot or consent fails with 42501 while the first still succeeds.

   Widening the grant does not widen what a user can reach: the update policies carry
   `with check (auth.uid() = user_id)`, so a row still cannot be moved to another
   owner, and `purpose` remains pinned to 'cloud_sync' by its check constraint. */

grant update (user_id) on table public.user_profiles to authenticated;
grant update (user_id) on table public.app_snapshots to authenticated;
grant update (user_id, purpose, statement_version) on table public.consent_acceptances to authenticated;
