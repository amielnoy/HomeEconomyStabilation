/* The same trap 202608260001 documents, on the table 202610070001 added: PostgREST's
   `resolution=merge-duplicates` compiles to
   `insert ... on conflict (connection_id) do update set <every column in the body> = excluded.<column>`,
   and the refresh-token upsert's body carries the conflict key `connection_id`. A grant of
   `update (encrypted_refresh_token)` alone therefore lets the first token write (a plain
   insert) succeed and fails the *second* one — the rotation every sync performs — with 42501.

   Widening the grant does not widen what a user can reach: the update policy on
   open_banking_tokens still requires, in both `using` and `with check`, that the token's
   connection belongs to `auth.uid()`, so a token cannot be moved onto another user's
   connection. */

grant update (connection_id, encrypted_refresh_token) on table public.open_banking_tokens to authenticated;
