alter table public.app_snapshots
  alter column schema_version set default 2;

alter table public.app_snapshots
  drop constraint if exists app_snapshots_schema_version_check;

alter table public.app_snapshots
  add constraint app_snapshots_schema_version_check check (schema_version = 2) not valid;

comment on constraint app_snapshots_schema_version_check on public.app_snapshots is
  'New and updated snapshots must use schema v2. The constraint remains NOT VALID so legacy v1 rows are not relabelled or destroyed.';
