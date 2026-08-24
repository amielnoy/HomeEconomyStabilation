drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at
before update on public.user_profiles
for each row execute function public.touch_app_snapshot_updated_at();

comment on table public.user_profiles is 'Minimal user preferences owned by auth.uid().';
comment on table public.app_snapshots is 'One privacy-minimised schema-v2 application snapshot per authenticated owner.';
comment on table public.consent_acceptances is 'Versioned cloud-sync consent choices, including withdrawal.';

do $$
begin
  if not exists (select 1 from public.app_snapshots where schema_version <> 2) then
    alter table public.app_snapshots validate constraint app_snapshots_schema_version_check;
  end if;
end;
$$;
