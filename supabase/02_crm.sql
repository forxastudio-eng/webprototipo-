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
