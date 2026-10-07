-- GPUnlock CRM · instalación completa (generado por supabase/generar_instalador.sh; no lo edites a mano).
-- Equivale a ejecutar, en orden, las migraciones 01 → NN. Seguro de repetir.

-- ###########################################################################
-- 01_nucleo.sql
-- ###########################################################################
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

-- (Sin extensiones: los códigos aleatorios usan gen_random_uuid(), que ya viene en Postgres.
--  gen_random_bytes() de pgcrypto no está en el search_path de las funciones en Supabase.)

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
-- Las funciones de disparador no se llaman desde la API: se quita el permiso de ejecución (los disparadores siguen funcionando).
revoke execute on function public.set_updated_at() from public, anon, authenticated;

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
  clave_publica text not null unique default ('pk_' || substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 36)),
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
returns text language sql stable set search_path = public as $$
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
  v_slug := trim(both '-' from left(v_slug, 40)) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

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

-- ###########################################################################
-- 02_crm.sql
-- ###########################################################################
-- ============================================================================
-- CRM INMOBILIARIO · 02 · CRM por empresa (contactos, oportunidades, actividades)
-- Ejecutar después de 01_nucleo.sql. Seguro de repetir.
--
-- Todo está aislado por org_id. Visibilidad dentro de una empresa:
--                        propietario  administrador  agente                  lector
--   Ver leads                todos        todos       los suyos + sin dueño   todos
--   Crear / editar           ✓            ✓           los suyos               –
--   Asignar a otra persona   ✓            ✓           solo «tomar» uno libre  –
--   Eliminar                 ✓            –           –                       –
-- Si la suscripción no está activa la empresa queda en SOLO LECTURA, pero los
-- formularios web siguen guardando leads (nunca se pierde un contacto).
-- ============================================================================

-- ------------------------------------------------------------- utilidades ---
-- Solo dígitos, con prefijo de país. 0991234567 → 593991234567 (Ecuador).
-- Para otro país, cambia el prefijo en esta función.
create or replace function public.crm_normalizar_telefono(p text)
returns text language sql immutable set search_path = public as $$
  select case
    when d = '' then ''
    when d ~ '^593' then d
    when d ~ '^0\d{9}$' then '593' || substr(d, 2)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) t
$$;

-- ----------------------------------------------------------------- tablas ---
create table if not exists public.crm_proyectos (
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9_-]{1,40}$'),
  nombre text not null check (char_length(nombre) between 1 and 80),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, slug)
);

create table if not exists public.crm_contactos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 2 and 120),
  telefono text,
  telefono_norm text not null default '',
  correo text,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_contactos_tel_uq on public.crm_contactos (org_id, telefono_norm) where telefono_norm <> '';
create index if not exists crm_contactos_correo_ix on public.crm_contactos (org_id, correo) where correo is not null;

create table if not exists public.crm_oportunidades (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  contacto_id uuid not null references public.crm_contactos(id) on delete cascade,
  proyecto text check (proyecto is null or proyecto ~ '^[a-z0-9_-]{1,40}$'),
  unidad_interes text,
  etapa text not null default 'nuevo'
    check (etapa in ('nuevo','contactado','cita','proforma','reserva','vendido','perdido')),
  fuente text not null default 'otro'
    check (fuente in ('formulario_web','whatsapp','llamada','facebook','instagram','tiktok','google',
                      'marketplace','portal','feria','cartera','co_broker','referido','oficina','otro')),
  origen text,
  asignado_a text check (asignado_a is null or asignado_a = lower(asignado_a)),
  valor_estimado numeric,
  proforma_numero text,
  motivo_perdida text,
  calificacion text check (calificacion is null or calificacion in ('caliente','tibio','frio')),
  calificacion_motivo text,
  ia_resumen text,
  ia_siguiente_accion text,
  ia_actualizado_at timestamptz,
  cerrado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_op_org_etapa_ix on public.crm_oportunidades (org_id, etapa);
create index if not exists crm_op_asignado_ix on public.crm_oportunidades (org_id, asignado_a);
create index if not exists crm_op_contacto_ix on public.crm_oportunidades (contacto_id);
create index if not exists crm_op_creado_ix on public.crm_oportunidades (org_id, created_at desc);

create table if not exists public.crm_actividades (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  oportunidad_id uuid not null references public.crm_oportunidades(id) on delete cascade,
  contacto_id uuid not null references public.crm_contactos(id) on delete cascade,
  tipo text not null
    check (tipo in ('nota','llamada','whatsapp','correo','visita','tarea','cambio_etapa','sistema','ia')),
  contenido text not null check (char_length(contenido) between 1 and 4000),
  vence_at timestamptz,
  hecha_at timestamptz,
  creado_por text,
  created_at timestamptz not null default now()
);
create index if not exists crm_act_op_ix on public.crm_actividades (oportunidad_id, created_at desc);
create index if not exists crm_act_tareas_ix on public.crm_actividades (org_id, vence_at) where tipo = 'tarea' and hecha_at is null;

create table if not exists public.crm_ia_uso (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  email text not null,
  accion text not null,
  created_at timestamptz not null default now()
);
create index if not exists crm_ia_uso_org_ix on public.crm_ia_uso (org_id, created_at desc);
create index if not exists crm_ia_uso_user_ix on public.crm_ia_uso (org_id, email, created_at desc);

alter table public.crm_proyectos     enable row level security;
alter table public.crm_contactos     enable row level security;
alter table public.crm_oportunidades enable row level security;
alter table public.crm_actividades   enable row level security;
alter table public.crm_ia_uso        enable row level security;

revoke all on public.crm_proyectos, public.crm_contactos, public.crm_oportunidades,
              public.crm_actividades, public.crm_ia_uso from anon;
revoke insert, delete on public.crm_contactos, public.crm_oportunidades, public.crm_actividades from authenticated;
revoke insert, update, delete on public.crm_ia_uso from authenticated;
-- Los permisos finos están en las políticas; estas revocaciones cierran la puerta de entrada directa.
grant insert on public.crm_actividades to authenticated;     -- notas y tareas (política: gestor del lead)
grant delete on public.crm_contactos, public.crm_oportunidades, public.crm_actividades to authenticated;  -- política: propietario

-- ------------------------------------------------------------- disparadores ---
drop trigger if exists crm_contactos_updated_at on public.crm_contactos;
create trigger crm_contactos_updated_at before update on public.crm_contactos
  for each row execute function public.set_updated_at();
drop trigger if exists crm_oportunidades_updated_at on public.crm_oportunidades;
create trigger crm_oportunidades_updated_at before update on public.crm_oportunidades
  for each row execute function public.set_updated_at();

-- Teléfono y correo siempre normalizados (también cuando se editan desde la app).
create or replace function public.crm_contacto_antes()
returns trigger language plpgsql set search_path = public as $$
begin
  new.nombre := btrim(new.nombre);
  new.telefono := nullif(btrim(coalesce(new.telefono, '')), '');
  new.telefono_norm := public.crm_normalizar_telefono(new.telefono);
  new.correo := nullif(lower(btrim(coalesce(new.correo, ''))), '');
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then raise exception 'No se puede cambiar la empresa'; end if;
  return new;
end;
$$;
drop trigger if exists crm_contacto_antes on public.crm_contactos;
create trigger crm_contacto_antes before insert or update on public.crm_contactos
  for each row execute function public.crm_contacto_antes();

create or replace function public.crm_oportunidad_antes()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.contacto_id <> old.contacto_id) then
    raise exception 'No se puede mover el lead a otra empresa o contacto';
  end if;
  if new.etapa in ('vendido','perdido') then
    if tg_op = 'INSERT' or old.etapa not in ('vendido','perdido') then new.cerrado_at := now(); end if;
  else
    new.cerrado_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_oportunidad_antes on public.crm_oportunidades;
create trigger crm_oportunidad_antes before insert or update on public.crm_oportunidades
  for each row execute function public.crm_oportunidad_antes();

-- Cada cambio de etapa o de dueño queda en la línea de tiempo.
create or replace function public.crm_oportunidad_despues()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_quien text := coalesce(nullif(public.mi_email(), ''), 'sistema');
begin
  if new.etapa is distinct from old.etapa then
    insert into public.crm_actividades (org_id, oportunidad_id, contacto_id, tipo, contenido, creado_por)
    values (new.org_id, new.id, new.contacto_id, 'cambio_etapa', old.etapa || ' → ' || new.etapa, v_quien);
  end if;
  if new.asignado_a is distinct from old.asignado_a then
    insert into public.crm_actividades (org_id, oportunidad_id, contacto_id, tipo, contenido, creado_por)
    values (new.org_id, new.id, new.contacto_id, 'sistema',
            'Asignado a ' || coalesce(new.asignado_a, 'nadie (sin asignar)'), v_quien);
  end if;
  return new;
end;
$$;
drop trigger if exists crm_oportunidad_despues on public.crm_oportunidades;
create trigger crm_oportunidad_despues after update on public.crm_oportunidades
  for each row execute function public.crm_oportunidad_despues();

-- La empresa y el contacto de una actividad siempre son los de su oportunidad
-- (no se confía en lo que mande el cliente).
create or replace function public.crm_actividad_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id, contacto_id into new.org_id, new.contacto_id
  from public.crm_oportunidades where id = new.oportunidad_id;
  if new.org_id is null then raise exception 'Lead no encontrado'; end if;
  return new;
end;
$$;
drop trigger if exists crm_actividad_antes on public.crm_actividades;
create trigger crm_actividad_antes before insert on public.crm_actividades
  for each row execute function public.crm_actividad_antes();

-- Funciones de disparador: no se llaman desde la API. Sin permiso de ejecución para nadie (los disparadores siguen funcionando).
revoke execute on function public.crm_contacto_antes(), public.crm_oportunidad_antes(),
  public.crm_oportunidad_despues(), public.crm_actividad_antes() from public, anon, authenticated;

-- ------------------------------------------------- permisos (funciones) ---
create or replace function public.crm_puede_ver_op(p_op uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_oportunidades o
    where o.id = p_op and (
      public.tiene_rol_org(o.org_id, array['propietario','administrador','lector'])
      or (public.rol_en(o.org_id) = 'agente' and (o.asignado_a = public.mi_email() or o.asignado_a is null))
    )
  )
$$;

create or replace function public.crm_puede_gestionar_op(p_op uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_oportunidades o
    where o.id = p_op and public.org_activa(o.org_id) and (
      public.tiene_rol_org(o.org_id, array['propietario','administrador'])
      or (public.rol_en(o.org_id) = 'agente' and o.asignado_a = public.mi_email())
    )
  )
$$;

create or replace function public.crm_puede_ver_contacto(p_contacto uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_contactos c
    where c.id = p_contacto and (
      public.tiene_rol_org(c.org_id, array['propietario','administrador','lector'])
      or (public.rol_en(c.org_id) = 'agente' and (
            c.creado_por = public.mi_email()
            or exists (select 1 from public.crm_oportunidades o
                       where o.contacto_id = c.id and (o.asignado_a = public.mi_email() or o.asignado_a is null))))
    )
  )
$$;

create or replace function public.crm_puede_editar_contacto(p_contacto uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_contactos c
    where c.id = p_contacto and public.org_activa(c.org_id) and (
      public.tiene_rol_org(c.org_id, array['propietario','administrador'])
      or (public.rol_en(c.org_id) = 'agente' and (
            c.creado_por = public.mi_email()
            or exists (select 1 from public.crm_oportunidades o
                       where o.contacto_id = c.id and o.asignado_a = public.mi_email())))
    )
  )
$$;

revoke execute on function public.crm_puede_ver_op(uuid), public.crm_puede_gestionar_op(uuid),
  public.crm_puede_ver_contacto(uuid), public.crm_puede_editar_contacto(uuid) from public, anon;
grant execute on function public.crm_puede_ver_op(uuid), public.crm_puede_gestionar_op(uuid),
  public.crm_puede_ver_contacto(uuid), public.crm_puede_editar_contacto(uuid) to authenticated;

-- --------------------------------------------------------------- políticas ---
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('crm_proyectos','crm_contactos','crm_oportunidades','crm_actividades','crm_ia_uso')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "proyectos: ve el equipo" on public.crm_proyectos
  for select to authenticated using (public.es_miembro(org_id));
create policy "proyectos: gestiona propietario y administrador" on public.crm_proyectos
  for all to authenticated
  using (public.tiene_rol_org(org_id, array['propietario','administrador']) and public.org_activa(org_id))
  with check (public.tiene_rol_org(org_id, array['propietario','administrador']) and public.org_activa(org_id));

create policy "contactos: ver" on public.crm_contactos
  for select to authenticated using (public.crm_puede_ver_contacto(id));
create policy "contactos: editar" on public.crm_contactos
  for update to authenticated
  using (public.crm_puede_editar_contacto(id))
  with check (public.es_miembro(org_id));
create policy "contactos: solo propietario elimina" on public.crm_contactos
  for delete to authenticated using (public.tiene_rol_org(org_id, array['propietario']));

create policy "oportunidades: ver" on public.crm_oportunidades
  for select to authenticated
  using (public.tiene_rol_org(org_id, array['propietario','administrador','lector'])
         or (public.rol_en(org_id) = 'agente' and (asignado_a = public.mi_email() or asignado_a is null)));
create policy "oportunidades: editar" on public.crm_oportunidades
  for update to authenticated
  using (public.org_activa(org_id) and (
           public.tiene_rol_org(org_id, array['propietario','administrador'])
           or (public.rol_en(org_id) = 'agente' and asignado_a = public.mi_email())))
  with check (public.org_activa(org_id) and (
           public.tiene_rol_org(org_id, array['propietario','administrador'])
           or (public.rol_en(org_id) = 'agente' and asignado_a = public.mi_email())));
create policy "oportunidades: solo propietario elimina" on public.crm_oportunidades
  for delete to authenticated using (public.tiene_rol_org(org_id, array['propietario']));

create policy "actividades: ver" on public.crm_actividades
  for select to authenticated using (public.crm_puede_ver_op(oportunidad_id));
create policy "actividades: crear" on public.crm_actividades
  for insert to authenticated
  with check (public.crm_puede_gestionar_op(oportunidad_id) and creado_por = public.mi_email());
create policy "actividades: completar tareas" on public.crm_actividades
  for update to authenticated
  using (public.crm_puede_gestionar_op(oportunidad_id))
  with check (public.crm_puede_gestionar_op(oportunidad_id));
create policy "actividades: solo propietario elimina" on public.crm_actividades
  for delete to authenticated using (public.tiene_rol_org(org_id, array['propietario']));

create policy "ia: ver" on public.crm_ia_uso
  for select to authenticated
  using (public.tiene_rol_org(org_id, array['propietario','administrador']) or email = public.mi_email());

-- ------------------------------------------------------- alta de leads ---
-- Núcleo común: busca/crea el contacto, reutiliza la oportunidad abierta del
-- mismo proyecto (para no duplicar tarjetas), reparte si la empresa lo pidió y
-- deja la consulta en la línea de tiempo. Solo lo usan las dos funciones de abajo.
create or replace function public.crm_alta_lead(
  p_org uuid, p_nombre text, p_telefono text, p_correo text, p_proyecto text, p_interes text,
  p_mensaje text, p_fuente text, p_origen text, p_asignar text, p_quien text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_norm text := public.crm_normalizar_telefono(p_telefono);
  v_correo text := nullif(lower(btrim(coalesce(p_correo, ''))), '');
  v_contacto uuid;
  v_op uuid;
  v_asig text := p_asignar;
  v_nuevo boolean := false;
  v_reparto text;
begin
  if v_norm <> '' then
    select id into v_contacto from public.crm_contactos where org_id = p_org and telefono_norm = v_norm;
  end if;
  if v_contacto is null and v_correo is not null then
    select id into v_contacto from public.crm_contactos where org_id = p_org and correo = v_correo limit 1;
  end if;

  if v_contacto is null then
    insert into public.crm_contactos (org_id, nombre, telefono, correo, creado_por)
    values (p_org, btrim(p_nombre), nullif(btrim(coalesce(p_telefono, '')), ''), v_correo, p_quien)
    returning id into v_contacto;
  else
    update public.crm_contactos
       set correo = coalesce(correo, v_correo), telefono = coalesce(telefono, nullif(btrim(coalesce(p_telefono, '')), ''))
     where id = v_contacto;
  end if;

  select id into v_op from public.crm_oportunidades
   where contacto_id = v_contacto and coalesce(proyecto, '') = coalesce(p_proyecto, '') and etapa not in ('vendido','perdido')
   order by created_at desc limit 1;

  if v_op is null then
    if v_asig is null then
      -- Un cliente que ya tiene asesor sigue con ese asesor.
      select asignado_a into v_asig from public.crm_oportunidades
       where contacto_id = v_contacto and asignado_a is not null order by created_at desc limit 1;
    end if;
    if v_asig is null then
      select reparto into v_reparto from public.organizaciones where id = p_org;
      if v_reparto = 'rotativo' then
        -- Al agente con menos leads abiertos (desempata el que lleva más tiempo sin recibir).
        select m.email into v_asig
        from public.miembros m
        where m.org_id = p_org and m.rol = 'agente'
        order by (select count(*) from public.crm_oportunidades o
                  where o.org_id = p_org and o.asignado_a = m.email and o.etapa not in ('vendido','perdido')),
                 (select coalesce(max(o.created_at), 'epoch') from public.crm_oportunidades o
                  where o.org_id = p_org and o.asignado_a = m.email),
                 m.email
        limit 1;
      end if;
    end if;
    insert into public.crm_oportunidades (org_id, contacto_id, proyecto, unidad_interes, fuente, origen, asignado_a)
    values (p_org, v_contacto, p_proyecto, nullif(btrim(coalesce(p_interes, '')), ''), p_fuente, p_origen, v_asig)
    returning id into v_op;
    v_nuevo := true;
  end if;

  if coalesce(btrim(p_mensaje), '') <> '' or not v_nuevo then
    insert into public.crm_actividades (org_id, oportunidad_id, contacto_id, tipo, contenido, creado_por)
    values (p_org, v_op, v_contacto, case when v_nuevo then 'nota' else 'sistema' end,
            case when v_nuevo then left(btrim(p_mensaje), 4000)
                 else 'Volvió a escribir' || coalesce(' desde ' || p_origen, '') ||
                      case when coalesce(btrim(p_mensaje), '') <> '' then ': ' || left(btrim(p_mensaje), 3800) else '.' end
            end, p_quien);
  end if;

  return jsonb_build_object('oportunidad_id', v_op, 'contacto_id', v_contacto, 'nuevo', v_nuevo);
end;
$$;
revoke all on function public.crm_alta_lead(uuid,text,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;

-- Puerta pública: formularios de las webs de cada inmobiliaria (clave pública).
-- Nunca rechaza un lead por plan o suscripción: es mejor capturarlo y avisar.
create or replace function public.crm_registrar_lead(
  p_clave text, p_nombre text, p_telefono text, p_correo text default null, p_proyecto text default null,
  p_interes text default null, p_mensaje text default null, p_origen text default null, p_trampa text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_proyecto text := nullif(lower(btrim(coalesce(p_proyecto, ''))), '');
  v_norm text := public.crm_normalizar_telefono(p_telefono);
begin
  if coalesce(btrim(p_trampa), '') <> '' then return true; end if;     -- robots: fingimos éxito
  select id into v_org from public.organizaciones where clave_publica = p_clave;
  if v_org is null then raise exception 'Clave no válida'; end if;
  if char_length(btrim(coalesce(p_nombre, ''))) not between 2 and 120 then raise exception 'Nombre no válido'; end if;
  if char_length(v_norm) not between 9 and 15 then raise exception 'Teléfono no válido'; end if;
  if v_proyecto is not null and v_proyecto !~ '^[a-z0-9_-]{1,40}$' then v_proyecto := null; end if;
  if p_correo is not null and btrim(p_correo) <> '' and btrim(p_correo) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then p_correo := null; end if;
  if (select count(*) from public.crm_actividades
      where org_id = v_org and creado_por = 'web' and created_at > now() - interval '1 hour') > 300 then
    raise exception 'Demasiadas solicitudes, intenta más tarde';
  end if;

  perform public.crm_alta_lead(v_org, p_nombre, p_telefono, left(p_correo, 160), v_proyecto, left(p_interes, 120),
    left(p_mensaje, 1000), 'formulario_web', left(coalesce(p_origen, v_proyecto), 40), null, 'web');
  return true;
end;
$$;
revoke all on function public.crm_registrar_lead(text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.crm_registrar_lead(text,text,text,text,text,text,text,text,text) to anon, authenticated;

-- Alta desde la app.
create or replace function public.crm_crear_lead(
  p_org uuid, p_nombre text, p_telefono text, p_correo text default null, p_proyecto text default null,
  p_interes text default null, p_nota text default null, p_fuente text default 'otro', p_asignado text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo text := public.mi_email();
  v_rol text := public.rol_en(p_org);
  v_asignar text;
  v_max integer;
  v_usados integer;
begin
  if v_rol is null or v_rol = 'lector' then raise exception 'Tu rol no permite crear leads'; end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa. Renuévala para seguir trabajando.'; end if;
  if char_length(btrim(coalesce(p_nombre, ''))) not between 2 and 120 then raise exception 'Escribe el nombre del cliente'; end if;
  if p_fuente not in ('formulario_web','whatsapp','llamada','facebook','instagram','tiktok','google',
                      'marketplace','portal','feria','cartera','co_broker','referido','oficina','otro') then
    p_fuente := 'otro';
  end if;
  select p.max_leads_mes into v_max from public.organizaciones o join public.planes p on p.id = o.plan_id where o.id = p_org;
  select count(*) into v_usados from public.crm_oportunidades where org_id = p_org and created_at >= date_trunc('month', now());
  if v_usados >= v_max then
    raise exception 'Llegaste al límite de % leads al mes de tu plan. Mejora tu plan para seguir.', v_max;
  end if;
  if v_rol = 'agente' then v_asignar := v_yo; else v_asignar := nullif(lower(btrim(coalesce(p_asignado, ''))), ''); end if;
  if v_asignar is not null and not exists (
       select 1 from public.miembros where org_id = p_org and email = v_asignar and rol <> 'lector') then
    raise exception 'Esa persona no puede recibir leads';
  end if;

  return public.crm_alta_lead(p_org, p_nombre, p_telefono, left(p_correo, 160),
    nullif(lower(btrim(coalesce(p_proyecto, ''))), ''), left(p_interes, 120), left(p_nota, 1000),
    p_fuente, 'app', v_asignar, v_yo);
end;
$$;

-- Un agente toma un lead que nadie tiene.
create or replace function public.crm_tomar_lead(p_op uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.crm_oportunidades where id = p_op;
  if v_org is null or public.rol_en(v_org) is null or public.rol_en(v_org) = 'lector' then
    raise exception 'Tu rol no permite tomar leads';
  end if;
  if not public.org_activa(v_org) then raise exception 'Tu suscripción no está activa'; end if;
  update public.crm_oportunidades set asignado_a = public.mi_email() where id = p_op and asignado_a is null;
  if not found then raise exception 'Este lead ya tiene responsable'; end if;
end;
$$;

-- Propietario y administrador reasignan.
create or replace function public.crm_asignar(p_op uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  select org_id into v_org from public.crm_oportunidades where id = p_op;
  if v_org is null or not public.tiene_rol_org(v_org, array['propietario','administrador']) then
    raise exception 'Tu rol no permite asignar leads';
  end if;
  if not public.org_activa(v_org) then raise exception 'Tu suscripción no está activa'; end if;
  if v_email is not null and not exists (
       select 1 from public.miembros where org_id = v_org and email = v_email and rol <> 'lector') then
    raise exception 'Esa persona no puede recibir leads';
  end if;
  update public.crm_oportunidades set asignado_a = v_email where id = p_op;
end;
$$;

-- Quitar a alguien del equipo: sus leads abiertos quedan sin asignar (no se pierden).
create or replace function public.quitar_miembro(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_rol_objetivo text; v_email text;
begin
  select rol, email into v_rol_objetivo, v_email from public.miembros where org_id = p_org and user_id = p_user;
  if v_rol_objetivo is null then raise exception 'No se encontró a esa persona'; end if;
  if v_rol_objetivo = 'propietario' then raise exception 'No se puede quitar al propietario'; end if;
  if not (
       p_user = auth.uid()
       or public.rol_en(p_org) = 'propietario'
       or (public.rol_en(p_org) = 'administrador' and v_rol_objetivo in ('agente','lector'))
     ) then
    raise exception 'Tu rol no permite quitar a esta persona';
  end if;
  update public.crm_oportunidades set asignado_a = null
   where org_id = p_org and asignado_a = v_email and etapa not in ('vendido','perdido');
  delete from public.miembros where org_id = p_org and user_id = p_user;
end;
$$;

-- Equipo visible para todos los miembros (nombres para mostrar y asignar).
create or replace function public.crm_equipo(p_org uuid)
returns table (user_id uuid, email text, nombre text, rol text)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.email,
         coalesce(nullif(m.nombre, ''), initcap(replace(split_part(m.email, '@', 1), '.', ' '))) as nombre,
         m.rol
  from public.miembros m
  where m.org_id = p_org and public.es_miembro(p_org)
  order by case m.rol when 'propietario' then 0 when 'administrador' then 1 when 'agente' then 2 else 3 end, 3
$$;

-- Control de uso de la IA, atómico: límite por persona/hora y por empresa/mes (según plan).
create or replace function public.crm_ia_reservar(p_org uuid, p_accion text, p_limite_hora integer default 40)
returns void language plpgsql security definer set search_path = public as $$
declare v_rol text := public.rol_en(p_org); v_max integer; v_mes integer; v_hora integer;
begin
  if v_rol is null then raise exception 'Sin acceso a esta empresa'; end if;
  if v_rol = 'lector' and p_accion <> 'consulta' then raise exception 'Tu rol solo puede hacer preguntas a la IA'; end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa'; end if;
  select p.ia_mes into v_max from public.organizaciones o join public.planes p on p.id = o.plan_id where o.id = p_org;
  select count(*) into v_mes from public.crm_ia_uso where org_id = p_org and created_at >= date_trunc('month', now());
  if v_mes >= v_max then
    raise exception 'Tu empresa agotó las % consultas de IA de este mes. Mejora tu plan o espera al mes siguiente.', v_max;
  end if;
  select count(*) into v_hora from public.crm_ia_uso
   where org_id = p_org and email = public.mi_email() and created_at > now() - interval '1 hour';
  if v_hora >= p_limite_hora then raise exception 'Llegaste al límite de consultas a la IA por hora. Intenta más tarde.'; end if;
  insert into public.crm_ia_uso (org_id, email, accion) values (p_org, public.mi_email(), p_accion);
end;
$$;

revoke execute on function
  public.crm_crear_lead(uuid,text,text,text,text,text,text,text,text), public.crm_tomar_lead(uuid),
  public.crm_asignar(uuid,text), public.quitar_miembro(uuid,uuid), public.crm_equipo(uuid),
  public.crm_ia_reservar(uuid,text,integer) from public, anon;
grant execute on function
  public.crm_crear_lead(uuid,text,text,text,text,text,text,text,text), public.crm_tomar_lead(uuid),
  public.crm_asignar(uuid,text), public.quitar_miembro(uuid,uuid), public.crm_equipo(uuid),
  public.crm_ia_reservar(uuid,text,integer) to authenticated;

-- ---------------------------------------------------------------- métricas ---
-- security invoker: cada persona obtiene los números de lo que puede ver.
create or replace function public.crm_metricas(p_org uuid, p_dias integer default 30)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_dias integer := greatest(1, least(coalesce(p_dias, 30), 365));
  v_desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
begin
  return jsonb_build_object(
    'dias', v_dias,
    'abiertas',    (select count(*) from public.crm_oportunidades where org_id = p_org and etapa not in ('vendido','perdido')),
    'sin_asignar', (select count(*) from public.crm_oportunidades where org_id = p_org and asignado_a is null and etapa not in ('vendido','perdido')),
    'nuevos',      (select count(*) from public.crm_oportunidades where org_id = p_org and created_at >= v_desde),
    'vendidos',    (select count(*) from public.crm_oportunidades where org_id = p_org and etapa = 'vendido' and cerrado_at >= v_desde),
    'perdidos',    (select count(*) from public.crm_oportunidades where org_id = p_org and etapa = 'perdido' and cerrado_at >= v_desde),
    'tareas_vencidas', (select count(*) from public.crm_actividades
                         where org_id = p_org and tipo = 'tarea' and hecha_at is null and vence_at < now()),
    'por_etapa', coalesce((
      select jsonb_object_agg(etapa, n)
      from (select etapa, count(*) as n from public.crm_oportunidades where org_id = p_org group by etapa) x), '{}'::jsonb),
    'por_fuente', coalesce((
      select jsonb_agg(jsonb_build_object('fuente', fuente, 'leads', leads, 'vendidos', vendidos) order by leads desc, vendidos desc)
      from (select fuente,
                   count(*) filter (where created_at >= v_desde) as leads,
                   count(*) filter (where etapa = 'vendido' and cerrado_at >= v_desde) as vendidos
            from public.crm_oportunidades where org_id = p_org group by fuente) f
      where leads > 0 or vendidos > 0), '[]'::jsonb),
    'por_asesor', coalesce((
      select jsonb_agg(jsonb_build_object('email', asignado_a, 'abiertas', abiertas, 'vendidos', vendidos) order by abiertas desc)
      from (select asignado_a,
                   count(*) filter (where etapa not in ('vendido','perdido')) as abiertas,
                   count(*) filter (where etapa = 'vendido' and cerrado_at >= v_desde) as vendidos
            from public.crm_oportunidades where org_id = p_org and asignado_a is not null group by asignado_a) a), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.crm_metricas(uuid, integer) from public, anon;
grant execute on function public.crm_metricas(uuid, integer) to authenticated;

-- ---------------------------------------------------------- tiempo real ---
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['crm_oportunidades','crm_actividades'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ###########################################################################
-- 03_atribucion.sql
-- ###########################################################################
-- ============================================================================
-- GPUnlock CRM · 03 · Origen de cada lead (UTM, anuncio, clic de Meta y Google)
-- Ejecutar después de 02_crm.sql. Seguro de repetir.
--
-- Cada lead guarda de dónde vino: campaña y anuncio de Meta, UTM de la web,
-- identificadores de clic (fbclid, gclid, ttclid) y las cookies de Meta (fbp,
-- fbc) que después permiten enviar las ventas de vuelta a Meta (Conversions API).
-- Si el formulario trae una marca clara de Meta, Google o TikTok, la fuente del
-- lead se corrige sola (antes quedaba como «formulario_web»).
-- ============================================================================

alter table public.crm_oportunidades
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists campaign_id text,
  add column if not exists adset_id text,
  add column if not exists ad_id text,
  add column if not exists form_id text,
  add column if not exists leadgen_id text,
  add column if not exists ctwa_clid text,
  add column if not exists fbclid text,
  add column if not exists gclid text,
  add column if not exists ttclid text,
  add column if not exists fbp text,
  add column if not exists fbc text,
  add column if not exists pagina_origen text;

create index if not exists crm_op_campana_ix on public.crm_oportunidades (org_id, utm_campaign)
  where utm_campaign is not null;
create index if not exists crm_op_leadgen_ix on public.crm_oportunidades (org_id, leadgen_id)
  where leadgen_id is not null;   -- no único a propósito: un valor repetido nunca debe hacer perder un lead

-- Deja solo las claves conocidas, recortadas y sin vacíos (lo que llega es del navegador: no se confía).
create or replace function public.crm_atribucion_limpia(p jsonb)
returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  from (
    select e.key as k, left(btrim(e.value), case when e.key = 'pagina_origen' then 300 else 150 end) as v
    from jsonb_each_text(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) e
    where e.key in ('utm_source','utm_medium','utm_campaign','utm_content','utm_term','campaign_id','adset_id',
                    'ad_id','form_id','leadgen_id','ctwa_clid','fbclid','gclid','ttclid','fbp','fbc','pagina_origen')
      and btrim(e.value) <> ''
  ) x
$$;

-- ¿Qué canal dicen las marcas del clic? (null si no hay ninguna)
create or replace function public.crm_fuente_desde_atribucion(p jsonb)
returns text
language sql immutable set search_path = public as $$
  select case
    when lower(coalesce(p ->> 'utm_source', '')) ~ '(^|[^a-z])(ig|instagram)([^a-z]|$)' then 'instagram'
    when lower(coalesce(p ->> 'utm_source', '')) ~ '(^|[^a-z])(fb|facebook|meta)([^a-z]|$)'
         or coalesce(p ->> 'fbclid', '') <> '' or coalesce(p ->> 'leadgen_id', '') <> '' then 'facebook'
    when lower(coalesce(p ->> 'utm_source', '')) ~ 'tiktok' or coalesce(p ->> 'ttclid', '') <> '' then 'tiktok'
    when lower(coalesce(p ->> 'utm_source', '')) ~ 'google' or coalesce(p ->> 'gclid', '') <> '' then 'google'
    else null
  end
$$;

-- ------------------------------------------------------------- alta de leads ---
-- Mismo núcleo de 02_crm.sql con un parámetro más (p_atribucion). La atribución se
-- guarda solo al CREAR la oportunidad: el primer origen no se pisa si el cliente vuelve.
drop function if exists public.crm_alta_lead(uuid,text,text,text,text,text,text,text,text,text,text);
create or replace function public.crm_alta_lead(
  p_org uuid, p_nombre text, p_telefono text, p_correo text, p_proyecto text, p_interes text,
  p_mensaje text, p_fuente text, p_origen text, p_asignar text, p_quien text,
  p_atribucion jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_norm text := public.crm_normalizar_telefono(p_telefono);
  v_correo text := nullif(lower(btrim(coalesce(p_correo, ''))), '');
  v_contacto uuid;
  v_op uuid;
  v_asig text := p_asignar;
  v_nuevo boolean := false;
  v_reparto text;
  v_at jsonb := public.crm_atribucion_limpia(p_atribucion);
begin
  if v_norm <> '' then
    select id into v_contacto from public.crm_contactos where org_id = p_org and telefono_norm = v_norm;
  end if;
  if v_contacto is null and v_correo is not null then
    select id into v_contacto from public.crm_contactos where org_id = p_org and correo = v_correo limit 1;
  end if;

  if v_contacto is null then
    insert into public.crm_contactos (org_id, nombre, telefono, correo, creado_por)
    values (p_org, btrim(p_nombre), nullif(btrim(coalesce(p_telefono, '')), ''), v_correo, p_quien)
    returning id into v_contacto;
  else
    update public.crm_contactos
       set correo = coalesce(correo, v_correo), telefono = coalesce(telefono, nullif(btrim(coalesce(p_telefono, '')), ''))
     where id = v_contacto;
  end if;

  -- Meta reintenta sus avisos: el mismo lead de formulario (leadgen_id) no se crea dos veces.
  if v_at ? 'leadgen_id' then
    select id into v_op from public.crm_oportunidades where org_id = p_org and leadgen_id = v_at ->> 'leadgen_id' limit 1;
  end if;
  if v_op is null then
    select id into v_op from public.crm_oportunidades
     where contacto_id = v_contacto and coalesce(proyecto, '') = coalesce(p_proyecto, '') and etapa not in ('vendido','perdido')
     order by created_at desc limit 1;
  end if;

  if v_op is null then
    if v_asig is null then
      -- Un cliente que ya tiene asesor sigue con ese asesor.
      select asignado_a into v_asig from public.crm_oportunidades
       where contacto_id = v_contacto and asignado_a is not null order by created_at desc limit 1;
    end if;
    if v_asig is null then
      select reparto into v_reparto from public.organizaciones where id = p_org;
      if v_reparto = 'rotativo' then
        -- Al agente con menos leads abiertos (desempata el que lleva más tiempo sin recibir).
        select m.email into v_asig
        from public.miembros m
        where m.org_id = p_org and m.rol = 'agente'
        order by (select count(*) from public.crm_oportunidades o
                  where o.org_id = p_org and o.asignado_a = m.email and o.etapa not in ('vendido','perdido')),
                 (select coalesce(max(o.created_at), 'epoch') from public.crm_oportunidades o
                  where o.org_id = p_org and o.asignado_a = m.email),
                 m.email
        limit 1;
      end if;
    end if;
    insert into public.crm_oportunidades (org_id, contacto_id, proyecto, unidad_interes, fuente, origen, asignado_a,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, campaign_id, adset_id, ad_id, form_id,
      leadgen_id, ctwa_clid, fbclid, gclid, ttclid, fbp, fbc, pagina_origen)
    values (p_org, v_contacto, p_proyecto, nullif(btrim(coalesce(p_interes, '')), ''), p_fuente, p_origen, v_asig,
      v_at ->> 'utm_source', v_at ->> 'utm_medium', v_at ->> 'utm_campaign', v_at ->> 'utm_content', v_at ->> 'utm_term',
      v_at ->> 'campaign_id', v_at ->> 'adset_id', v_at ->> 'ad_id', v_at ->> 'form_id', v_at ->> 'leadgen_id',
      v_at ->> 'ctwa_clid', v_at ->> 'fbclid', v_at ->> 'gclid', v_at ->> 'ttclid', v_at ->> 'fbp', v_at ->> 'fbc',
      v_at ->> 'pagina_origen')
    returning id into v_op;
    v_nuevo := true;
  end if;

  if coalesce(btrim(p_mensaje), '') <> '' or not v_nuevo then
    insert into public.crm_actividades (org_id, oportunidad_id, contacto_id, tipo, contenido, creado_por)
    values (p_org, v_op, v_contacto, case when v_nuevo then 'nota' else 'sistema' end,
            case when v_nuevo then left(btrim(p_mensaje), 4000)
                 else 'Volvió a escribir' || coalesce(' desde ' || p_origen, '') ||
                      case when coalesce(btrim(p_mensaje), '') <> '' then ': ' || left(btrim(p_mensaje), 3800) else '.' end
            end, p_quien);
  end if;

  return jsonb_build_object('oportunidad_id', v_op, 'contacto_id', v_contacto, 'nuevo', v_nuevo);
end;
$$;
revoke all on function public.crm_alta_lead(uuid,text,text,text,text,text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;

-- Puerta pública: formularios de las webs de cada inmobiliaria (clave pública).
-- Nunca rechaza un lead por plan o suscripción: es mejor capturarlo y avisar.
drop function if exists public.crm_registrar_lead(text,text,text,text,text,text,text,text,text);
create or replace function public.crm_registrar_lead(
  p_clave text, p_nombre text, p_telefono text, p_correo text default null, p_proyecto text default null,
  p_interes text default null, p_mensaje text default null, p_origen text default null, p_trampa text default null,
  p_atribucion jsonb default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_proyecto text := nullif(lower(btrim(coalesce(p_proyecto, ''))), '');
  v_norm text := public.crm_normalizar_telefono(p_telefono);
  v_at jsonb := public.crm_atribucion_limpia(p_atribucion);
begin
  if coalesce(btrim(p_trampa), '') <> '' then return true; end if;     -- robots: fingimos éxito
  select id into v_org from public.organizaciones where clave_publica = p_clave;
  if v_org is null then raise exception 'Clave no válida'; end if;
  if char_length(btrim(coalesce(p_nombre, ''))) not between 2 and 120 then raise exception 'Nombre no válido'; end if;
  if char_length(v_norm) not between 9 and 15 then raise exception 'Teléfono no válido'; end if;
  if v_proyecto is not null and v_proyecto !~ '^[a-z0-9_-]{1,40}$' then v_proyecto := null; end if;
  if p_correo is not null and btrim(p_correo) <> '' and btrim(p_correo) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then p_correo := null; end if;
  if (select count(*) from public.crm_actividades
      where org_id = v_org and creado_por = 'web' and created_at > now() - interval '1 hour') > 300 then
    raise exception 'Demasiadas solicitudes, intenta más tarde';
  end if;

  perform public.crm_alta_lead(v_org, p_nombre, p_telefono, left(p_correo, 160), v_proyecto, left(p_interes, 120),
    left(p_mensaje, 1000), coalesce(public.crm_fuente_desde_atribucion(v_at), 'formulario_web'),
    left(coalesce(p_origen, v_proyecto), 40), null, 'web', v_at);
  return true;
end;
$$;
revoke all on function public.crm_registrar_lead(text,text,text,text,text,text,text,text,text,jsonb) from public;
grant execute on function public.crm_registrar_lead(text,text,text,text,text,text,text,text,text,jsonb) to anon, authenticated;

-- El origen del lead es un dato para medir campañas: desde la app (asesores, propietario) no se edita.
-- Sí lo escriben las funciones de alta y los servicios del servidor (service_role).
create or replace function public.crm_atribucion_inmutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       old.utm_source is distinct from new.utm_source or old.utm_medium is distinct from new.utm_medium
    or old.utm_campaign is distinct from new.utm_campaign or old.utm_content is distinct from new.utm_content
    or old.utm_term is distinct from new.utm_term or old.campaign_id is distinct from new.campaign_id
    or old.adset_id is distinct from new.adset_id or old.ad_id is distinct from new.ad_id
    or old.form_id is distinct from new.form_id or old.leadgen_id is distinct from new.leadgen_id
    or old.ctwa_clid is distinct from new.ctwa_clid or old.fbclid is distinct from new.fbclid
    or old.gclid is distinct from new.gclid or old.ttclid is distinct from new.ttclid
    or old.fbp is distinct from new.fbp or old.fbc is distinct from new.fbc
    or old.pagina_origen is distinct from new.pagina_origen) then
    raise exception 'El origen del lead no se puede editar';
  end if;
  return new;
end;
$$;
revoke execute on function public.crm_atribucion_inmutable() from public, anon, authenticated;
drop trigger if exists crm_atribucion_inmutable on public.crm_oportunidades;
create trigger crm_atribucion_inmutable before update on public.crm_oportunidades
  for each row execute function public.crm_atribucion_inmutable();

-- ---------------------------------------------------------------- métricas ---
-- Igual que en 02_crm.sql, con las campañas (utm_campaign o campaña de Meta).
create or replace function public.crm_metricas(p_org uuid, p_dias integer default 30)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_dias integer := greatest(1, least(coalesce(p_dias, 30), 365));
  v_desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
begin
  return jsonb_build_object(
    'dias', v_dias,
    'abiertas',    (select count(*) from public.crm_oportunidades where org_id = p_org and etapa not in ('vendido','perdido')),
    'sin_asignar', (select count(*) from public.crm_oportunidades where org_id = p_org and asignado_a is null and etapa not in ('vendido','perdido')),
    'nuevos',      (select count(*) from public.crm_oportunidades where org_id = p_org and created_at >= v_desde),
    'vendidos',    (select count(*) from public.crm_oportunidades where org_id = p_org and etapa = 'vendido' and cerrado_at >= v_desde),
    'perdidos',    (select count(*) from public.crm_oportunidades where org_id = p_org and etapa = 'perdido' and cerrado_at >= v_desde),
    'tareas_vencidas', (select count(*) from public.crm_actividades
                         where org_id = p_org and tipo = 'tarea' and hecha_at is null and vence_at < now()),
    'por_etapa', coalesce((
      select jsonb_object_agg(etapa, n)
      from (select etapa, count(*) as n from public.crm_oportunidades where org_id = p_org group by etapa) x), '{}'::jsonb),
    'por_fuente', coalesce((
      select jsonb_agg(jsonb_build_object('fuente', fuente, 'leads', leads, 'vendidos', vendidos) order by leads desc, vendidos desc)
      from (select fuente,
                   count(*) filter (where created_at >= v_desde) as leads,
                   count(*) filter (where etapa = 'vendido' and cerrado_at >= v_desde) as vendidos
            from public.crm_oportunidades where org_id = p_org group by fuente) f
      where leads > 0 or vendidos > 0), '[]'::jsonb),
    'por_campana', coalesce((
      select jsonb_agg(jsonb_build_object('campana', campana, 'fuente', fuente, 'leads', leads, 'vendidos', vendidos)
                       order by leads desc, vendidos desc)
      from (select coalesce(utm_campaign, campaign_id) as campana, min(fuente) as fuente,
                   count(*) filter (where created_at >= v_desde) as leads,
                   count(*) filter (where etapa = 'vendido' and cerrado_at >= v_desde) as vendidos
            from public.crm_oportunidades
            where org_id = p_org and coalesce(utm_campaign, campaign_id) is not null
            group by 1
            order by count(*) filter (where created_at >= v_desde) desc
            limit 20) c
      where leads > 0 or vendidos > 0), '[]'::jsonb),
    'por_asesor', coalesce((
      select jsonb_agg(jsonb_build_object('email', asignado_a, 'abiertas', abiertas, 'vendidos', vendidos) order by abiertas desc)
      from (select asignado_a,
                   count(*) filter (where etapa not in ('vendido','perdido')) as abiertas,
                   count(*) filter (where etapa = 'vendido' and cerrado_at >= v_desde) as vendidos
            from public.crm_oportunidades where org_id = p_org and asignado_a is not null group by asignado_a) a), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.crm_metricas(uuid, integer) from public, anon;
grant execute on function public.crm_metricas(uuid, integer) to authenticated;

-- ###########################################################################
-- 04_cobros.sql
-- ###########################################################################
-- ============================================================================
-- GPUnlock CRM · 04 · Cobro de suscripciones por transferencia bancaria
-- Ejecutar después de 03_atribucion.sql. Seguro de repetir.
--
-- Sin pasarela de pagos. Flujo:
--   1. El propietario elige plan y periodo → solicitar_pago() le da el monto
--      (con impuesto) y un código de referencia para la transferencia.
--   2. Transfiere, sube el comprobante → subir_comprobante() (queda «en revisión»;
--      mientras tanto sigue trabajando).
--   3. Un superadmin de GPUnlock ve el dinero en el banco y llama aprobar_pago():
--      es la ÚNICA forma de cambiar el plan, el estado y el periodo de una empresa.
--   4. cobros_actualizar_estados() (diario) pasa activa → gracia → vencida y deja
--      listos los avisos de vencimiento. Vencida = solo lectura: no se borra nada
--      y los leads de formularios siguen entrando.
--
-- Primer superadmin (una sola vez, después de crear su cuenta en Authentication):
--   insert into public.superadmins (user_id, email)
--   select id, lower(email) from auth.users where lower(email) = 'tu-correo@dominio.com';
-- ============================================================================

-- ------------------------------------------------------------- superadmins ---
create table if not exists public.superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.superadmins enable row level security;   -- sin políticas: solo funciones security definer

create or replace function public.es_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.superadmins where user_id = auth.uid())
$$;
revoke execute on function public.es_superadmin() from public, anon;
grant execute on function public.es_superadmin() to authenticated;

-- ------------------------------------------------------- datos para cobrar ---
-- Una sola fila. Los valores de abajo son de EJEMPLO: complétalos en la consola.
create table if not exists public.datos_cobro (
  id boolean primary key default true check (id),
  banco text not null default '',
  tipo_cuenta text not null default 'Corriente',
  numero_cuenta text not null default '',
  titular text not null default '',
  identificacion text not null default '',          -- RUC o cédula del titular
  correo_cobros text not null default '',
  whatsapp_cobros text not null default '',
  iva_porcentaje numeric not null default 15 check (iva_porcentaje between 0 and 30),   -- verifícalo con tu contador
  dias_gracia integer not null default 5 check (dias_gracia between 0 and 30),
  instrucciones text not null default 'Escribe tu código de referencia en la descripción de la transferencia y sube el comprobante.',
  updated_at timestamptz not null default now()
);
insert into public.datos_cobro (id, banco, numero_cuenta, titular, identificacion)
values (true, 'Completa tu banco en la consola', '', 'GPUnlock', '')
on conflict (id) do nothing;
alter table public.datos_cobro enable row level security;

-- ------------------------------------------------------ solicitudes y pagos ---
create table if not exists public.solicitudes_pago (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  plan_id text not null references public.planes(id),
  periodo text not null check (periodo in ('mensual', 'anual')),
  referencia text not null unique,
  subtotal numeric not null check (subtotal >= 0),
  iva numeric not null default 0 check (iva >= 0),
  total numeric not null check (total >= 0),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_revision', 'aprobada', 'rechazada', 'cancelada')),
  comprobante_path text,
  comprobante_subido_at timestamptz,
  motivo_rechazo text,
  creado_por uuid references auth.users(id) on delete set null,
  revisado_por uuid references auth.users(id) on delete set null,
  revisado_at timestamptz,
  created_at timestamptz not null default now()
);
-- Una sola solicitud abierta por empresa.
create unique index if not exists solicitudes_una_abierta_ix on public.solicitudes_pago (org_id)
  where estado in ('pendiente', 'en_revision');
create index if not exists solicitudes_estado_ix on public.solicitudes_pago (estado, created_at);
alter table public.solicitudes_pago enable row level security;

create table if not exists public.pagos_suscripcion (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  solicitud_id uuid references public.solicitudes_pago(id) on delete set null,
  plan_id text not null references public.planes(id),
  periodo text not null check (periodo in ('mensual', 'anual')),
  subtotal numeric not null check (subtotal >= 0),
  iva numeric not null default 0 check (iva >= 0),
  total numeric not null check (total >= 0),
  fecha_transferencia date not null,
  banco text,
  numero_comprobante text,
  factura_numero text,
  cubre_desde timestamptz not null,
  cubre_hasta timestamptz not null,
  registrado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists pagos_org_ix on public.pagos_suscripcion (org_id, created_at desc);
alter table public.pagos_suscripcion enable row level security;

-- Avisos de vencimiento listos para enviar por correo (el envío lo hace una Edge Function).
create table if not exists public.cobros_avisos (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  tipo text not null check (tipo in ('prueba_d3', 'prueba_d0', 'd7', 'd3', 'd0', 'gracia', 'vencida')),
  referencia_fecha timestamptz not null,
  enviado_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, tipo, referencia_fecha)
);
alter table public.cobros_avisos enable row level security;   -- solo service_role y funciones

-- Quién hizo qué desde la consola.
create table if not exists public.consola_auditoria (
  id bigint generated always as identity primary key,
  user_id uuid,
  email text,
  accion text not null,
  org_id uuid,
  detalle jsonb,
  created_at timestamptz not null default now()
);
alter table public.consola_auditoria enable row level security;

-- --------------------------------------------------------------- políticas ---
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('datos_cobro','solicitudes_pago','pagos_suscripcion','consola_auditoria')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "datos_cobro: los ve quien inicia sesión" on public.datos_cobro
  for select to authenticated using (true);
create policy "solicitudes: propietario y superadmin" on public.solicitudes_pago
  for select to authenticated using (public.tiene_rol_org(org_id, array['propietario']) or public.es_superadmin());
create policy "pagos: propietario y superadmin" on public.pagos_suscripcion
  for select to authenticated using (public.tiene_rol_org(org_id, array['propietario']) or public.es_superadmin());
create policy "auditoria: superadmin" on public.consola_auditoria
  for select to authenticated using (public.es_superadmin());

revoke all on public.datos_cobro, public.solicitudes_pago, public.pagos_suscripcion,
  public.cobros_avisos, public.consola_auditoria, public.superadmins from anon;
revoke insert, update, delete on public.datos_cobro, public.solicitudes_pago, public.pagos_suscripcion,
  public.cobros_avisos, public.consola_auditoria, public.superadmins from authenticated;
revoke select on public.cobros_avisos, public.superadmins from authenticated;

-- Las empresas ya no se actualizan a mano: el plan y el estado solo cambian aquí.
-- (organizaciones ya no acepta escrituras directas; ver 01_nucleo.sql.)

-- ------------------------------------------------------ comprobantes (Storage) ---
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

-- Los archivos van en  <org_id>/<archivo>. Sube el propietario de esa empresa; lo leen él y los superadmins.
create or replace function public.puede_comprobante(p_nombre text, p_escribir boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  if split_part(coalesce(p_nombre, ''), '/', 1) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  v_org := split_part(p_nombre, '/', 1)::uuid;
  if public.tiene_rol_org(v_org, array['propietario']) then return true; end if;
  return not p_escribir and public.es_superadmin();
end;
$$;
revoke execute on function public.puede_comprobante(text, boolean) from public, anon;
grant execute on function public.puede_comprobante(text, boolean) to authenticated;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'comprobantes:%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;
create policy "comprobantes: sube el propietario" on storage.objects
  for insert to authenticated with check (bucket_id = 'comprobantes' and public.puede_comprobante(name, true));
create policy "comprobantes: lee el propietario y el superadmin" on storage.objects
  for select to authenticated using (bucket_id = 'comprobantes' and public.puede_comprobante(name, false));
-- (los nombres de las políticas empiezan con «comprobantes:» solo por orden; ver el DO de arriba)

-- ---------------------------------------------------------------- auditoría ---
create or replace function public.consola_registrar(p_accion text, p_org uuid, p_detalle jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.consola_auditoria (user_id, email, accion, org_id, detalle)
  values (auth.uid(), public.mi_email(), p_accion, p_org, p_detalle)
$$;
revoke execute on function public.consola_registrar(text, uuid, jsonb) from public, anon, authenticated;

-- ------------------------------------------------- aplicar un pago (interno) ---
-- Activa la suscripción y la extiende SIN quitar ni regalar días:
--   · si ya estaba pagada (o en gracia) continúa desde su vencimiento,
--   · si estaba en prueba vigente empieza cuando termina la prueba,
--   · si estaba vencida, cancelada o sin pagar empieza hoy.
create or replace function public.cobros_aplicar_pago(
  p_org uuid, p_plan text, p_periodo text, p_subtotal numeric, p_iva numeric, p_total numeric,
  p_fecha date, p_banco text, p_comprobante text, p_factura text, p_solicitud uuid
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  o public.organizaciones%rowtype;
  v_desde timestamptz;
  v_hasta timestamptz;
begin
  select * into o from public.organizaciones where id = p_org for update;
  if not found then raise exception 'La empresa no existe'; end if;

  if o.estado in ('activa', 'gracia') and o.periodo_hasta is not null then
    v_desde := o.periodo_hasta;
  elsif o.estado = 'prueba' and o.prueba_hasta > now() then
    v_desde := o.prueba_hasta;
  else
    v_desde := now();
  end if;
  v_hasta := v_desde + case p_periodo when 'anual' then interval '1 year' else interval '1 month' end;

  update public.organizaciones
     set plan_id = p_plan, estado = 'activa', periodo_hasta = v_hasta
   where id = p_org;

  insert into public.pagos_suscripcion (org_id, solicitud_id, plan_id, periodo, subtotal, iva, total, fecha_transferencia,
    banco, numero_comprobante, factura_numero, cubre_desde, cubre_hasta, registrado_por)
  values (p_org, p_solicitud, p_plan, p_periodo, p_subtotal, p_iva, p_total, p_fecha,
    nullif(btrim(coalesce(p_banco, '')), ''), nullif(btrim(coalesce(p_comprobante, '')), ''),
    nullif(btrim(coalesce(p_factura, '')), ''), v_desde, v_hasta, auth.uid());
  return v_hasta;
end;
$$;
revoke execute on function public.cobros_aplicar_pago(uuid, text, text, numeric, numeric, numeric, date, text, text, text, uuid)
  from public, anon, authenticated;

-- ------------------------------------------------------ lado de la inmobiliaria ---
create or replace function public.solicitar_pago(p_org uuid, p_plan text, p_periodo text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_plan public.planes%rowtype;
  v_cfg public.datos_cobro%rowtype;
  v_subtotal numeric;
  v_iva numeric;
  v_ref text;
  v_id uuid;
  v_equipo integer;
  v_intentos integer := 0;
begin
  if public.rol_en(p_org) is distinct from 'propietario' then raise exception 'Solo el propietario puede contratar o cambiar el plan'; end if;
  if p_periodo not in ('mensual', 'anual') then raise exception 'Periodo no válido'; end if;
  select * into v_plan from public.planes where id = p_plan and activo;
  if not found then raise exception 'Ese plan no está disponible'; end if;
  v_subtotal := case p_periodo when 'anual' then v_plan.precio_anual else v_plan.precio_mensual end;
  if v_subtotal is null then raise exception 'Este plan no tiene precio anual'; end if;

  select (select count(*) from public.miembros where org_id = p_org)
       + (select count(*) from public.invitaciones where org_id = p_org) into v_equipo;
  if v_equipo > v_plan.max_usuarios then
    raise exception 'Tu equipo tiene % personas y el plan % permite hasta %. Quita usuarios o elige un plan mayor.',
      v_equipo, v_plan.nombre, v_plan.max_usuarios;
  end if;

  if exists (select 1 from public.solicitudes_pago where org_id = p_org and estado = 'en_revision') then
    raise exception 'Ya tienes un pago en revisión. Espera a que lo confirmemos para pedir otro.';
  end if;
  update public.solicitudes_pago set estado = 'cancelada' where org_id = p_org and estado = 'pendiente';

  select * into v_cfg from public.datos_cobro where id;
  v_iva := round(v_subtotal * v_cfg.iva_porcentaje / 100, 2);

  loop
    v_ref := 'GPU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.solicitudes_pago where referencia = v_ref);
    v_intentos := v_intentos + 1;
    if v_intentos > 20 then raise exception 'No se pudo generar la referencia, intenta otra vez'; end if;
  end loop;

  insert into public.solicitudes_pago (org_id, plan_id, periodo, referencia, subtotal, iva, total, creado_por)
  values (p_org, p_plan, p_periodo, v_ref, v_subtotal, v_iva, v_subtotal + v_iva, auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'referencia', v_ref, 'subtotal', v_subtotal, 'iva', v_iva,
                            'total', v_subtotal + v_iva, 'plan_id', p_plan, 'periodo', p_periodo);
end;
$$;

create or replace function public.subir_comprobante(p_solicitud uuid, p_path text)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.solicitudes_pago%rowtype;
begin
  select * into s from public.solicitudes_pago where id = p_solicitud;
  if not found or public.rol_en(s.org_id) is distinct from 'propietario' then raise exception 'No se encontró la solicitud'; end if;
  if s.estado not in ('pendiente', 'en_revision') then raise exception 'Esta solicitud ya no admite comprobante'; end if;
  if left(coalesce(p_path, ''), 37) <> s.org_id::text || '/' then raise exception 'Archivo no válido'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'comprobantes' and name = p_path) then
    raise exception 'No encontramos el archivo subido. Inténtalo de nuevo.';
  end if;
  update public.solicitudes_pago
     set comprobante_path = p_path, comprobante_subido_at = now(), estado = 'en_revision', motivo_rechazo = null
   where id = p_solicitud;
end;
$$;

create or replace function public.cancelar_solicitud(p_solicitud uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.solicitudes_pago%rowtype;
begin
  select * into s from public.solicitudes_pago where id = p_solicitud;
  if not found or public.rol_en(s.org_id) is distinct from 'propietario' then raise exception 'No se encontró la solicitud'; end if;
  if s.estado <> 'pendiente' then raise exception 'Solo se puede cancelar una solicitud sin comprobante'; end if;
  update public.solicitudes_pago set estado = 'cancelada' where id = p_solicitud;
end;
$$;

-- Estado de suscripción que ve la app (reemplaza al de 01_nucleo.sql).
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
    'gracia_hasta', case when o.estado = 'gracia'
                      then o.periodo_hasta + make_interval(days => (select dias_gracia from public.datos_cobro where id)) end,
    'activa', public.org_activa(o.id),
    'usuarios', (select count(*) from public.miembros where org_id = o.id)
              + (select count(*) from public.invitaciones where org_id = o.id),
    'leads_mes', coalesce((select count(*) from public.crm_oportunidades
                           where org_id = o.id and created_at >= date_trunc('month', now())), 0),
    'ia_mes', coalesce((select count(*) from public.crm_ia_uso
                        where org_id = o.id and created_at >= date_trunc('month', now())), 0),
    'solicitud', (select to_jsonb(s) - 'comprobante_path' - 'creado_por' - 'revisado_por'
                    from public.solicitudes_pago s
                   where s.org_id = o.id and s.estado <> 'cancelada'
                   order by s.created_at desc limit 1)
  ) into v
  from public.organizaciones o join public.planes p on p.id = o.plan_id
  where o.id = p_org;
  return v;
end;
$$;

-- ------------------------------------------------- lado de GPUnlock (consola) ---
create or replace function public.aprobar_pago(
  p_solicitud uuid, p_fecha date, p_banco text default null, p_comprobante text default null, p_factura text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.solicitudes_pago%rowtype;
  v_hasta timestamptz;
begin
  if not public.es_superadmin() then raise exception 'Solo el equipo de GPUnlock puede aprobar pagos'; end if;
  select * into s from public.solicitudes_pago where id = p_solicitud for update;
  if not found then raise exception 'No se encontró la solicitud'; end if;
  if s.estado not in ('pendiente', 'en_revision') then raise exception 'Esta solicitud ya fue %', s.estado; end if;
  if p_fecha is null or p_fecha > current_date + 1 then raise exception 'Fecha de la transferencia no válida'; end if;

  v_hasta := public.cobros_aplicar_pago(s.org_id, s.plan_id, s.periodo, s.subtotal, s.iva, s.total,
                                        p_fecha, p_banco, p_comprobante, p_factura, s.id);
  update public.solicitudes_pago
     set estado = 'aprobada', revisado_por = auth.uid(), revisado_at = now(), motivo_rechazo = null
   where id = s.id;
  perform public.consola_registrar('pago_aprobado', s.org_id,
    jsonb_build_object('solicitud', s.id, 'referencia', s.referencia, 'total', s.total, 'plan', s.plan_id,
                       'periodo', s.periodo, 'hasta', v_hasta, 'factura', p_factura));
  return jsonb_build_object('periodo_hasta', v_hasta);
end;
$$;

create or replace function public.rechazar_pago(p_solicitud uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.solicitudes_pago%rowtype;
begin
  if not public.es_superadmin() then raise exception 'Solo el equipo de GPUnlock puede rechazar pagos'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribe el motivo: le llegará a la empresa'; end if;
  select * into s from public.solicitudes_pago where id = p_solicitud for update;
  if not found or s.estado not in ('pendiente', 'en_revision') then raise exception 'No se puede rechazar esta solicitud'; end if;
  update public.solicitudes_pago
     set estado = 'rechazada', motivo_rechazo = btrim(p_motivo), revisado_por = auth.uid(), revisado_at = now()
   where id = s.id;
  perform public.consola_registrar('pago_rechazado', s.org_id,
    jsonb_build_object('solicitud', s.id, 'referencia', s.referencia, 'motivo', btrim(p_motivo)));
end;
$$;

-- Pago recibido sin solicitud previa (el monto va con impuesto incluido).
create or replace function public.registrar_pago_manual(
  p_org uuid, p_plan text, p_periodo text, p_total numeric, p_fecha date,
  p_banco text default null, p_comprobante text default null, p_factura text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_iva_pct numeric;
  v_subtotal numeric;
  v_hasta timestamptz;
begin
  if not public.es_superadmin() then raise exception 'Solo el equipo de GPUnlock puede registrar pagos'; end if;
  if p_periodo not in ('mensual', 'anual') then raise exception 'Periodo no válido'; end if;
  if not exists (select 1 from public.planes where id = p_plan) then raise exception 'Plan no válido'; end if;
  if p_total is null or p_total < 0 then raise exception 'Monto no válido'; end if;
  if p_fecha is null or p_fecha > current_date + 1 then raise exception 'Fecha de la transferencia no válida'; end if;
  select iva_porcentaje into v_iva_pct from public.datos_cobro where id;
  v_subtotal := round(p_total / (1 + v_iva_pct / 100), 2);
  v_hasta := public.cobros_aplicar_pago(p_org, p_plan, p_periodo, v_subtotal, p_total - v_subtotal, p_total,
                                        p_fecha, p_banco, p_comprobante, p_factura, null);
  perform public.consola_registrar('pago_manual', p_org,
    jsonb_build_object('total', p_total, 'plan', p_plan, 'periodo', p_periodo, 'hasta', v_hasta, 'factura', p_factura));
  return jsonb_build_object('periodo_hasta', v_hasta);
end;
$$;

-- Ajustes manuales: cambiar plan, estado o vencimiento, extender la prueba.
create or replace function public.consola_ajustar(
  p_org uuid, p_plan text default null, p_estado text default null,
  p_periodo_hasta timestamptz default null, p_prueba_dias integer default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  antes public.organizaciones%rowtype;
begin
  if not public.es_superadmin() then raise exception 'Solo el equipo de GPUnlock puede ajustar suscripciones'; end if;
  select * into antes from public.organizaciones where id = p_org for update;
  if not found then raise exception 'La empresa no existe'; end if;
  if p_plan is not null and not exists (select 1 from public.planes where id = p_plan) then raise exception 'Plan no válido'; end if;
  if p_estado is not null and p_estado not in ('prueba', 'activa', 'gracia', 'vencida', 'cancelada') then raise exception 'Estado no válido'; end if;
  if p_prueba_dias is not null and p_prueba_dias not between 1 and 365 then raise exception 'Días de prueba no válidos'; end if;

  update public.organizaciones
     set plan_id = coalesce(p_plan, plan_id),
         estado = coalesce(p_estado, estado),
         periodo_hasta = coalesce(p_periodo_hasta, periodo_hasta),
         prueba_hasta = case when p_prueba_dias is null then prueba_hasta
                             else greatest(now(), prueba_hasta) + make_interval(days => p_prueba_dias) end
   where id = p_org;
  perform public.consola_registrar('ajuste', p_org, jsonb_build_object(
    'antes', jsonb_build_object('plan', antes.plan_id, 'estado', antes.estado, 'periodo_hasta', antes.periodo_hasta, 'prueba_hasta', antes.prueba_hasta),
    'cambios', jsonb_build_object('plan', p_plan, 'estado', p_estado, 'periodo_hasta', p_periodo_hasta, 'prueba_dias', p_prueba_dias)));
end;
$$;

create or replace function public.guardar_datos_cobro(
  p_banco text, p_tipo_cuenta text, p_numero_cuenta text, p_titular text, p_identificacion text,
  p_correo text, p_whatsapp text, p_iva numeric, p_dias_gracia integer, p_instrucciones text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_superadmin() then raise exception 'Solo el equipo de GPUnlock puede cambiar los datos de cobro'; end if;
  if p_iva is null or p_iva not between 0 and 30 then raise exception 'Porcentaje de IVA no válido'; end if;
  if p_dias_gracia is null or p_dias_gracia not between 0 and 30 then raise exception 'Días de gracia no válidos'; end if;
  update public.datos_cobro set
    banco = left(btrim(coalesce(p_banco, '')), 80), tipo_cuenta = left(btrim(coalesce(p_tipo_cuenta, '')), 40),
    numero_cuenta = left(btrim(coalesce(p_numero_cuenta, '')), 40), titular = left(btrim(coalesce(p_titular, '')), 120),
    identificacion = left(btrim(coalesce(p_identificacion, '')), 20), correo_cobros = left(btrim(coalesce(p_correo, '')), 120),
    whatsapp_cobros = left(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), 20), iva_porcentaje = p_iva,
    dias_gracia = p_dias_gracia, instrucciones = left(btrim(coalesce(p_instrucciones, '')), 500), updated_at = now()
  where id;
  perform public.consola_registrar('datos_cobro', null, jsonb_build_object('iva', p_iva, 'dias_gracia', p_dias_gracia));
end;
$$;

-- Lecturas de la consola (devuelven jsonb para que la pantalla no arme consultas con uniones).
create or replace function public.consola_pagos(p_estado text default 'en_revision')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_superadmin() then raise exception 'Sin acceso'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'org_id', s.org_id, 'empresa', o.nombre,
      'propietario', (select email from public.miembros m where m.org_id = o.id and m.rol = 'propietario' limit 1),
      'plan_id', s.plan_id, 'plan', p.nombre, 'periodo', s.periodo, 'referencia', s.referencia,
      'subtotal', s.subtotal, 'iva', s.iva, 'total', s.total, 'estado', s.estado,
      'comprobante_path', s.comprobante_path, 'comprobante_subido_at', s.comprobante_subido_at,
      'motivo_rechazo', s.motivo_rechazo, 'created_at', s.created_at, 'revisado_at', s.revisado_at,
      'estado_empresa', o.estado, 'periodo_hasta', o.periodo_hasta) order by s.created_at)
    from public.solicitudes_pago s
    join public.organizaciones o on o.id = s.org_id
    join public.planes p on p.id = s.plan_id
    where p_estado is null or s.estado = p_estado), '[]'::jsonb);
end;
$$;

create or replace function public.consola_empresas()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_superadmin() then raise exception 'Sin acceso'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'nombre', o.nombre, 'plan_id', o.plan_id, 'plan', p.nombre, 'estado', o.estado,
      'prueba_hasta', o.prueba_hasta, 'periodo_hasta', o.periodo_hasta, 'creada', o.created_at,
      'propietario', (select email from public.miembros m where m.org_id = o.id and m.rol = 'propietario' limit 1),
      'usuarios', (select count(*) from public.miembros m where m.org_id = o.id),
      'leads_mes', (select count(*) from public.crm_oportunidades x where x.org_id = o.id and x.created_at >= date_trunc('month', now())),
      'ultimo_pago', (select max(fecha_transferencia) from public.pagos_suscripcion g where g.org_id = o.id),
      'pago_abierto', exists (select 1 from public.solicitudes_pago s where s.org_id = o.id and s.estado in ('pendiente', 'en_revision'))
    ) order by o.created_at desc)
    from public.organizaciones o join public.planes p on p.id = o.plan_id), '[]'::jsonb);
end;
$$;

create or replace function public.consola_resumen()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_superadmin() then raise exception 'Sin acceso'; end if;
  return jsonb_build_object(
    'empresas', coalesce((select jsonb_object_agg(estado, n) from
                  (select estado, count(*) n from public.organizaciones group by estado) e), '{}'::jsonb),
    'por_revisar', (select count(*) from public.solicitudes_pago where estado = 'en_revision'),
    'ingresos_mes', coalesce((select sum(subtotal) from public.pagos_suscripcion
                              where fecha_transferencia >= date_trunc('month', current_date)), 0),
    'por_vencer_30d', (select count(*) from public.organizaciones
                       where estado = 'activa' and periodo_hasta between now() and now() + interval '30 days'),
    'ingresos_por_mes', coalesce((select jsonb_agg(jsonb_build_object('mes', to_char(mes, 'YYYY-MM'), 'subtotal', total) order by mes)
                          from (select date_trunc('month', fecha_transferencia) mes, sum(subtotal) total
                                from public.pagos_suscripcion
                                where fecha_transferencia >= date_trunc('month', current_date) - interval '11 months'
                                group by 1) m), '[]'::jsonb)
  );
end;
$$;

create or replace function public.consola_pagos_historial(p_org uuid default null, p_limite integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_superadmin() then raise exception 'Sin acceso'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select g.id, g.org_id, o.nombre as empresa, g.plan_id, g.periodo, g.subtotal, g.iva, g.total, g.fecha_transferencia,
             g.banco, g.numero_comprobante, g.factura_numero, g.cubre_desde, g.cubre_hasta, g.created_at
      from public.pagos_suscripcion g join public.organizaciones o on o.id = g.org_id
      where p_org is null or g.org_id = p_org
      order by g.created_at desc limit greatest(1, least(coalesce(p_limite, 100), 500))) x), '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------ vencimientos (diario) ---
create or replace function public.cobros_actualizar_estados()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_gracia integer := (select dias_gracia from public.datos_cobro where id);
  n_gracia integer; n_vencidas integer; n_avisos integer := 0; n integer;
begin
  update public.organizaciones set estado = 'gracia' where estado = 'activa' and periodo_hasta < now();
  get diagnostics n_gracia = row_count;
  update public.organizaciones set estado = 'vencida'
   where estado = 'gracia' and periodo_hasta + make_interval(days => v_gracia) < now();
  get diagnostics n_vencidas = row_count;

  -- Avisos (cada uno una sola vez por vencimiento). Ventanas: 7 a 3 días, 3 a 1 día, últimas 24 horas.
  insert into public.cobros_avisos (org_id, tipo, referencia_fecha)
  select id, 'd7', periodo_hasta from public.organizaciones
   where estado = 'activa' and periodo_hasta > now() + interval '3 days' and periodo_hasta <= now() + interval '7 days'
  on conflict do nothing;
  get diagnostics n = row_count; n_avisos := n_avisos + n;
  insert into public.cobros_avisos (org_id, tipo, referencia_fecha)
  select id, 'd3', periodo_hasta from public.organizaciones
   where estado = 'activa' and periodo_hasta > now() + interval '1 day' and periodo_hasta <= now() + interval '3 days'
  on conflict do nothing;
  get diagnostics n = row_count; n_avisos := n_avisos + n;
  insert into public.cobros_avisos (org_id, tipo, referencia_fecha)
  select id, 'd0', periodo_hasta from public.organizaciones
   where estado = 'activa' and periodo_hasta > now() and periodo_hasta <= now() + interval '1 day'
  on conflict do nothing;
  get diagnostics n = row_count; n_avisos := n_avisos + n;
  insert into public.cobros_avisos (org_id, tipo, referencia_fecha)
  select id, 'gracia', periodo_hasta from public.organizaciones where estado = 'gracia'
  on conflict do nothing;
  get diagnostics n = row_count; n_avisos := n_avisos + n;
  insert into public.cobros_avisos (org_id, tipo, referencia_fecha)
  select id, 'vencida', periodo_hasta from public.organizaciones where estado = 'vencida' and periodo_hasta is not null
  on conflict do nothing;
  get diagnostics n = row_count; n_avisos := n_avisos + n;
  insert into public.cobros_avisos (org_id, tipo, referencia_fecha)
  select id, 'prueba_d3', prueba_hasta from public.organizaciones
   where estado = 'prueba' and prueba_hasta > now() and prueba_hasta <= now() + interval '3 days'
  on conflict do nothing;
  get diagnostics n = row_count; n_avisos := n_avisos + n;
  insert into public.cobros_avisos (org_id, tipo, referencia_fecha)
  select id, 'prueba_d0', prueba_hasta from public.organizaciones
   where estado = 'prueba' and prueba_hasta <= now() and prueba_hasta > now() - interval '2 days'
  on conflict do nothing;
  get diagnostics n = row_count; n_avisos := n_avisos + n;

  return jsonb_build_object('a_gracia', n_gracia, 'a_vencida', n_vencidas, 'avisos_nuevos', n_avisos);
end;
$$;
revoke execute on function public.cobros_actualizar_estados() from public, anon, authenticated;

-- Todos los días a las 08:00 de Ecuador (13:00 UTC), si pg_cron está disponible
-- (en Supabase: Database → Extensions → pg_cron). Si no, ejecútala a mano o desde un cron externo.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('cobros-diario', '0 13 * * *', 'select public.cobros_actualizar_estados()');
  end if;
exception when others then
  raise notice 'pg_cron no se pudo configurar (%). Programa cobros_actualizar_estados() a mano.', sqlerrm;
end $$;

-- ------------------------------------------------------------ permisos finales ---
revoke execute on function
  public.solicitar_pago(uuid, text, text), public.subir_comprobante(uuid, text), public.cancelar_solicitud(uuid),
  public.uso_org(uuid), public.aprobar_pago(uuid, date, text, text, text), public.rechazar_pago(uuid, text),
  public.registrar_pago_manual(uuid, text, text, numeric, date, text, text, text),
  public.consola_ajustar(uuid, text, text, timestamptz, integer),
  public.guardar_datos_cobro(text, text, text, text, text, text, text, numeric, integer, text),
  public.consola_pagos(text), public.consola_empresas(), public.consola_resumen(),
  public.consola_pagos_historial(uuid, integer)
  from public, anon;
grant execute on function
  public.solicitar_pago(uuid, text, text), public.subir_comprobante(uuid, text), public.cancelar_solicitud(uuid),
  public.uso_org(uuid), public.aprobar_pago(uuid, date, text, text, text), public.rechazar_pago(uuid, text),
  public.registrar_pago_manual(uuid, text, text, numeric, date, text, text, text),
  public.consola_ajustar(uuid, text, text, timestamptz, integer),
  public.guardar_datos_cobro(text, text, text, text, text, text, text, numeric, integer, text),
  public.consola_pagos(text), public.consola_empresas(), public.consola_resumen(),
  public.consola_pagos_historial(uuid, integer)
  to authenticated;

-- ###########################################################################
-- 05_marca.sql
-- ###########################################################################
-- ============================================================================
-- GPUnlock CRM · 05 · Marca de cada empresa (logos, colores, nombre comercial)
-- Ejecutar después de 04_cobros.sql. Seguro de repetir.
--
-- Cada inmobiliaria sube su logo y elige su color; la app calcula la paleta, revisa el
-- contraste y cambia el tema de todo el equipo al instante (Realtime sobre org_marca).
--   · Solo propietario y administrador cambian la marca, con la suscripción activa.
--   · Los logos viven en el bucket público «marcas», carpeta <org_id>/ (PNG, JPG o WebP, hasta 1 MB;
--     sin SVG a propósito: un SVG puede llevar scripts).
--   · La pantalla de inicio de sesión de cada empresa (/app/?e=<subdominio>) lee su marca con
--     marca_publica(), que solo devuelve datos de marca y solo si se conoce el subdominio exacto.
--   · «Con la tecnología de GPUnlock» solo se puede quitar en el plan Agencia.
-- ============================================================================

create table if not exists public.org_marca (
  org_id uuid primary key references public.organizaciones(id) on delete cascade,
  nombre_comercial text check (nombre_comercial is null or char_length(nombre_comercial) between 2 and 60),
  subdominio text unique check (subdominio is null or subdominio ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  color_primario text not null default '#F2582B' check (color_primario ~ '^#[0-9A-Fa-f]{6}$'),
  color_acento text check (color_acento is null or color_acento ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path text,
  logo_oscuro_path text,
  mostrar_pie_gpunlock boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.org_marca enable row level security;
drop trigger if exists org_marca_updated_at on public.org_marca;
create trigger org_marca_updated_at before update on public.org_marca
  for each row execute function public.set_updated_at();

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'org_marca'
  loop
    execute format('drop policy %I on public.org_marca', r.policyname);
  end loop;
end $$;
create policy "marca: la ve su equipo" on public.org_marca
  for select to authenticated using (public.es_miembro(org_id));
revoke all on public.org_marca from anon;
revoke insert, update, delete on public.org_marca from authenticated;

-- ---------------------------------------------------------------- logos (Storage) ---
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marcas', 'marcas', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = true;

-- Los archivos van en <org_id>/<nombre>.<png|jpg|jpeg|webp>. Escribe el propietario o el administrador de esa empresa.
create or replace function public.puede_escribir_marca(p_nombre text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  if coalesce(p_nombre, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$' then
    return false;
  end if;
  v_org := split_part(p_nombre, '/', 1)::uuid;
  return public.tiene_rol_org(v_org, array['propietario', 'administrador']) and public.org_activa(v_org);
end;
$$;
revoke execute on function public.puede_escribir_marca(text) from public, anon;
grant execute on function public.puede_escribir_marca(text) to authenticated;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'marcas:%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;
create policy "marcas: sube su equipo gestor" on storage.objects
  for insert to authenticated with check (bucket_id = 'marcas' and public.puede_escribir_marca(name));
create policy "marcas: borra su equipo gestor" on storage.objects
  for delete to authenticated using (bucket_id = 'marcas' and public.puede_escribir_marca(name));
-- Para borrar (y reemplazar) un archivo, la API de Storage exige también poder leerlo: solo quien gestiona la marca de esa empresa.
-- Los logos se ven por su URL pública sin pasar por aquí, y nadie más puede listar los archivos.
create policy "marcas: lee su equipo gestor" on storage.objects
  for select to authenticated using (bucket_id = 'marcas' and public.puede_escribir_marca(name));

-- ------------------------------------------------------------------- guardar la marca ---
create or replace function public.guardar_marca(
  p_org uuid, p_nombre text, p_subdominio text, p_color text, p_acento text,
  p_logo text, p_logo_oscuro text, p_ocultar_pie boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_sub text := nullif(lower(btrim(coalesce(p_subdominio, ''))), '');
  v_color text := upper(btrim(coalesce(p_color, '')));
  v_acento text := nullif(upper(btrim(coalesce(p_acento, ''))), '');
  v_plan text;
  v_fila public.org_marca%rowtype;
begin
  if not public.tiene_rol_org(p_org, array['propietario', 'administrador']) then raise exception 'Tu rol no permite cambiar la marca'; end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa. Renuévala para cambiar la marca.'; end if;
  if v_nombre is not null and char_length(v_nombre) not between 2 and 60 then raise exception 'El nombre comercial debe tener entre 2 y 60 letras'; end if;
  if v_color !~ '^#[0-9A-F]{6}$' then raise exception 'El color principal debe ser un color como #F2582B'; end if;
  if v_acento is not null and v_acento !~ '^#[0-9A-F]{6}$' then raise exception 'El color de acento debe ser un color como #F08A30'; end if;
  if v_sub is not null then
    if v_sub !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then raise exception 'La dirección corta usa solo letras, números y guiones (3 a 40 caracteres)'; end if;
    if v_sub in ('www', 'app', 'consola', 'admin', 'api', 'mail', 'correo', 'soporte', 'ayuda', 'descargar', 'gpunlock', 'demo', 'login', 'registro', 'cuenta', 'embed', 'assets', 'css', 'js') then
      raise exception 'Esa dirección corta está reservada, elige otra';
    end if;
  end if;
  if p_logo is not null and p_logo !~* ('^' || p_org::text || '/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$') then raise exception 'Logo no válido'; end if;
  if p_logo_oscuro is not null and p_logo_oscuro !~* ('^' || p_org::text || '/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$') then raise exception 'Logo oscuro no válido'; end if;
  select plan_id into v_plan from public.organizaciones where id = p_org;
  if coalesce(p_ocultar_pie, false) and v_plan <> 'agencia' then
    raise exception 'Quitar «Con la tecnología de GPUnlock» es parte del plan Agencia';
  end if;

  begin
    insert into public.org_marca (org_id, nombre_comercial, subdominio, color_primario, color_acento, logo_path, logo_oscuro_path, mostrar_pie_gpunlock)
    values (p_org, v_nombre, v_sub, v_color, v_acento, p_logo, p_logo_oscuro, not coalesce(p_ocultar_pie, false))
    on conflict (org_id) do update set
      nombre_comercial = excluded.nombre_comercial, subdominio = excluded.subdominio, color_primario = excluded.color_primario,
      color_acento = excluded.color_acento, logo_path = excluded.logo_path, logo_oscuro_path = excluded.logo_oscuro_path,
      mostrar_pie_gpunlock = excluded.mostrar_pie_gpunlock
    returning * into v_fila;
  exception when unique_violation then
    raise exception 'Esa dirección corta ya está en uso, elige otra';
  end;
  return to_jsonb(v_fila);
end;
$$;

-- ----------------------------------------------- marca pública (pantalla de inicio de sesión) ---
-- Devuelve solo datos de marca de UNA empresa y solo si se conoce su dirección corta exacta.
create or replace function public.marca_publica(p_subdominio text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nombre', coalesce(m.nombre_comercial, o.nombre),
    'color_primario', m.color_primario,
    'color_acento', m.color_acento,
    'logo_path', m.logo_path,
    'logo_oscuro_path', m.logo_oscuro_path,
    'mostrar_pie_gpunlock', m.mostrar_pie_gpunlock)
  from public.org_marca m join public.organizaciones o on o.id = m.org_id
  where m.subdominio = lower(btrim(coalesce(p_subdominio, '')))
$$;

revoke execute on function public.guardar_marca(uuid, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.guardar_marca(uuid, text, text, text, text, text, text, boolean) to authenticated;
revoke execute on function public.marca_publica(text) from public;
grant execute on function public.marca_publica(text) to anon, authenticated;

-- Tiempo real: cuando la empresa cambia su marca, todo el equipo la recibe sin recargar.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'org_marca') then
    alter publication supabase_realtime add table public.org_marca;
  end if;
end $$;

-- ###########################################################################
-- 06_avisos.sql
-- ###########################################################################
-- ============================================================================
-- 06 · Avisos por correo del cobro (vencimientos, comprobante recibido, pago aprobado o rechazado)
--
-- 04_cobros.sql ya deja filas en cobros_avisos (vencimientos). Aquí se completan los tipos y se
-- crean las dos funciones que usa la Edge Function `cobros-avisos` (con la clave service_role):
--   avisos_pendientes(n)  → lo que falta enviar, con destinatarios y datos para escribir el correo
--   avisos_marcar(id, ok, error) → registra el resultado (reintenta hasta 5 veces)
-- Nadie con sesión de usuario puede ejecutarlas.
-- ============================================================================

alter table public.cobros_avisos add column if not exists solicitud_id uuid references public.solicitudes_pago(id) on delete set null;
alter table public.cobros_avisos add column if not exists intentos integer not null default 0;
alter table public.cobros_avisos add column if not exists error text;

alter table public.cobros_avisos drop constraint if exists cobros_avisos_tipo_check;
alter table public.cobros_avisos add constraint cobros_avisos_tipo_check
  check (tipo in ('prueba_d3', 'prueba_d0', 'd7', 'd3', 'd0', 'gracia', 'vencida', 'comprobante', 'aprobado', 'rechazado'));

create index if not exists cobros_avisos_pendientes_ix on public.cobros_avisos (created_at) where enviado_at is null;

-- ------------------------------------------------ avisos que nacen de una solicitud ---
create or replace function public.solicitud_avisos()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'en_revision' and new.comprobante_subido_at is not null
     and (tg_op = 'INSERT' or old.comprobante_subido_at is distinct from new.comprobante_subido_at) then
    insert into public.cobros_avisos (org_id, tipo, referencia_fecha, solicitud_id)
    values (new.org_id, 'comprobante', new.comprobante_subido_at, new.id) on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.estado is distinct from new.estado and new.estado in ('aprobada', 'rechazada') then
    insert into public.cobros_avisos (org_id, tipo, referencia_fecha, solicitud_id)
    values (new.org_id, case new.estado when 'aprobada' then 'aprobado' else 'rechazado' end, coalesce(new.revisado_at, now()), new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.solicitud_avisos() from public, anon, authenticated;
drop trigger if exists solicitud_avisos_t on public.solicitudes_pago;
create trigger solicitud_avisos_t after insert or update on public.solicitudes_pago
  for each row execute function public.solicitud_avisos();

-- --------------------------------------------------------------- lo pendiente de enviar ---
-- Descarta lo obsoleto (una empresa que ya renovó no recibe «tu plan vence») y devuelve el resto.
create or replace function public.avisos_pendientes(p_limite integer default 25)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cobro public.datos_cobro%rowtype;
  v_admins text[];
begin
  select * into v_cobro from public.datos_cobro where id;

  update public.cobros_avisos a set enviado_at = now(), error = 'obsoleto'
   from public.organizaciones o
   where a.org_id = o.id and a.enviado_at is null and (
        (a.tipo in ('d7', 'd3', 'd0') and (o.estado <> 'activa' or o.periodo_hasta is distinct from a.referencia_fecha))
     or (a.tipo = 'gracia'  and (o.estado <> 'gracia'  or o.periodo_hasta is distinct from a.referencia_fecha))
     or (a.tipo = 'vencida' and (o.estado <> 'vencida' or o.periodo_hasta is distinct from a.referencia_fecha))
     or (a.tipo in ('prueba_d3', 'prueba_d0') and (o.estado <> 'prueba' or o.prueba_hasta is distinct from a.referencia_fecha)));
  update public.cobros_avisos set enviado_at = now(), error = 'caducado'
   where enviado_at is null and created_at < now() - interval '3 days';
  update public.cobros_avisos set enviado_at = now(), error = coalesce(error, 'sin éxito tras 5 intentos')
   where enviado_at is null and intentos >= 5;

  select coalesce(array_agg(distinct lower(email)) filter (where email <> ''), '{}') into v_admins from public.superadmins;
  if v_cobro.correo_cobros <> '' then v_admins := v_admins || lower(v_cobro.correo_cobros); end if;

  return coalesce((
    select jsonb_agg(x order by x.id) from (
      select a.id, a.tipo, a.referencia_fecha, a.intentos, o.id as org_id, o.nombre as empresa, o.estado,
             o.plan_id, p.nombre as plan_nombre, o.periodo_hasta, o.prueba_hasta, v_cobro.dias_gracia,
             v_cobro.whatsapp_cobros,
             case when a.tipo = 'comprobante' then to_jsonb(v_admins)
                  else coalesce((select jsonb_agg(distinct lower(m.email)) from public.miembros m
                                  where m.org_id = o.id and m.rol = 'propietario' and m.email <> ''), '[]'::jsonb) end as destinatarios,
             case when s.id is null then null else jsonb_build_object(
               'referencia', s.referencia, 'plan', sp.nombre, 'periodo', s.periodo, 'total', s.total, 'motivo', s.motivo_rechazo) end as solicitud
        from public.cobros_avisos a
        join public.organizaciones o on o.id = a.org_id
        left join public.planes p on p.id = o.plan_id
        left join public.solicitudes_pago s on s.id = a.solicitud_id
        left join public.planes sp on sp.id = s.plan_id
       where a.enviado_at is null
       order by a.id limit greatest(1, least(coalesce(p_limite, 25), 100))) x), '[]'::jsonb);
end;
$$;

create or replace function public.avisos_marcar(p_id bigint, p_ok boolean, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.cobros_avisos
     set enviado_at = case when p_ok then now() else enviado_at end,
         intentos = intentos + case when p_ok then 0 else 1 end,
         error = case when p_ok then null else left(coalesce(p_error, 'error'), 300) end
   where id = p_id and enviado_at is null;
$$;

revoke execute on function public.avisos_pendientes(integer), public.avisos_marcar(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.avisos_pendientes(integer), public.avisos_marcar(bigint, boolean, text) to service_role;
