-- Bitácora de apoyo — esquema para Supabase
-- Pegar completo en: Supabase → SQL Editor → Run

create table if not exists public.ninos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  alias text not null,            -- iniciales o apodo, NO nombre completo
  grado text,
  seccion text,
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.registros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nino_id uuid references public.ninos(id) on delete set null,
  grupo text,                     -- etiqueta del grupo (ej. "Grupal · Quinto grado B")
  grupal boolean not null default false,
  participantes text,             -- iniciales de los niños que participaron
  grado text,
  seccion text,
  fecha date not null default current_date,
  tipo_actividad text,
  actividad text not null,
  estado_emocional text,
  seguimiento boolean not null default false,
  seguimiento_nota text,
  seguimiento_hecho boolean not null default false,
  transcripcion text,
  audio_path text,
  created_at timestamptz not null default now()
);

create index if not exists registros_user_fecha_idx on public.registros (user_id, fecha desc);
create index if not exists registros_nino_idx on public.registros (nino_id);

alter table public.ninos enable row level security;
alter table public.registros enable row level security;

drop policy if exists "ninos_propios" on public.ninos;
create policy "ninos_propios" on public.ninos
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "registros_propios" on public.registros;
create policy "registros_propios" on public.registros
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Bucket privado para audios (cada usuaria solo ve su carpeta)
insert into storage.buckets (id, name, public)
values ('audios', 'audios', false)
on conflict (id) do nothing;

drop policy if exists "audios_select" on storage.objects;
create policy "audios_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'audios' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "audios_insert" on storage.objects;
create policy "audios_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audios' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "audios_delete" on storage.objects;
create policy "audios_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'audios' and (storage.foldername(name))[1] = auth.uid()::text);
