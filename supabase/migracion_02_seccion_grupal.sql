-- Migración 02: sección, registros grupales y participantes
-- Pegar completo en Supabase → SQL Editor → Run (se puede correr más de una vez)

alter table public.ninos     add column if not exists seccion text;
alter table public.registros add column if not exists seccion text;
alter table public.registros add column if not exists grupal boolean not null default false;
alter table public.registros add column if not exists participantes text;

-- Los registros de grupo anteriores pasan a ser "grupales"
update public.registros set grupal = true where grupo is not null and nino_id is null;
