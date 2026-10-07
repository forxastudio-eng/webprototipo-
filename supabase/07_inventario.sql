-- ============================================================================
-- GPUnlock CRM · 07 · Inventario de unidades por empresa
-- Ejecutar después de 06_avisos.sql. Seguro de repetir.
--
-- Cada inmobiliaria carga las unidades de sus proyectos (departamentos, casas, lotes, locales…),
-- las mantiene al día (disponible, reservada, vendida, no disponible) y puede mostrarlas en vivo
-- en su web con embed/inventario.js.
--   · Todo el equipo ve el inventario (los agentes necesitan precios y disponibilidad).
--   · Propietario y administrador crean, editan, importan (Excel/CSV) y eliminan.
--   · Los agentes solo reservan o liberan (disponible ↔ reservada); vender o bloquear es de un administrador.
--   · Las tablas no se escriben directo desde la API: todo pasa por funciones que validan los datos.
--   · Cada cambio de estado o de precio queda en el historial, con quién, cuándo y para qué lead.
--   · Reservar o vender para un lead mueve su etapa a «reserva» o «vendido» y toma el precio como valor.
-- ============================================================================

-- Cada proyecto decide si su web muestra precios.
alter table public.crm_proyectos add column if not exists precios_publicos boolean not null default true;

create table if not exists public.crm_unidades (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  proyecto text not null,
  codigo text not null check (char_length(codigo) between 1 and 40),
  tipo text not null default 'departamento'
    check (tipo in ('departamento', 'suite', 'loft', 'casa', 'lote', 'local', 'oficina', 'parqueo', 'bodega', 'otro')),
  bloque text check (bloque is null or char_length(bloque) <= 40),          -- torre, etapa, manzana…
  piso text check (piso is null or char_length(piso) <= 10),
  area_m2 numeric(10, 2) check (area_m2 is null or area_m2 between 0 and 100000),
  dormitorios smallint check (dormitorios is null or dormitorios between 0 and 20),
  banos numeric(3, 1) check (banos is null or banos between 0 and 20),
  parqueos smallint check (parqueos is null or parqueos between 0 and 20),
  bodegas smallint check (bodegas is null or bodegas between 0 and 20),
  precio numeric(14, 2) check (precio is null or precio between 0 and 1000000000000),
  estado text not null default 'disponible' check (estado in ('disponible', 'reservada', 'vendida', 'no_disponible')),
  descripcion text check (descripcion is null or char_length(descripcion) <= 500),
  publica boolean not null default true,                                      -- ¿se muestra en la web de la empresa?
  estado_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, proyecto) references public.crm_proyectos (org_id, slug) on update cascade on delete restrict
);
create unique index if not exists crm_unidades_codigo_ux on public.crm_unidades (org_id, proyecto, lower(codigo));
create index if not exists crm_unidades_estado_ix on public.crm_unidades (org_id, proyecto, estado);
alter table public.crm_unidades enable row level security;

create table if not exists public.crm_unidades_historial (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  unidad_id uuid not null references public.crm_unidades(id) on delete cascade,
  estado_antes text,
  estado_despues text,
  precio_antes numeric(14, 2),
  precio_despues numeric(14, 2),
  oportunidad_id uuid references public.crm_oportunidades(id) on delete set null,
  por text,
  nota text,
  created_at timestamptz not null default now()
);
create index if not exists crm_unidades_hist_ix on public.crm_unidades_historial (unidad_id, created_at desc);
alter table public.crm_unidades_historial enable row level security;

drop trigger if exists crm_unidades_updated_at on public.crm_unidades;
create trigger crm_unidades_updated_at before update on public.crm_unidades
  for each row execute function public.set_updated_at();

-- La empresa de una unidad no cambia nunca; la hora del estado se mueve solo cuando cambia el estado.
create or replace function public.crm_unidad_antes()
returns trigger language plpgsql set search_path = public as $$
begin
  new.codigo := btrim(new.codigo);
  if tg_op = 'UPDATE' then
    new.org_id := old.org_id;
    if new.estado is distinct from old.estado then new.estado_at := now(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_unidad_antes on public.crm_unidades;
create trigger crm_unidad_antes before insert or update on public.crm_unidades
  for each row execute function public.crm_unidad_antes();

-- Historial: alta, cambios de estado y cambios de precio. El lead y la nota los deja cambiar_estado_unidad().
create or replace function public.crm_unidad_despues()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_op uuid := nullif(current_setting('crm.op', true), '')::uuid;
  v_nota text := nullif(current_setting('crm.nota', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.crm_unidades_historial (org_id, unidad_id, estado_despues, precio_despues, por, nota)
    values (new.org_id, new.id, new.estado, new.precio, coalesce(nullif(public.mi_email(), ''), 'sistema'), 'Unidad creada');
  elsif new.estado is distinct from old.estado or new.precio is distinct from old.precio then
    insert into public.crm_unidades_historial (org_id, unidad_id, estado_antes, estado_despues, precio_antes, precio_despues, oportunidad_id, por, nota)
    values (new.org_id, new.id, old.estado, new.estado, old.precio, new.precio, v_op, coalesce(nullif(public.mi_email(), ''), 'sistema'), v_nota);
  end if;
  return new;
end;
$$;
drop trigger if exists crm_unidad_despues on public.crm_unidades;
create trigger crm_unidad_despues after insert or update on public.crm_unidades
  for each row execute function public.crm_unidad_despues();
revoke execute on function public.crm_unidad_antes(), public.crm_unidad_despues() from public, anon, authenticated;

-- ------------------------------------------------------------------ permisos ---
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('crm_unidades', 'crm_unidades_historial')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
create policy "unidades: las ve el equipo" on public.crm_unidades
  for select to authenticated using (public.es_miembro(org_id));
create policy "historial de unidades: lo ve el equipo" on public.crm_unidades_historial
  for select to authenticated using (public.es_miembro(org_id));
revoke all on public.crm_unidades, public.crm_unidades_historial from anon;
revoke insert, update, delete, truncate on public.crm_unidades, public.crm_unidades_historial from authenticated;

-- ---------------------------------------------------------------- validación ---
-- Limpia y valida una fila. Devuelve {"datos": {...}} o {"error": "..."}. Solo trae las claves que venían en la fila.
create or replace function public.unidad_validar(p_org uuid, p jsonb)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_proy text := nullif(lower(btrim(coalesce(p ->> 'proyecto', ''))), '');
  v_cod text := nullif(btrim(coalesce(p ->> 'codigo', '')), '');
  v_tipo text; v_estado text; v_txt text;
  k text; v numeric; v_max numeric;
  etiqueta text;
  datos jsonb := '{}'::jsonb;
begin
  if v_proy is null or not exists (select 1 from public.crm_proyectos where org_id = p_org and slug = v_proy) then
    return jsonb_build_object('error', 'El proyecto «' || coalesce(p ->> 'proyecto', '') || '» no existe');
  end if;
  if v_cod is null or char_length(v_cod) > 40 then
    return jsonb_build_object('error', 'El código de la unidad es obligatorio (hasta 40 caracteres)');
  end if;
  datos := jsonb_build_object('proyecto', v_proy, 'codigo', v_cod);

  if p ? 'tipo' then
    v_tipo := coalesce(nullif(lower(btrim(p ->> 'tipo')), ''), 'departamento');
    if v_tipo not in ('departamento', 'suite', 'loft', 'casa', 'lote', 'local', 'oficina', 'parqueo', 'bodega', 'otro') then
      return jsonb_build_object('error', 'Tipo no válido: «' || v_tipo || '»');
    end if;
    datos := datos || jsonb_build_object('tipo', v_tipo);
  end if;
  if p ? 'estado' then
    v_estado := coalesce(nullif(replace(lower(btrim(p ->> 'estado')), ' ', '_'), ''), 'disponible');
    if v_estado not in ('disponible', 'reservada', 'vendida', 'no_disponible') then
      return jsonb_build_object('error', 'Estado no válido: «' || v_estado || '»');
    end if;
    datos := datos || jsonb_build_object('estado', v_estado);
  end if;
  foreach k in array array['bloque', 'piso', 'descripcion'] loop
    if p ? k then
      v_txt := nullif(btrim(coalesce(p ->> k, '')), '');
      v_max := case k when 'bloque' then 40 when 'piso' then 10 else 500 end;
      if v_txt is not null and char_length(v_txt) > v_max then
        return jsonb_build_object('error', 'El campo «' || k || '» es demasiado largo');
      end if;
      datos := datos || jsonb_build_object(k, v_txt);
    end if;
  end loop;
  foreach k in array array['area_m2', 'dormitorios', 'banos', 'parqueos', 'bodegas', 'precio'] loop
    if p ? k then
      etiqueta := case k when 'area_m2' then 'El área' when 'dormitorios' then 'Los dormitorios' when 'banos' then 'Los baños'
                         when 'parqueos' then 'Los parqueos' when 'bodegas' then 'Las bodegas' else 'El precio' end;
      begin
        v := nullif(btrim(coalesce(p ->> k, '')), '')::numeric;
      exception when others then
        return jsonb_build_object('error', etiqueta || ' no es un número');
      end;
      if v is not null then
        v_max := case k when 'precio' then 1000000000000 when 'area_m2' then 100000 else 20 end;
        if v < 0 or v > v_max then
          return jsonb_build_object('error', etiqueta || ' está fuera del rango permitido');
        end if;
        if k in ('dormitorios', 'parqueos', 'bodegas') and v <> trunc(v) then
          return jsonb_build_object('error', etiqueta || ' debe ser un número entero');
        end if;
        if k = 'banos' and v * 2 <> trunc(v * 2) then
          return jsonb_build_object('error', 'Los baños van de medio en medio (1, 1,5, 2…)');
        end if;
      end if;
      datos := datos || jsonb_build_object(k, v);
    end if;
  end loop;
  if p ? 'publica' then
    datos := datos || jsonb_build_object('publica', coalesce((p ->> 'publica')::boolean, true));
  end if;
  return jsonb_build_object('datos', datos);
end;
$$;
revoke execute on function public.unidad_validar(uuid, jsonb) from public, anon, authenticated;

create or replace function public.unidad_puede_gestionar(p_org uuid)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_rol_org(p_org, array['propietario', 'administrador']) then
    raise exception 'Solo el propietario o un administrador gestiona el inventario';
  end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa. Renuévala para cambiar el inventario.'; end if;
end;
$$;
revoke execute on function public.unidad_puede_gestionar(uuid) from public, anon, authenticated;

-- ------------------------------------------------------ crear / editar / eliminar ---
create or replace function public.guardar_unidad(p_org uuid, p_id uuid, p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb; d jsonb; u public.crm_unidades%rowtype;
begin
  perform public.unidad_puede_gestionar(p_org);
  v := public.unidad_validar(p_org, coalesce(p_datos, '{}'::jsonb));
  if v ? 'error' then raise exception '%', v ->> 'error'; end if;
  d := v -> 'datos';
  begin
    if p_id is null then
      insert into public.crm_unidades (org_id, proyecto, codigo, tipo, bloque, piso, area_m2, dormitorios, banos, parqueos, bodegas, precio, estado, descripcion, publica)
      values (p_org, d ->> 'proyecto', d ->> 'codigo', coalesce(d ->> 'tipo', 'departamento'), d ->> 'bloque', d ->> 'piso',
              (d ->> 'area_m2')::numeric, (d ->> 'dormitorios')::smallint, (d ->> 'banos')::numeric, (d ->> 'parqueos')::smallint,
              (d ->> 'bodegas')::smallint, (d ->> 'precio')::numeric, coalesce(d ->> 'estado', 'disponible'), d ->> 'descripcion',
              coalesce((d ->> 'publica')::boolean, true))
      returning * into u;
    else
      update public.crm_unidades set
        proyecto = d ->> 'proyecto', codigo = d ->> 'codigo',
        tipo = case when d ? 'tipo' then d ->> 'tipo' else tipo end,
        bloque = case when d ? 'bloque' then d ->> 'bloque' else bloque end,
        piso = case when d ? 'piso' then d ->> 'piso' else piso end,
        area_m2 = case when d ? 'area_m2' then (d ->> 'area_m2')::numeric else area_m2 end,
        dormitorios = case when d ? 'dormitorios' then (d ->> 'dormitorios')::smallint else dormitorios end,
        banos = case when d ? 'banos' then (d ->> 'banos')::numeric else banos end,
        parqueos = case when d ? 'parqueos' then (d ->> 'parqueos')::smallint else parqueos end,
        bodegas = case when d ? 'bodegas' then (d ->> 'bodegas')::smallint else bodegas end,
        precio = case when d ? 'precio' then (d ->> 'precio')::numeric else precio end,
        estado = case when d ? 'estado' then d ->> 'estado' else estado end,
        descripcion = case when d ? 'descripcion' then d ->> 'descripcion' else descripcion end,
        publica = case when d ? 'publica' then (d ->> 'publica')::boolean else publica end
      where id = p_id and org_id = p_org
      returning * into u;
      if not found then raise exception 'No se encontró la unidad'; end if;
    end if;
  exception when unique_violation then
    raise exception 'Ya existe una unidad con el código «%» en ese proyecto', d ->> 'codigo';
  end;
  return to_jsonb(u);
end;
$$;

create or replace function public.eliminar_unidad(p_unidad uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare u public.crm_unidades%rowtype;
begin
  select * into u from public.crm_unidades where id = p_unidad;
  if not found then raise exception 'No se encontró la unidad'; end if;
  perform public.unidad_puede_gestionar(u.org_id);
  if u.estado in ('reservada', 'vendida') then
    raise exception 'Una unidad % no se elimina. Si ya no se ofrece, márcala como no disponible.', case u.estado when 'vendida' then 'vendida' else 'reservada' end;
  end if;
  delete from public.crm_unidades where id = p_unidad;
end;
$$;

-- ------------------------------------------------------------ importar (Excel / CSV) ---
-- Recibe las filas ya leídas por la app. Valida TODO antes de escribir: si hay errores no se guarda nada.
-- Una unidad que ya existe (mismo proyecto y código) se actualiza; solo se tocan las columnas que vienen en el archivo.
-- El estado de las que ya existen solo cambia si se pide expresamente.
create or replace function public.importar_unidades(p_org uuid, p_filas jsonb, p_actualizar_estado boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e jsonb; v jsonb; d jsonb; ord integer := 0; fila integer;
  errores jsonb := '[]'::jsonb; n_err integer := 0;
  vistos text[] := '{}'; clave text;
  n_creadas integer := 0; n_actualizadas integer := 0; creada boolean;
begin
  perform public.unidad_puede_gestionar(p_org);
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'El archivo no tiene filas para importar'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Máximo 2.000 filas por archivo. Divide el archivo y vuelve a intentar.'; end if;

  for e in select value from jsonb_array_elements(p_filas) loop
    ord := ord + 1;
    fila := coalesce((e ->> 'fila')::integer, ord);
    v := public.unidad_validar(p_org, e);
    if v ? 'error' then
      n_err := n_err + 1;
      if n_err <= 50 then errores := errores || jsonb_build_object('fila', fila, 'error', v ->> 'error'); end if;
      continue;
    end if;
    clave := (v -> 'datos' ->> 'proyecto') || '|' || lower(v -> 'datos' ->> 'codigo');
    if clave = any(vistos) then
      n_err := n_err + 1;
      if n_err <= 50 then errores := errores || jsonb_build_object('fila', fila, 'error', 'El código «' || (v -> 'datos' ->> 'codigo') || '» está repetido en el archivo'); end if;
    end if;
    vistos := vistos || clave;
  end loop;
  if n_err > 0 then
    return jsonb_build_object('ok', false, 'errores', errores, 'total_errores', n_err);
  end if;

  for e in select value from jsonb_array_elements(p_filas) loop
    d := (public.unidad_validar(p_org, e)) -> 'datos';
    insert into public.crm_unidades as t (org_id, proyecto, codigo, tipo, bloque, piso, area_m2, dormitorios, banos, parqueos, bodegas, precio, estado, descripcion, publica)
    values (p_org, d ->> 'proyecto', d ->> 'codigo', coalesce(d ->> 'tipo', 'departamento'), d ->> 'bloque', d ->> 'piso',
            (d ->> 'area_m2')::numeric, (d ->> 'dormitorios')::smallint, (d ->> 'banos')::numeric, (d ->> 'parqueos')::smallint,
            (d ->> 'bodegas')::smallint, (d ->> 'precio')::numeric, coalesce(d ->> 'estado', 'disponible'), d ->> 'descripcion',
            coalesce((d ->> 'publica')::boolean, true))
    on conflict (org_id, proyecto, lower(codigo)) do update set
      tipo = case when d ? 'tipo' then d ->> 'tipo' else t.tipo end,
      bloque = case when d ? 'bloque' then d ->> 'bloque' else t.bloque end,
      piso = case when d ? 'piso' then d ->> 'piso' else t.piso end,
      area_m2 = case when d ? 'area_m2' then (d ->> 'area_m2')::numeric else t.area_m2 end,
      dormitorios = case when d ? 'dormitorios' then (d ->> 'dormitorios')::smallint else t.dormitorios end,
      banos = case when d ? 'banos' then (d ->> 'banos')::numeric else t.banos end,
      parqueos = case when d ? 'parqueos' then (d ->> 'parqueos')::smallint else t.parqueos end,
      bodegas = case when d ? 'bodegas' then (d ->> 'bodegas')::smallint else t.bodegas end,
      precio = case when d ? 'precio' then (d ->> 'precio')::numeric else t.precio end,
      estado = case when p_actualizar_estado and d ? 'estado' then d ->> 'estado' else t.estado end,
      descripcion = case when d ? 'descripcion' then d ->> 'descripcion' else t.descripcion end,
      publica = case when d ? 'publica' then (d ->> 'publica')::boolean else t.publica end
    returning (xmax = 0) into creada;
    if creada then n_creadas := n_creadas + 1; else n_actualizadas := n_actualizadas + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'creadas', n_creadas, 'actualizadas', n_actualizadas);
end;
$$;

-- ---------------------------------------------------------- reservar / vender / liberar ---
create or replace function public.cambiar_estado_unidad(p_unidad uuid, p_estado text, p_oportunidad uuid default null, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u public.crm_unidades%rowtype; o public.crm_oportunidades%rowtype;
  v_rol text; v_estado text := replace(lower(btrim(coalesce(p_estado, ''))), ' ', '_');
begin
  select * into u from public.crm_unidades where id = p_unidad for update;
  if not found then raise exception 'No se encontró la unidad'; end if;
  v_rol := public.rol_en(u.org_id);
  if v_rol is null or v_rol = 'lector' then raise exception 'Tu rol no permite cambiar el estado de las unidades'; end if;
  if not public.org_activa(u.org_id) then raise exception 'Tu suscripción no está activa. Renuévala para cambiar el inventario.'; end if;
  if v_estado not in ('disponible', 'reservada', 'vendida', 'no_disponible') then raise exception 'Estado no válido'; end if;
  if v_estado = u.estado then raise exception 'La unidad ya está %', replace(u.estado, '_', ' '); end if;
  if v_rol = 'agente' and (v_estado not in ('disponible', 'reservada') or u.estado not in ('disponible', 'reservada')) then
    raise exception 'Solo un administrador puede marcar una unidad como vendida o no disponible, o reabrir una vendida';
  end if;
  if p_oportunidad is not null then
    select * into o from public.crm_oportunidades where id = p_oportunidad and org_id = u.org_id;
    if not found or not public.crm_puede_gestionar_op(p_oportunidad) then raise exception 'No puedes asociar esa unidad a ese lead'; end if;
  end if;

  perform set_config('crm.op', coalesce(p_oportunidad::text, ''), true);
  perform set_config('crm.nota', left(btrim(coalesce(p_nota, '')), 300), true);
  update public.crm_unidades set estado = v_estado where id = u.id returning * into u;
  perform set_config('crm.op', '', true); perform set_config('crm.nota', '', true);

  if p_oportunidad is not null and v_estado in ('reservada', 'vendida') then
    update public.crm_oportunidades set
      unidad_interes = u.codigo,
      proyecto = coalesce(proyecto, u.proyecto),
      valor_estimado = coalesce(u.precio, valor_estimado),
      etapa = case when v_estado = 'vendida' then 'vendido'
                   when etapa in ('nuevo', 'contactado', 'cita', 'proforma') then 'reserva' else etapa end
    where id = p_oportunidad;
  end if;
  return to_jsonb(u);
end;
$$;

-- ------------------------------------------------------ disponibilidad en la web del cliente ---
-- La web de cada inmobiliaria (embed/inventario.js) lee SOLO esto, con la clave pública de su empresa.
-- Devuelve unidades marcadas como públicas y no bloqueadas de proyectos activos, sin datos internos;
-- el precio solo si el proyecto lo permite.
create or replace function public.inventario_publico(p_clave text, p_proyecto text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_proy text := nullif(lower(btrim(coalesce(p_proyecto, ''))), '');
begin
  select id into v_org from public.organizaciones where clave_publica = p_clave and estado <> 'cancelada';
  if v_org is null then raise exception 'Clave no válida'; end if;
  return jsonb_build_object('unidades', coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object(
               'proyecto', u.proyecto, 'proyecto_nombre', p.nombre, 'codigo', u.codigo, 'tipo', u.tipo, 'bloque', u.bloque, 'piso', u.piso,
               'area_m2', u.area_m2, 'dormitorios', u.dormitorios, 'banos', u.banos, 'parqueos', u.parqueos, 'bodegas', u.bodegas,
               'precio', case when p.precios_publicos then u.precio end, 'estado', u.estado, 'descripcion', u.descripcion) as x
        from public.crm_unidades u join public.crm_proyectos p on p.org_id = u.org_id and p.slug = u.proyecto
       where u.org_id = v_org and u.publica and u.estado <> 'no_disponible' and p.activo and (v_proy is null or u.proyecto = v_proy)
       order by p.nombre, u.bloque nulls first, u.piso nulls first, u.codigo limit 2000) s), '[]'::jsonb));
end;
$$;

-- ------------------------------------------------------------ permisos de las funciones ---
revoke execute on function public.guardar_unidad(uuid, uuid, jsonb), public.eliminar_unidad(uuid),
  public.importar_unidades(uuid, jsonb, boolean), public.cambiar_estado_unidad(uuid, text, uuid, text),
  public.inventario_publico(text, text) from public, anon;
grant execute on function public.guardar_unidad(uuid, uuid, jsonb), public.eliminar_unidad(uuid),
  public.importar_unidades(uuid, jsonb, boolean), public.cambiar_estado_unidad(uuid, text, uuid, text) to authenticated;
grant execute on function public.inventario_publico(text, text) to anon, authenticated;

-- Tiempo real: el inventario se actualiza en las pantallas de todo el equipo.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_unidades') then
    alter publication supabase_realtime add table public.crm_unidades;
  end if;
end $$;
