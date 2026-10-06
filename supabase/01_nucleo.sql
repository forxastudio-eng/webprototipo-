-- ============================================================================
-- CRM INMOBILIARIO · 01 · Núcleo multiempresa (planes, empresas, equipo)
-- Ejecutar en el SQL Editor de Supabase en orden: 01 → 02. Seguro de repetir.
--
-- Una "organización" es una inmobiliaria cliente. Cada una tiene su equipo,
-- su plan y su suscripción; sus datos están aislados de las demás por RLS.
--
-- Roles dentro de una organización:
--   propietario     todo, incluida la facturación (quien creó la cuenta)
--   administrador   gestiona leads, equipo y ajustes; NO factura
--   agente          trabaja sus leads y los que no tienen dueño
--   lector          solo lectura (dirección, marketing)
-- ============================================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ---------------------------------------------------------------- planes ---
create table if not exists public.planes (
  id text primary key check (id ~ '^[a-z0-9_-]{2,30}$'),
  nombre text not null,
  descripcion text,
  precio_mensual numeric not null check (precio_mensual >= 0),
  precio_anual numeric check (precio_anual is null or precio_anual >= 0),
  max_usuarios integer not null check (max_usuarios > 0),
  max_leads_mes integer not null check (max_leads_mes > 0),
  ia_mes integer not null check (ia_mes >= 0),         -- consultas a la IA por mes (toda la empresa)
  caracteristicas jsonb not null default '[]'::jsonb,   -- lista de textos para la página de precios
  destacado boolean not null default false,
  activo boolean not null default true,
  orden integer not null default 0
);
alter table public.planes enable row level security;

-- ----------------------------------------------------------- organizaciones ---
create table if not exists public.organizaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 2 and 80),
  slug text not null unique,
  clave_publica text not null unique default ('pk_' || encode(gen_random_bytes(18), 'hex')),
  reparto text not null default 'ninguno' check (reparto in ('ninguno', 'rotativo')),
  plan_id text not null default 'inicial' references public.planes(id),
  estado text not null default 'prueba' check (estado in ('prueba', 'activa', 'gracia', 'vencida', 'cancelada')),
  prueba_hasta timestamptz not null default (now() + interval '14 days'),
  periodo_hasta timestamptz,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.organizaciones enable row level security;
drop trigger if exists organizaciones_updated_at on public.organizaciones;
create trigger organizaciones_updated_at before update on public.organizaciones
  for each row execute function public.set_updated_at();

create table if not exists public.miembros (
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (email = lower(email)),
  nombre text,
  rol text not null check (rol in ('propietario', 'administrador', 'agente', 'lector')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists miembros_user_ix on public.miembros (user_id);
create index if not exists miembros_email_ix on public.miembros (org_id, email);
alter table public.miembros enable row level security;

create table if not exists public.invitaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  email text not null check (email = lower(email)),
  rol text not null check (rol in ('administrador', 'agente', 'lector')),
  invitado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);
alter table public.invitaciones enable row level security;

-- --------------------------------------------------------------- utilidades ---
create or replace function public.mi_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- security definer: consultan miembros sin pasar por su propio RLS (evita recursión).
create or replace function public.rol_en(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select rol from public.miembros where org_id = p_org and user_id = auth.uid()
$$;

create or replace function public.es_miembro(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.miembros where org_id = p_org and user_id = auth.uid())
$$;

create or replace function public.tiene_rol_org(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.rol_en(p_org) = any(p_roles), false)
$$;

-- ¿La suscripción permite trabajar? Prueba vigente, plan pagado al día o en días de gracia.
create or replace function public.org_activa(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organizaciones
    where id = p_org and (estado in ('activa', 'gracia') or (estado = 'prueba' and prueba_hasta > now()))
  )
$$;

revoke execute on function public.rol_en(uuid), public.es_miembro(uuid),
  public.tiene_rol_org(uuid, text[]), public.org_activa(uuid) from public, anon;
grant execute on function public.rol_en(uuid), public.es_miembro(uuid),
  public.tiene_rol_org(uuid, text[]), public.org_activa(uuid) to authenticated;

-- --------------------------------------------------------------- políticas ---
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('planes','organizaciones','miembros','invitaciones')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "planes: públicos" on public.planes
  for select to anon, authenticated using (activo);
create policy "organizaciones: las ve su equipo" on public.organizaciones
  for select to authenticated using (public.es_miembro(id));
create policy "miembros: los ve su equipo" on public.miembros
  for select to authenticated using (public.es_miembro(org_id));
create policy "invitaciones: las ven propietario y administrador" on public.invitaciones
  for select to authenticated using (public.tiene_rol_org(org_id, array['propietario', 'administrador']));
-- Todo lo demás (crear, invitar, cambiar rol) pasa por las funciones de abajo; el plan y el estado de la suscripción solo cambian en 04_cobros.sql.

revoke all on public.planes, public.organizaciones, public.miembros, public.invitaciones from anon;
revoke insert, update, delete on public.planes, public.organizaciones, public.miembros, public.invitaciones from authenticated;
grant select on public.planes to anon;

-- ------------------------------------------------------- crear la empresa ---
create or replace function public.crear_organizacion(p_nombre text, p_nombre_usuario text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_slug text;
  v_org uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero'; end if;
  if char_length(v_nombre) not between 2 and 80 then raise exception 'Escribe el nombre de tu empresa (2 a 80 letras)'; end if;
  if exists (select 1 from public.miembros where user_id = auth.uid() and rol = 'propietario') then
    raise exception 'Ya tienes una empresa creada';
  end if;
  v_slug := coalesce(nullif(regexp_replace(lower(translate(v_nombre,
              'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^a-z0-9]+', '-', 'g'), ''), 'empresa');
  v_slug := trim(both '-' from left(v_slug, 40)) || '-' || substr(encode(gen_random_bytes(4), 'hex'), 1, 6);

  insert into public.organizaciones (nombre, slug, creado_por)
  values (v_nombre, v_slug, auth.uid()) returning id into v_org;
  insert into public.miembros (org_id, user_id, email, nombre, rol)
  values (v_org, auth.uid(), public.mi_email(), nullif(btrim(coalesce(p_nombre_usuario, '')), ''), 'propietario');
  return v_org;
end;
$$;

-- Quien se registró por invitación entra a la empresa que lo invitó.
create or replace function public.aceptar_invitaciones(p_nombre_usuario text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is null or public.mi_email() = '' then return 0; end if;
  with inv as (
    delete from public.invitaciones where email = public.mi_email() returning org_id, rol
  ), ins as (
    insert into public.miembros (org_id, user_id, email, nombre, rol)
    select org_id, auth.uid(), public.mi_email(), nullif(btrim(coalesce(p_nombre_usuario, '')), ''), rol from inv
    on conflict (org_id, user_id) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end;
$$;

-- ---------------------------------------------------------- equipo y ajustes ---
create or replace function public.uso_org(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_miembro(p_org) then raise exception 'Sin acceso a esta empresa'; end if;
  select jsonb_build_object(
    'plan', to_jsonb(p),
    'estado', o.estado,
    'prueba_hasta', o.prueba_hasta,
    'periodo_hasta', o.periodo_hasta,
    'activa', public.org_activa(o.id),
    'usuarios', (select count(*) from public.miembros where org_id = o.id)
              + (select count(*) from public.invitaciones where org_id = o.id),
    'leads_mes', coalesce((select count(*) from public.crm_oportunidades
                           where org_id = o.id and created_at >= date_trunc('month', now())), 0),
    'ia_mes', coalesce((select count(*) from public.crm_ia_uso
                        where org_id = o.id and created_at >= date_trunc('month', now())), 0)
  ) into v
  from public.organizaciones o join public.planes p on p.id = o.plan_id
  where o.id = p_org;
  return v;
end;
$$;

create or replace function public.actualizar_organizacion(p_org uuid, p_nombre text, p_reparto text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tiene_rol_org(p_org, array['propietario', 'administrador']) then
    raise exception 'Tu rol no permite cambiar los ajustes';
  end if;
  if char_length(btrim(coalesce(p_nombre, ''))) not between 2 and 80 then raise exception 'Nombre no válido'; end if;
  if p_reparto not in ('ninguno', 'rotativo') then raise exception 'Reparto no válido'; end if;
  update public.organizaciones set nombre = btrim(p_nombre), reparto = p_reparto where id = p_org;
end;
$$;

create or replace function public.invitar(p_org uuid, p_email text, p_rol text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_max integer;
  v_usados integer;
begin
  if not public.tiene_rol_org(p_org, array['propietario', 'administrador']) then
    raise exception 'Tu rol no permite invitar personas';
  end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo no válido'; end if;
  if p_rol not in ('administrador', 'agente', 'lector') then raise exception 'Rol no válido'; end if;
  if p_rol = 'administrador' and public.rol_en(p_org) <> 'propietario' then
    raise exception 'Solo el propietario puede invitar administradores';
  end if;
  if exists (select 1 from public.miembros where org_id = p_org and email = v_email) then
    raise exception 'Esa persona ya está en tu equipo';
  end if;

  select p.max_usuarios into v_max from public.organizaciones o join public.planes p on p.id = o.plan_id where o.id = p_org;
  select (select count(*) from public.miembros where org_id = p_org)
       + (select count(*) from public.invitaciones where org_id = p_org and email <> v_email) into v_usados;
  if v_usados >= v_max then
    raise exception 'Tu plan permite hasta % usuarios. Mejora tu plan para invitar más.', v_max;
  end if;

  insert into public.invitaciones (org_id, email, rol, invitado_por)
  values (p_org, v_email, p_rol, auth.uid())
  on conflict (org_id, email) do update set rol = excluded.rol;
end;
$$;

create or replace function public.cancelar_invitacion(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.invitaciones where id = p_id;
  if v_org is null or not public.tiene_rol_org(v_org, array['propietario', 'administrador']) then
    raise exception 'No se pudo cancelar la invitación';
  end if;
  delete from public.invitaciones where id = p_id;
end;
$$;

create or replace function public.cambiar_rol(p_org uuid, p_user uuid, p_rol text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.rol_en(p_org) <> 'propietario' then raise exception 'Solo el propietario cambia roles'; end if;
  if p_user = auth.uid() then raise exception 'No puedes cambiar tu propio rol'; end if;
  if p_rol not in ('administrador', 'agente', 'lector') then raise exception 'Rol no válido'; end if;
  update public.miembros set rol = p_rol where org_id = p_org and user_id = p_user and rol <> 'propietario';
  if not found then raise exception 'No se encontró a esa persona'; end if;
end;
$$;

revoke execute on function
  public.crear_organizacion(text, text), public.aceptar_invitaciones(text), public.uso_org(uuid),
  public.actualizar_organizacion(uuid, text, text), public.invitar(uuid, text, text),
  public.cancelar_invitacion(uuid), public.cambiar_rol(uuid, uuid, text)
  from public, anon;
grant execute on function
  public.crear_organizacion(text, text), public.aceptar_invitaciones(text), public.uso_org(uuid),
  public.actualizar_organizacion(uuid, text, text), public.invitar(uuid, text, text),
  public.cancelar_invitacion(uuid), public.cambiar_rol(uuid, uuid, text)
  to authenticated;

-- ------------------------------------------------------- planes de ejemplo ---
-- Precios y límites de EJEMPLO: ajústalos a tu negocio (tabla planes). Solo se insertan si no existen.
insert into public.planes (id, nombre, descripcion, precio_mensual, precio_anual, max_usuarios, max_leads_mes, ia_mes, caracteristicas, destacado, orden) values
  ('inicial', 'Inicial', 'Para asesores independientes y equipos que empiezan.', 19, 190, 2, 150, 40,
    '["Hasta 2 usuarios","150 leads nuevos al mes","App móvil instalable","Captura de leads desde tu web","40 consultas de IA al mes"]', false, 1),
  ('profesional', 'Profesional', 'Para inmobiliarias con equipo comercial.', 49, 490, 8, 1000, 400,
    '["Hasta 8 usuarios","1.000 leads nuevos al mes","Reparto automático de leads","Métricas por fuente y asesor","400 consultas de IA al mes"]', true, 2),
  ('agencia', 'Agencia', 'Para redes y agencias con varias sucursales.', 129, 1290, 30, 5000, 2000,
    '["Hasta 30 usuarios","5.000 leads nuevos al mes","Todo lo de Profesional","2.000 consultas de IA al mes","Soporte prioritario"]', false, 3)
on conflict (id) do nothing;
