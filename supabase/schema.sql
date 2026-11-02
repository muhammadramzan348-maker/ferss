-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- Then: Authentication -> Users -> Add user (the shop owner's email + password).
-- Both phones sign in with that same account.

create sequence if not exists public.sync_rev_seq;

create table if not exists public.sync_records (
  owner_id uuid   not null default auth.uid(),
  col      text   not null,           -- collection name, e.g. 'sales'
  rid      text   not null,           -- record id (uuid)
  device   text   not null,           -- which phone wrote it
  payload  jsonb  not null,           -- the record itself
  rev      bigint not null default nextval('public.sync_rev_seq'),
  primary key (owner_id, col, rid)
);

-- every insert/update gets a new, strictly increasing revision number (used as the pull cursor)
create or replace function public.sync_bump_rev() returns trigger language plpgsql as $$
begin new.rev := nextval('public.sync_rev_seq'); return new; end $$;

drop trigger if exists sync_records_rev on public.sync_records;
create trigger sync_records_rev before insert or update on public.sync_records
  for each row execute function public.sync_bump_rev();

create index if not exists sync_records_rev_idx on public.sync_records (owner_id, rev);

alter table public.sync_records enable row level security;

drop policy if exists "owner select" on public.sync_records;
create policy "owner select" on public.sync_records for select using (owner_id = auth.uid());
drop policy if exists "owner insert" on public.sync_records;
create policy "owner insert" on public.sync_records for insert with check (owner_id = auth.uid());
drop policy if exists "owner update" on public.sync_records;
create policy "owner update" on public.sync_records for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- No delete policy on purpose: business history is never deleted from the cloud.
-- Tip: Authentication -> Providers -> Email: turn OFF "Allow new users to sign up" after creating the owner user.
