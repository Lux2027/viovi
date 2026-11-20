-- Viovi – Datenbank einrichten
-- Im Supabase-Dashboard: links "SQL Editor" -> "New query" -> alles hier einfügen -> "Run".

-- 1) Tabelle: pro Nutzer eine Zeile mit allen Terminen, Notizen und Erinnerungen
create table if not exists public.viovi_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) Sicherheit: Jeder darf NUR seine eigenen Daten sehen und ändern
alter table public.viovi_data enable row level security;

drop policy if exists "eigene Daten lesen"   on public.viovi_data;
drop policy if exists "eigene Daten anlegen" on public.viovi_data;
drop policy if exists "eigene Daten ändern"  on public.viovi_data;
drop policy if exists "eigene Daten löschen" on public.viovi_data;

create policy "eigene Daten lesen"   on public.viovi_data for select to authenticated using (auth.uid() = user_id);
create policy "eigene Daten anlegen" on public.viovi_data for insert to authenticated with check (auth.uid() = user_id);
create policy "eigene Daten ändern"  on public.viovi_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eigene Daten löschen" on public.viovi_data for delete to authenticated using (auth.uid() = user_id);

-- 3) "Konto löschen": löscht das eigene Konto (und dadurch automatisch alle Daten)
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
