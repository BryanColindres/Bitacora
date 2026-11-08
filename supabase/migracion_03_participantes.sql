-- Migración 03: los registros grupales se vinculan a los niños que participaron
-- Pegar completo en Supabase → SQL Editor → Run (se puede correr más de una vez)

alter table public.registros add column if not exists nino_ids uuid[] not null default '{}';
create index if not exists registros_nino_ids_idx on public.registros using gin (nino_ids);
