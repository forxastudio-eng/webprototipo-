-- ============================================================================
-- GPUnlock · 03 · Cotizador interno — esquema final consolidado
-- Equivale a schema.sql + todos los update_*.sql originales (ver carpeta
-- referencia-cotizador/), pero SIN datos de ejemplo y SIN políticas: los datos
-- reales llegan con scripts/migrar_datos.mjs y las políticas con 06.
-- La antigua tabla cotizador_admins ya no se usa: la reemplaza user_roles.
-- ============================================================================

create table if not exists public.cotizador_proyectos (
  id text primary key,
  nombre text not null,
  tagline text,
  ubicacion text,
  color_primario text not null default '#F2582B',
  color_acento text not null default '#F08A30',
  cover_url text,
  tipo_financiamiento text not null default 'simulacion',
  prefijo_proforma text,
  reserva_pct numeric not null default 0.02,
  promesa_pct numeric not null default 0.08,
  tasa_default numeric not null default 10.5,
  plazo_default_anios integer not null default 20,
  permite_descuento_manual boolean not null default false,
  monto_descuento_clic numeric not null default 0,
  permite_multi_seleccion boolean not null default true,
  activo boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.cotizador_unidades (
  id uuid primary key default gen_random_uuid(),
  proyecto_id text not null references public.cotizador_proyectos(id) on delete cascade,
  codigo text not null,
  nombre text,
  tipo text,
  planta text,
  terreno_m2 numeric,
  construccion_m2 numeric,
  area_util_m2 numeric,
  area_total_m2 numeric,
  dormitorios numeric,
  banos numeric,
  parqueos integer,
  bodega_codigo text,
  bodega_area_m2 numeric,
  precio numeric,
  precio_preventa numeric,
  aplica_vip boolean not null default false,
  fase text,
  estado text not null default 'disponible'
    check (estado in ('disponible','reservado','vendida','no_disponible')),
  foto_url text,
  plano_baja_url text,
  plano_alta_url text,
  nota text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proyecto_id, codigo)
);

create table if not exists public.cotizador_inventario_extra (
  id uuid primary key default gen_random_uuid(),
  proyecto_id text not null references public.cotizador_proyectos(id) on delete cascade,
  codigo text not null,
  tipo text not null,
  categoria text,
  precio numeric,
  precio_preventa numeric,
  metraje_m2 numeric,
  precio_m2 numeric,
  estado text not null default 'disponible'
    check (estado in ('disponible','reservado','vendida','no_disponible')),
  nota text,
  created_at timestamptz not null default now(),
  unique (proyecto_id, tipo, codigo)
);

create table if not exists public.cotizador_asesores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  correo text,
  telefono_codigo text not null default '593',
  telefono_numero text not null default '',
  activo boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (nombre)
);

create table if not exists public.cotizador_historial (
  id uuid primary key default gen_random_uuid(),
  numero_proforma text unique,
  creado_por uuid references auth.users(id) on delete set null,
  asesor_nombre text,
  asesor_telefono text,
  proyecto_id text references public.cotizador_proyectos(id),
  cliente_nombre text,
  cliente_telefono text,
  cliente_correo text,
  unidades jsonb not null default '[]'::jsonb,
  descuento numeric not null default 0,
  precio_final numeric,
  reserva numeric,
  promesa numeric,
  abono_total numeric,
  monto_financiado numeric,
  tasa_usada numeric,
  plazo_anios_usado integer,
  numero_cuotas integer,
  monto_cuota numeric,
  saldo_financiar numeric,
  cuota_mensual numeric,
  notas text,
  motivo_compra text,
  forma_pago text default 'financiamiento',
  created_at timestamptz not null default now()
);

create table if not exists public.cotizador_contador_proforma (
  proyecto_id text primary key references public.cotizador_proyectos(id) on delete cascade,
  ultimo integer not null default 0
);

alter table public.cotizador_proyectos         enable row level security;
alter table public.cotizador_unidades          enable row level security;
alter table public.cotizador_inventario_extra  enable row level security;
alter table public.cotizador_asesores          enable row level security;
alter table public.cotizador_historial         enable row level security;
alter table public.cotizador_contador_proforma enable row level security;

-- Número de proforma atómico (ej. LUMEN-0007). Requiere un rol válido.
create or replace function public.siguiente_numero_proforma(p_proyecto_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefijo text;
  v_siguiente integer;
begin
  if public.mi_rol() is null then
    raise exception 'Sin permiso para generar proformas';
  end if;

  select coalesce(prefijo_proforma, upper(left(id, 3))) into v_prefijo
  from public.cotizador_proyectos where id = p_proyecto_id;
  if v_prefijo is null then
    v_prefijo := upper(left(p_proyecto_id, 3));
  end if;

  insert into public.cotizador_contador_proforma (proyecto_id, ultimo)
  values (p_proyecto_id, 1)
  on conflict (proyecto_id) do update set ultimo = cotizador_contador_proforma.ultimo + 1
  returning ultimo into v_siguiente;

  return v_prefijo || '-' || lpad(v_siguiente::text, 4, '0');
end;
$$;
grant execute on function public.siguiente_numero_proforma(text) to authenticated;

drop trigger if exists cotizador_unidades_updated_at on public.cotizador_unidades;
create trigger cotizador_unidades_updated_at
  before update on public.cotizador_unidades
  for each row execute function public.set_updated_at();

-- Bucket privado del cotizador (fotos, planos, portadas; se sirven con signed URLs).
insert into storage.buckets (id, name, public)
values ('cotizador-media', 'cotizador-media', false)
on conflict (id) do nothing;
