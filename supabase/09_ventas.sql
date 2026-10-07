-- ============================================================================
-- GPUnlock CRM · 09 · Embudo premium y matching inmobiliario
-- Ejecutar después de 08_cotizador.sql. Seguro de repetir.
--
--   · Tiempos de cada lead: desde cuándo está en su etapa, su última actividad y su PRIMERA RESPUESTA
--     (speed-to-lead). Los calcula la base a partir de las actividades; la app no los puede escribir.
--   · Configuración del embudo por empresa: probabilidad de cierre y días de alerta por etapa (rotting)
--     y el tiempo máximo para responder un lead nuevo (SLA).
--   · Automatización por etapa: al entrar a una etapa se crea la tarea que la empresa definió.
--   · Lo que busca cada cliente (tipo, dormitorios, presupuesto, proyecto) y el matching con el inventario:
--     unidades que le calzan a un lead y leads a los que les calza una unidad.
--   · Métricas de ventas: primera respuesta (mediana, p90, % en SLA), valor ponderado, % con próxima tarea.
-- ============================================================================

-- --------------------------------------------------------------- tiempos del lead ---
alter table public.crm_oportunidades add column if not exists etapa_desde timestamptz;
alter table public.crm_oportunidades add column if not exists ultima_actividad_at timestamptz;
alter table public.crm_oportunidades add column if not exists primera_respuesta_at timestamptz;

-- Una actividad «de contacto» hecha por una persona del equipo cuenta como respuesta al cliente.
create or replace function public.crm_es_respuesta(p_tipo text, p_por text)
returns boolean language sql immutable set search_path = public as $$
  select p_tipo in ('nota', 'llamada', 'whatsapp', 'correo', 'visita') and coalesce(p_por, '') like '%@%'
$$;

-- Datos de los leads que ya existían (una sola vez: solo donde aún no hay valor). Sin tocar su «última modificación».
alter table public.crm_oportunidades disable trigger crm_oportunidades_updated_at;
update public.crm_oportunidades o set
  etapa_desde = coalesce((select max(a.created_at) from public.crm_actividades a where a.oportunidad_id = o.id and a.tipo = 'cambio_etapa'), o.created_at),
  ultima_actividad_at = (select max(a.created_at) from public.crm_actividades a where a.oportunidad_id = o.id and a.creado_por like '%@%'),
  primera_respuesta_at = (select min(a.created_at) from public.crm_actividades a where a.oportunidad_id = o.id and public.crm_es_respuesta(a.tipo, a.creado_por))
where o.etapa_desde is null;
alter table public.crm_oportunidades alter column etapa_desde set default now();
update public.crm_oportunidades set etapa_desde = created_at where etapa_desde is null;
alter table public.crm_oportunidades enable trigger crm_oportunidades_updated_at;
alter table public.crm_oportunidades alter column etapa_desde set not null;

-- La etapa marca su hora; los tiempos no se editan desde la app.
create or replace function public.crm_oportunidad_tiempos()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.etapa is distinct from old.etapa then new.etapa_desde := now();
  elsif current_user in ('authenticated', 'anon') then new.etapa_desde := old.etapa_desde; end if;
  if current_user in ('authenticated', 'anon') then
    new.primera_respuesta_at := old.primera_respuesta_at;
    new.ultima_actividad_at := old.ultima_actividad_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.crm_oportunidad_tiempos() from public, anon, authenticated;
drop trigger if exists crm_oportunidad_tiempos on public.crm_oportunidades;
create trigger crm_oportunidad_tiempos before update on public.crm_oportunidades
  for each row execute function public.crm_oportunidad_tiempos();

create or replace function public.crm_actividad_tiempos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.creado_por, '') like '%@%' then
    update public.crm_oportunidades set
      ultima_actividad_at = greatest(coalesce(ultima_actividad_at, new.created_at), new.created_at),
      primera_respuesta_at = case when primera_respuesta_at is null and public.crm_es_respuesta(new.tipo, new.creado_por) then new.created_at else primera_respuesta_at end
    where id = new.oportunidad_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.crm_actividad_tiempos() from public, anon, authenticated;
drop trigger if exists crm_actividad_tiempos on public.crm_actividades;
create trigger crm_actividad_tiempos after insert on public.crm_actividades
  for each row execute function public.crm_actividad_tiempos();

-- ------------------------------------------------------- configuración del embudo ---
create table if not exists public.crm_ventas_config (
  org_id uuid primary key references public.organizaciones(id) on delete cascade,
  sla_minutos integer not null default 15 check (sla_minutos between 1 and 1440),
  etapas jsonb not null default '{}'::jsonb,       -- { "cita": { "probabilidad": 40, "dias_alerta": 5 }, … }
  updated_at timestamptz not null default now()
);
alter table public.crm_ventas_config enable row level security;

-- Valores por defecto pensados para una inmobiliaria; cada empresa los ajusta.
create or replace function public.crm_etapas_defecto()
returns jsonb language sql immutable set search_path = public as $$
  select '{"nuevo":{"probabilidad":5,"dias_alerta":1},"contactado":{"probabilidad":10,"dias_alerta":3},"cita":{"probabilidad":25,"dias_alerta":5},
           "proforma":{"probabilidad":50,"dias_alerta":7},"reserva":{"probabilidad":85,"dias_alerta":15}}'::jsonb
$$;

-- Configuración efectiva (con los valores por defecto donde la empresa no puso nada).
create or replace function public.crm_config_ventas(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.es_miembro(p_org) then jsonb_build_object(
    'sla_minutos', coalesce((select sla_minutos from public.crm_ventas_config where org_id = p_org), 15),
    'etapas', (select jsonb_object_agg(k, public.crm_etapas_defecto() -> k || coalesce((select etapas -> k from public.crm_ventas_config where org_id = p_org), '{}'::jsonb))
                 from jsonb_object_keys(public.crm_etapas_defecto()) k)) end
$$;

create or replace function public.guardar_config_ventas(p_org uuid, p_sla integer, p_etapas jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; limpio jsonb := '{}'::jsonb; p numeric; d numeric;
begin
  if not public.tiene_rol_org(p_org, array['propietario', 'administrador']) then raise exception 'Solo el propietario o un administrador configura el embudo'; end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa. Renuévala para cambiar la configuración.'; end if;
  if p_sla is null or p_sla not between 1 and 1440 then raise exception 'El tiempo para responder va de 1 minuto a 24 horas'; end if;
  for k, v in select key, value from jsonb_each(coalesce(p_etapas, '{}'::jsonb)) loop
    if not public.crm_etapas_defecto() ? k then raise exception 'Etapa no válida: %', k; end if;
    begin
      p := (v ->> 'probabilidad')::numeric; d := nullif(v ->> 'dias_alerta', '')::numeric;
    exception when others then raise exception 'Revisa los valores de la etapa %', k;
    end;
    if p is null or p not between 0 and 100 or p <> trunc(p) then raise exception 'La probabilidad de % va de 0 a 100', k; end if;
    if d is not null and (d not between 1 and 90 or d <> trunc(d)) then raise exception 'Los días de alerta de % van de 1 a 90', k; end if;
    limpio := limpio || jsonb_build_object(k, jsonb_build_object('probabilidad', p::int, 'dias_alerta', d::int));
  end loop;
  insert into public.crm_ventas_config (org_id, sla_minutos, etapas) values (p_org, p_sla, limpio)
  on conflict (org_id) do update set sla_minutos = excluded.sla_minutos, etapas = excluded.etapas, updated_at = now();
  return public.crm_config_ventas(p_org);
end;
$$;

-- --------------------------------------------------------- automatización por etapa ---
create table if not exists public.crm_automatizaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  etapa text not null check (etapa in ('nuevo', 'contactado', 'cita', 'proforma', 'reserva', 'vendido', 'perdido')),
  titulo text not null check (char_length(titulo) between 3 and 200),
  vence_min integer not null default 60 check (vence_min between 0 and 43200),
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists crm_automatizaciones_ix on public.crm_automatizaciones (org_id, etapa) where activa;
alter table public.crm_automatizaciones enable row level security;

create or replace function public.guardar_automatizacion(p_org uuid, p_id uuid, p_etapa text, p_titulo text, p_vence_min integer, p_activa boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.crm_automatizaciones%rowtype;
begin
  if not public.tiene_rol_org(p_org, array['propietario', 'administrador']) then raise exception 'Solo el propietario o un administrador configura las automatizaciones'; end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa. Renuévala para cambiar la configuración.'; end if;
  if (select count(*) from public.crm_automatizaciones where org_id = p_org and id is distinct from p_id) >= 30 then raise exception 'Máximo 30 automatizaciones por empresa'; end if;
  begin
    if p_id is null then
      insert into public.crm_automatizaciones (org_id, etapa, titulo, vence_min, activa) values (p_org, p_etapa, btrim(coalesce(p_titulo, '')), p_vence_min, coalesce(p_activa, true)) returning * into a;
    else
      update public.crm_automatizaciones set etapa = p_etapa, titulo = btrim(coalesce(p_titulo, '')), vence_min = p_vence_min, activa = coalesce(p_activa, true)
       where id = p_id and org_id = p_org returning * into a;
      if not found then raise exception 'No se encontró la automatización'; end if;
    end if;
  exception
    when check_violation then raise exception 'Revisa la etapa, el texto de la tarea (3 a 200 letras) y el plazo (hasta 30 días)';
    when not_null_violation then raise exception 'Completa la etapa, la tarea y el plazo';
  end;
  return to_jsonb(a);
end;
$$;

create or replace function public.eliminar_automatizacion(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.crm_automatizaciones where id = p_id;
  if v_org is null or not public.tiene_rol_org(v_org, array['propietario', 'administrador']) then raise exception 'No se encontró la automatización'; end if;
  delete from public.crm_automatizaciones where id = p_id;
end;
$$;

-- Al crear un lead o al cambiar de etapa: una tarea por cada automatización activa de esa etapa.
-- {cliente} y {proyecto} en el texto se reemplazan por los datos del lead.
create or replace function public.crm_ejecutar_automatizaciones()
returns trigger language plpgsql security definer set search_path = public as $$
declare a record; v_cli text; v_proy text;
begin
  if tg_op = 'UPDATE' and new.etapa is not distinct from old.etapa then return new; end if;
  if tg_op = 'INSERT' and new.importacion_id is not null then return new; end if;   -- la cartera importada no genera tareas en masa
  if not exists (select 1 from public.crm_automatizaciones where org_id = new.org_id and etapa = new.etapa and activa) then return new; end if;
  select nombre into v_cli from public.crm_contactos where id = new.contacto_id;
  select nombre into v_proy from public.crm_proyectos where org_id = new.org_id and slug = new.proyecto;
  for a in select * from public.crm_automatizaciones where org_id = new.org_id and etapa = new.etapa and activa order by created_at loop
    insert into public.crm_actividades (org_id, oportunidad_id, contacto_id, tipo, contenido, vence_at, creado_por)
    values (new.org_id, new.id, new.contacto_id, 'tarea',
            left(replace(replace(a.titulo, '{cliente}', coalesce(v_cli, 'el cliente')), '{proyecto}', coalesce(v_proy, new.proyecto, 'el proyecto')), 4000),
            now() + make_interval(mins => a.vence_min), 'sistema');
  end loop;
  return new;
end;
$$;
revoke execute on function public.crm_ejecutar_automatizaciones() from public, anon, authenticated;
drop trigger if exists crm_ejecutar_automatizaciones on public.crm_oportunidades;
create trigger crm_ejecutar_automatizaciones after insert or update of etapa on public.crm_oportunidades
  for each row execute function public.crm_ejecutar_automatizaciones();

-- ------------------------------------------------------- lo que busca cada cliente ---
create table if not exists public.crm_busquedas (
  oportunidad_id uuid primary key references public.crm_oportunidades(id) on delete cascade,
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  proyecto text,
  tipos text[] not null default '{}',
  dormitorios_min smallint check (dormitorios_min is null or dormitorios_min between 0 and 20),
  precio_min numeric(14, 2) check (precio_min is null or precio_min >= 0),
  precio_max numeric(14, 2) check (precio_max is null or precio_max >= 0),
  notas text check (notas is null or char_length(notas) <= 500),
  updated_at timestamptz not null default now()
);
create index if not exists crm_busquedas_org_ix on public.crm_busquedas (org_id);
alter table public.crm_busquedas enable row level security;

create or replace function public.guardar_busqueda(p_op uuid, p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.crm_oportunidades%rowtype; d jsonb := coalesce(p_datos, '{}'::jsonb); b public.crm_busquedas%rowtype;
  v_tipos text[]; v_proy text; v_dmin numeric; v_pmin numeric; v_pmax numeric;
begin
  select * into o from public.crm_oportunidades where id = p_op;
  if not found or not public.crm_puede_gestionar_op(p_op) then raise exception 'No puedes editar lo que busca este cliente'; end if;
  begin
    select coalesce(array_agg(distinct lower(t)), '{}') into v_tipos from jsonb_array_elements_text(coalesce(d -> 'tipos', '[]'::jsonb)) t;
    v_dmin := nullif(d ->> 'dormitorios_min', '')::numeric; v_pmin := nullif(d ->> 'precio_min', '')::numeric; v_pmax := nullif(d ->> 'precio_max', '')::numeric;
  exception when others then raise exception 'Revisa los valores: alguno no es un número';
  end;
  if exists (select 1 from unnest(v_tipos) t where t not in ('departamento', 'suite', 'loft', 'casa', 'lote', 'local', 'oficina', 'parqueo', 'bodega', 'otro')) then raise exception 'Tipo de unidad no válido'; end if;
  if v_dmin is not null and (v_dmin not between 0 and 20 or v_dmin <> trunc(v_dmin)) then raise exception 'Los dormitorios van de 0 a 20'; end if;
  if v_pmin is not null and v_pmin < 0 or v_pmax is not null and v_pmax < 0 then raise exception 'El presupuesto no puede ser negativo'; end if;
  if v_pmin is not null and v_pmax is not null and v_pmin > v_pmax then raise exception 'El presupuesto mínimo es mayor que el máximo'; end if;
  v_proy := nullif(lower(btrim(coalesce(d ->> 'proyecto', ''))), '');
  if v_proy is not null and not exists (select 1 from public.crm_proyectos where org_id = o.org_id and slug = v_proy) then raise exception 'El proyecto no existe'; end if;
  insert into public.crm_busquedas (oportunidad_id, org_id, proyecto, tipos, dormitorios_min, precio_min, precio_max, notas)
  values (o.id, o.org_id, v_proy, v_tipos, v_dmin, v_pmin, v_pmax, nullif(left(btrim(coalesce(d ->> 'notas', '')), 500), ''))
  on conflict (oportunidad_id) do update set proyecto = excluded.proyecto, tipos = excluded.tipos, dormitorios_min = excluded.dormitorios_min,
    precio_min = excluded.precio_min, precio_max = excluded.precio_max, notas = excluded.notas, updated_at = now()
  returning * into b;
  return to_jsonb(b);
end;
$$;

-- Puntaje 0–100 de qué tan bien calza una unidad con una búsqueda (proyecto 25, tipo 25, precio 30, dormitorios 20).
-- Lo que la búsqueda no especifica cuenta como «neutral» (algo de puntaje), no como coincidencia perfecta.
create or replace function public.crm_puntaje_match(
  b_proyecto text, b_tipos text[], b_dmin smallint, b_pmin numeric, b_pmax numeric,
  u_proyecto text, u_tipo text, u_dorm smallint, u_precio numeric
) returns integer language sql immutable set search_path = public as $$
  select (case when b_proyecto is null then 15 when u_proyecto = b_proyecto then 25 else 0 end)
       + (case when coalesce(cardinality(b_tipos), 0) = 0 then 15 when u_tipo = any(b_tipos) then 25 else 0 end)
       + (case when b_pmin is null and b_pmax is null then 15
               when u_precio is null then 10
               when u_precio between coalesce(b_pmin, 0) and coalesce(b_pmax, u_precio) then 30
               when u_precio between coalesce(b_pmin, 0) * 0.9 and coalesce(b_pmax, u_precio) * 1.1 then 15
               else 0 end)
       + (case when b_dmin is null then 10 when u_dorm >= b_dmin then 20 when u_dorm = b_dmin - 1 then 8 else 0 end)
$$;

-- Con los permisos de quien pregunta (RLS): un agente solo ve lo que ya puede ver.
create or replace function public.unidades_sugeridas(p_op uuid, p_limite integer default 6)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with m as (
    select u.*, public.crm_puntaje_match(b.proyecto, b.tipos, b.dormitorios_min, b.precio_min, b.precio_max, u.proyecto, u.tipo, u.dormitorios, u.precio) as puntaje
      from public.crm_busquedas b
      join public.crm_unidades u on u.org_id = b.org_id and u.estado = 'disponible'
     where b.oportunidad_id = p_op
       and (cardinality(b.tipos) > 0 or b.dormitorios_min is not null or b.precio_min is not null or b.precio_max is not null)
  ), top as (
    select * from m where puntaje >= 60 order by puntaje desc, precio nulls last, codigo limit greatest(1, least(coalesce(p_limite, 6), 30))
  )
  select coalesce(jsonb_agg(to_jsonb(top) - 'org_id' - 'publica' order by puntaje desc, precio nulls last, codigo), '[]'::jsonb) from top
$$;

create or replace function public.leads_para_unidad(p_unidad uuid, p_limite integer default 20)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with m as (
    select o.id as oportunidad_id, c.nombre, c.telefono, c.telefono_norm, o.etapa, o.asignado_a, o.updated_at as actualizado,
           public.crm_puntaje_match(b.proyecto, b.tipos, b.dormitorios_min, b.precio_min, b.precio_max, u.proyecto, u.tipo, u.dormitorios, u.precio) as puntaje
      from public.crm_unidades u
      join public.crm_busquedas b on b.org_id = u.org_id
      join public.crm_oportunidades o on o.id = b.oportunidad_id and o.etapa not in ('vendido', 'perdido')
      join public.crm_contactos c on c.id = o.contacto_id
     where u.id = p_unidad
       and (cardinality(b.tipos) > 0 or b.dormitorios_min is not null or b.precio_min is not null or b.precio_max is not null)
  ), top as (
    select * from m where puntaje >= 60 order by puntaje desc, actualizado desc limit greatest(1, least(coalesce(p_limite, 20), 100))
  )
  select coalesce(jsonb_agg(to_jsonb(top) order by puntaje desc, actualizado desc), '[]'::jsonb) from top
$$;

-- ------------------------------------------------------------------- métricas ---
create or replace function public.crm_metricas_ventas(p_org uuid, p_dias integer default 30)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
  cfg jsonb := public.crm_config_ventas(p_org);
  v_sla integer := coalesce((cfg ->> 'sla_minutos')::int, 15);
begin
  if cfg is null then raise exception 'Sin acceso'; end if;
  return jsonb_build_object(
    'sla_minutos', v_sla,
    'primera_respuesta', (
      select jsonb_build_object(
        'respondidos', count(*) filter (where primera_respuesta_at is not null),
        'mediana_min', round((percentile_cont(0.5) within group (order by (extract(epoch from primera_respuesta_at - created_at) / 60)::float8)
                        filter (where primera_respuesta_at is not null))::numeric, 1),
        'p90_min', round((percentile_cont(0.9) within group (order by (extract(epoch from primera_respuesta_at - created_at) / 60)::float8)
                        filter (where primera_respuesta_at is not null))::numeric, 1),
        'en_sla_pct', round(100.0 * count(*) filter (where primera_respuesta_at <= created_at + make_interval(mins => v_sla))
                        / nullif(count(*) filter (where primera_respuesta_at is not null), 0), 0))
      from public.crm_oportunidades where org_id = p_org and created_at >= v_desde and importacion_id is null),
    'sin_responder', (select count(*) from public.crm_oportunidades where org_id = p_org and primera_respuesta_at is null and etapa not in ('vendido', 'perdido')),
    'por_asesor', coalesce((
      select jsonb_agg(jsonb_build_object('email', asignado_a, 'respondidos', n, 'mediana_min', med) order by med nulls last)
      from (select asignado_a, count(*) as n,
                   round((percentile_cont(0.5) within group (order by (extract(epoch from primera_respuesta_at - created_at) / 60)::float8))::numeric, 1) as med
              from public.crm_oportunidades
             where org_id = p_org and created_at >= v_desde and asignado_a is not null and primera_respuesta_at is not null and importacion_id is null
             group by asignado_a) a), '[]'::jsonb),
    'valor_abierto', (select coalesce(sum(valor_estimado), 0) from public.crm_oportunidades where org_id = p_org and etapa not in ('vendido', 'perdido')),
    'valor_ponderado', (select coalesce(round(sum(valor_estimado * coalesce((cfg -> 'etapas' -> etapa ->> 'probabilidad')::numeric, 0) / 100), 2), 0)
                          from public.crm_oportunidades where org_id = p_org and etapa not in ('vendido', 'perdido')),
    'con_tarea_pct', (select round(100.0 * count(*) filter (where exists (select 1 from public.crm_actividades a where a.oportunidad_id = o.id and a.tipo = 'tarea' and a.hecha_at is null))
                              / nullif(count(*), 0), 0)
                        from public.crm_oportunidades o where o.org_id = p_org and o.etapa not in ('vendido', 'perdido')),
    'estancados', (select count(*) from public.crm_oportunidades o
                    where o.org_id = p_org and o.etapa not in ('vendido', 'perdido')
                      and (cfg -> 'etapas' -> o.etapa ->> 'dias_alerta') is not null
                      and greatest(coalesce(o.ultima_actividad_at, o.created_at), o.etapa_desde) < now() - make_interval(days => (cfg -> 'etapas' -> o.etapa ->> 'dias_alerta')::int))
  );
end;
$$;

-- ------------------------------------------------------------------- permisos ---
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('crm_ventas_config', 'crm_automatizaciones', 'crm_busquedas')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
create policy "config de ventas: la ve el equipo" on public.crm_ventas_config
  for select to authenticated using (public.es_miembro(org_id));
create policy "automatizaciones: las ve el equipo" on public.crm_automatizaciones
  for select to authenticated using (public.es_miembro(org_id));
create policy "búsquedas: las ve quien ve el lead" on public.crm_busquedas
  for select to authenticated using (public.crm_puede_ver_op(oportunidad_id));
revoke all on public.crm_ventas_config, public.crm_automatizaciones, public.crm_busquedas from anon;
revoke insert, update, delete, truncate on public.crm_ventas_config, public.crm_automatizaciones, public.crm_busquedas from authenticated;

revoke execute on function public.crm_config_ventas(uuid), public.guardar_config_ventas(uuid, integer, jsonb),
  public.guardar_automatizacion(uuid, uuid, text, text, integer, boolean), public.eliminar_automatizacion(uuid),
  public.guardar_busqueda(uuid, jsonb), public.unidades_sugeridas(uuid, integer), public.leads_para_unidad(uuid, integer),
  public.crm_metricas_ventas(uuid, integer) from public, anon;
grant execute on function public.crm_config_ventas(uuid), public.guardar_config_ventas(uuid, integer, jsonb),
  public.guardar_automatizacion(uuid, uuid, text, text, integer, boolean), public.eliminar_automatizacion(uuid),
  public.guardar_busqueda(uuid, jsonb), public.unidades_sugeridas(uuid, integer), public.leads_para_unidad(uuid, integer),
  public.crm_metricas_ventas(uuid, integer) to authenticated;
