-- ============================================================================
-- GPUnlock CRM · 08 · Cotizador (proformas) y fotos de las unidades
-- Ejecutar después de 07_inventario.sql. Seguro de repetir.
--
--   · Cada proyecto tiene su configuración: entrada, reserva, cuotas, tasa y plazo del crédito,
--     descuento máximo para agentes, vigencia, condiciones y prefijo del número (ej. TA-0007).
--   · crear_cotizacion() hace TODO el cálculo en el servidor (la app solo muestra la vista previa):
--     una o varias unidades disponibles, para un lead existente o para un cliente nuevo (que se crea
--     como lead al vuelo, sin duplicar si ya existe por teléfono o correo).
--   · Al emitirla, el lead pasa a «proforma», toma el precio final como valor y queda en su línea de tiempo.
--   · Cada proforma tiene un enlace privado (token largo) para que el cliente la vea e imprima o guarde
--     en PDF: cotizacion_publica() devuelve solo lo necesario, sin teléfono ni correo del cliente.
--   · Fotos de las unidades en el bucket público «inventario» (<org>/<unidad>/<archivo>), hasta 8 por unidad.
-- ============================================================================

-- ------------------------------------------------------------ fotos de las unidades ---
alter table public.crm_unidades add column if not exists fotos text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventario', 'inventario', true, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = true;

-- <org_id>/<unidad_id>/<nombre>.<png|jpg|jpeg|webp>; escribe el propietario o el administrador de esa empresa.
create or replace function public.puede_escribir_inventario(p_nombre text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_uni uuid;
begin
  if coalesce(p_nombre, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$' then
    return false;
  end if;
  v_org := split_part(p_nombre, '/', 1)::uuid; v_uni := split_part(p_nombre, '/', 2)::uuid;
  return public.tiene_rol_org(v_org, array['propietario', 'administrador']) and public.org_activa(v_org)
     and exists (select 1 from public.crm_unidades where id = v_uni and org_id = v_org);
end;
$$;
revoke execute on function public.puede_escribir_inventario(text) from public, anon;
grant execute on function public.puede_escribir_inventario(text) to authenticated;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'inventario:%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;
create policy "inventario: sube su equipo gestor" on storage.objects
  for insert to authenticated with check (bucket_id = 'inventario' and public.puede_escribir_inventario(name));
create policy "inventario: borra su equipo gestor" on storage.objects
  for delete to authenticated using (bucket_id = 'inventario' and public.puede_escribir_inventario(name));
create policy "inventario: lee su equipo gestor" on storage.objects
  for select to authenticated using (bucket_id = 'inventario' and public.puede_escribir_inventario(name));

-- Guarda la lista (y el orden) de fotos de una unidad. Cada foto debe estar subida a su carpeta.
create or replace function public.guardar_fotos_unidad(p_unidad uuid, p_fotos text[])
returns text[]
language plpgsql security definer set search_path = public as $$
declare u public.crm_unidades%rowtype; f text; v text[] := '{}';
begin
  select * into u from public.crm_unidades where id = p_unidad;
  if not found then raise exception 'No se encontró la unidad'; end if;
  perform public.unidad_puede_gestionar(u.org_id);
  if coalesce(array_length(p_fotos, 1), 0) > 8 then raise exception 'Máximo 8 fotos por unidad'; end if;
  foreach f in array coalesce(p_fotos, '{}') loop
    if f is null or split_part(f, '/', 1) <> u.org_id::text or split_part(f, '/', 2) <> u.id::text
       or f !~* '^[^/]+/[^/]+/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$' then
      raise exception 'Foto no válida';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'inventario' and name = f) then
      raise exception 'No encontramos una de las fotos subidas. Inténtalo de nuevo.';
    end if;
    if not f = any(v) then v := v || f; end if;
  end loop;
  update public.crm_unidades set fotos = v where id = u.id;
  return v;
end;
$$;

-- La web pública también recibe las fotos (rutas dentro del bucket público «inventario»).
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
               'precio', case when p.precios_publicos then u.precio end, 'estado', u.estado, 'descripcion', u.descripcion,
               'fotos', to_jsonb(u.fotos)) as x
        from public.crm_unidades u join public.crm_proyectos p on p.org_id = u.org_id and p.slug = u.proyecto
       where u.org_id = v_org and u.publica and u.estado <> 'no_disponible' and p.activo and (v_proy is null or u.proyecto = v_proy)
       order by p.nombre, u.bloque nulls first, u.piso nulls first, u.codigo limit 2000) s), '[]'::jsonb));
end;
$$;
revoke execute on function public.inventario_publico(text, text) from public;
grant execute on function public.inventario_publico(text, text) to anon, authenticated;

-- ------------------------------------------------------- configuración por proyecto ---
create table if not exists public.crm_cotizador_config (
  org_id uuid not null,
  proyecto text not null,
  prefijo text not null check (prefijo ~ '^[A-Z0-9]{1,6}$'),
  entrada_pct numeric(5, 2) not null default 30 check (entrada_pct between 0 and 100),
  reserva_tipo text not null default 'porcentaje' check (reserva_tipo in ('porcentaje', 'monto')),
  reserva_valor numeric(14, 2) not null default 2 check (reserva_valor >= 0),
  cuotas_entrada integer not null default 12 check (cuotas_entrada between 0 and 120),
  tasa_anual numeric(5, 2) not null default 9.5 check (tasa_anual between 0 and 30),
  plazo_anios integer not null default 20 check (plazo_anios between 1 and 30),
  descuento_max_pct numeric(5, 2) not null default 5 check (descuento_max_pct between 0 and 100),
  vigencia_dias integer not null default 15 check (vigencia_dias between 1 and 90),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{9,15}$'),
  condiciones text check (condiciones is null or char_length(condiciones) <= 1500),
  ultimo_numero integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, proyecto),
  foreign key (org_id, proyecto) references public.crm_proyectos (org_id, slug) on update cascade on delete cascade
);
alter table public.crm_cotizador_config enable row level security;

create table if not exists public.crm_cotizaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  numero text not null,
  proyecto text not null,
  oportunidad_id uuid not null references public.crm_oportunidades(id) on delete cascade,
  contacto_id uuid references public.crm_contactos(id) on delete set null,
  cliente_nombre text not null,
  cliente_telefono text,
  cliente_correo text,
  cliente_identificacion text,
  unidades jsonb not null,
  precio_lista numeric(14, 2) not null,
  descuento numeric(14, 2) not null default 0,
  precio_final numeric(14, 2) not null,
  forma_pago text not null check (forma_pago in ('credito', 'contado')),
  entrada_pct numeric(5, 2) not null,
  entrada numeric(14, 2) not null,
  reserva numeric(14, 2) not null,
  cuotas_entrada integer not null,
  cuota_entrada numeric(14, 2) not null,
  saldo numeric(14, 2) not null,
  tasa_anual numeric(5, 2),
  plazo_anios integer,
  cuota_mensual numeric(14, 2),
  vigencia_hasta date not null,
  notas text check (notas is null or char_length(notas) <= 1000),
  condiciones text,
  asesor_email text,
  asesor_nombre text,
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  estado text not null default 'emitida' check (estado in ('emitida', 'anulada')),
  anulada_motivo text,
  created_at timestamptz not null default now(),
  unique (org_id, numero)
);
create index if not exists crm_cotizaciones_op_ix on public.crm_cotizaciones (oportunidad_id, created_at desc);
create index if not exists crm_cotizaciones_org_ix on public.crm_cotizaciones (org_id, created_at desc);
alter table public.crm_cotizaciones enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('crm_cotizador_config', 'crm_cotizaciones')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
create policy "config del cotizador: la ve el equipo" on public.crm_cotizador_config
  for select to authenticated using (public.es_miembro(org_id));
-- Una proforma la ve quien puede ver su lead (los agentes, las de sus leads).
create policy "proformas: las ve quien ve el lead" on public.crm_cotizaciones
  for select to authenticated using (public.crm_puede_ver_op(oportunidad_id));
revoke all on public.crm_cotizador_config, public.crm_cotizaciones from anon;
revoke insert, update, delete, truncate on public.crm_cotizador_config, public.crm_cotizaciones from authenticated;

-- Configuración (o los valores por defecto si el proyecto aún no la tiene).
create or replace function public.cotizador_config_de(p_org uuid, p_proyecto text)
returns public.crm_cotizador_config
language plpgsql security definer set search_path = public as $$
declare c public.crm_cotizador_config%rowtype; v_pref text;
begin
  select * into c from public.crm_cotizador_config where org_id = p_org and proyecto = p_proyecto;
  if found then return c; end if;
  v_pref := left(upper(regexp_replace(p_proyecto, '[^a-z0-9]', '', 'g')), 4);
  if v_pref = '' then v_pref := 'PF'; end if;
  insert into public.crm_cotizador_config (org_id, proyecto, prefijo) values (p_org, p_proyecto, v_pref)
  on conflict (org_id, proyecto) do nothing;
  select * into c from public.crm_cotizador_config where org_id = p_org and proyecto = p_proyecto;
  return c;
end;
$$;
revoke execute on function public.cotizador_config_de(uuid, text) from public, anon, authenticated;

create or replace function public.guardar_config_cotizador(p_org uuid, p_proyecto text, p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.crm_cotizador_config%rowtype; d jsonb := coalesce(p_datos, '{}'::jsonb); v_wa text;
begin
  if not public.tiene_rol_org(p_org, array['propietario', 'administrador']) then
    raise exception 'Solo el propietario o un administrador configura el cotizador';
  end if;
  perform public.unidad_puede_gestionar(p_org);
  if not exists (select 1 from public.crm_proyectos where org_id = p_org and slug = p_proyecto) then raise exception 'El proyecto no existe'; end if;
  c := public.cotizador_config_de(p_org, p_proyecto);
  v_wa := nullif(regexp_replace(coalesce(d ->> 'whatsapp', c.whatsapp, ''), '\D', '', 'g'), '');
  begin
    update public.crm_cotizador_config set
      prefijo = coalesce(upper(nullif(btrim(d ->> 'prefijo'), '')), prefijo),
      entrada_pct = coalesce((d ->> 'entrada_pct')::numeric, entrada_pct),
      reserva_tipo = coalesce(d ->> 'reserva_tipo', reserva_tipo),
      reserva_valor = coalesce((d ->> 'reserva_valor')::numeric, reserva_valor),
      cuotas_entrada = coalesce((d ->> 'cuotas_entrada')::integer, cuotas_entrada),
      tasa_anual = coalesce((d ->> 'tasa_anual')::numeric, tasa_anual),
      plazo_anios = coalesce((d ->> 'plazo_anios')::integer, plazo_anios),
      descuento_max_pct = coalesce((d ->> 'descuento_max_pct')::numeric, descuento_max_pct),
      vigencia_dias = coalesce((d ->> 'vigencia_dias')::integer, vigencia_dias),
      whatsapp = case when d ? 'whatsapp' then v_wa else whatsapp end,
      condiciones = case when d ? 'condiciones' then nullif(btrim(d ->> 'condiciones'), '') else condiciones end,
      updated_at = now()
    where org_id = p_org and proyecto = p_proyecto
    returning * into c;
  exception
    when check_violation then raise exception 'Revisa los valores: alguno está fuera del rango permitido';
    when invalid_text_representation then raise exception 'Revisa los valores: alguno no es un número';
  end;
  return to_jsonb(c);
end;
$$;

-- ---------------------------------------------------------------------------- cálculo ---
-- Dinero como se escribe en Ecuador: $118.000,50 (sin depender del idioma del servidor).
create or replace function public.crm_dinero(p numeric)
returns text language sql immutable set search_path = public as $$
  select case when p is null then '' else
    '$' || translate(to_char(round(p, 2), 'FM999,999,999,990.00'), ',.', '.,') end
$$;

-- La misma cuenta que hace la app (web/app/js/cotizar.js) para la vista previa.
create or replace function public.cotizacion_calcular(
  p_precio_lista numeric, p_descuento numeric, p_forma text, p_entrada_pct numeric, p_reserva numeric,
  p_cuotas integer, p_tasa numeric, p_plazo integer
) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_final numeric := round(p_precio_lista - coalesce(p_descuento, 0), 2);
  v_reserva numeric := round(least(greatest(coalesce(p_reserva, 0), 0), v_final), 2);
  v_entrada numeric := greatest(round(v_final * p_entrada_pct / 100, 2), v_reserva);
  v_cuota_ent numeric := case when p_cuotas > 0 then round((v_entrada - v_reserva) / p_cuotas, 2) else 0 end;
  v_saldo numeric := round(v_final - v_entrada, 2);
  r numeric := p_tasa / 1200; n integer := p_plazo * 12; v_cuota numeric := 0;
begin
  if p_forma = 'credito' and v_saldo > 0 then
    v_cuota := case when r = 0 then round(v_saldo / n, 2) else round(v_saldo * r / (1 - power(1 + r, -n)), 2) end;
  end if;
  return jsonb_build_object('precio_final', v_final, 'reserva', v_reserva, 'entrada', v_entrada, 'cuota_entrada', v_cuota_ent,
    'saldo', v_saldo, 'cuota_mensual', case when p_forma = 'credito' then v_cuota end);
end;
$$;
revoke execute on function public.cotizacion_calcular(numeric, numeric, text, numeric, numeric, integer, numeric, integer) from public, anon;
grant execute on function public.cotizacion_calcular(numeric, numeric, text, numeric, numeric, integer, numeric, integer) to authenticated;

-- ------------------------------------------------------------------- emitir una proforma ---
create or replace function public.crear_cotizacion(p_org uuid, p_datos jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d jsonb := coalesce(p_datos, '{}'::jsonb);
  v_rol text := public.rol_en(p_org);
  v_yo text := public.mi_email();
  v_proy text := nullif(lower(btrim(coalesce(d ->> 'proyecto', ''))), '');
  c public.crm_cotizador_config%rowtype;
  v_ids uuid[]; v_units jsonb; v_lista numeric; v_n integer; v_codigos text; v_malas text;
  v_op uuid; o public.crm_oportunidades%rowtype; k public.crm_contactos%rowtype;
  v_cli jsonb := coalesce(d -> 'cliente', '{}'::jsonb);
  v_ident text := nullif(btrim(coalesce(v_cli ->> 'identificacion', '')), '');
  v_desc numeric; v_forma text; v_ent_pct numeric; v_reserva numeric; v_cuotas integer; v_tasa numeric; v_plazo integer;
  calc jsonb; v_num integer; v_numero text; v_nombre_asesor text; q public.crm_cotizaciones%rowtype;
begin
  if v_rol is null or v_rol = 'lector' then raise exception 'Tu rol no permite hacer proformas'; end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa. Renuévala para hacer proformas.'; end if;
  if v_proy is null or not exists (select 1 from public.crm_proyectos where org_id = p_org and slug = v_proy) then raise exception 'Elige un proyecto'; end if;
  c := public.cotizador_config_de(p_org, v_proy);

  -- Unidades: 1 a 10, del proyecto, disponibles y con precio.
  begin
    select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(coalesce(d -> 'unidades', '[]'::jsonb)) x;
  exception when others then raise exception 'Unidades no válidas';
  end;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'Elige al menos una unidad'; end if;
  if v_n > 10 then raise exception 'Máximo 10 unidades por proforma'; end if;
  if (select count(*) from public.crm_unidades where id = any(v_ids) and org_id = p_org and proyecto = v_proy) <> v_n then
    raise exception 'Alguna unidad no es de este proyecto';
  end if;
  select string_agg(codigo, ', ' order by codigo) into v_malas from public.crm_unidades where id = any(v_ids) and estado <> 'disponible';
  if v_malas is not null then raise exception 'Ya no está disponible: %', v_malas; end if;
  select string_agg(codigo, ', ' order by codigo) into v_malas from public.crm_unidades where id = any(v_ids) and precio is null;
  if v_malas is not null then raise exception 'Sin precio en el inventario: %', v_malas; end if;
  select sum(precio), string_agg(codigo, ', ' order by codigo),
         jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'tipo', tipo, 'bloque', bloque, 'piso', piso, 'area_m2', area_m2,
                   'dormitorios', dormitorios, 'banos', banos, 'parqueos', parqueos, 'bodegas', bodegas, 'precio', precio,
                   'foto', fotos[1]) order by precio desc, codigo)
    into v_lista, v_codigos, v_units
    from public.crm_unidades where id = any(v_ids);

  -- Cliente: un lead que ya existe o uno nuevo (que se crea como lead, sin duplicar).
  v_op := nullif(d ->> 'oportunidad_id', '')::uuid;
  if v_op is null then
    if char_length(btrim(coalesce(v_cli ->> 'nombre', ''))) not between 2 and 120 then raise exception 'Escribe el nombre del cliente'; end if;
    if char_length(public.crm_normalizar_telefono(v_cli ->> 'telefono')) not between 9 and 15 then raise exception 'Escribe un teléfono válido del cliente'; end if;
    v_op := (public.crm_crear_lead(p_org, v_cli ->> 'nombre', v_cli ->> 'telefono', nullif(btrim(coalesce(v_cli ->> 'correo', '')), ''),
              v_proy, v_codigos, 'Cliente registrado al hacer una proforma', 'oficina', null) ->> 'oportunidad_id')::uuid;
  end if;
  select * into o from public.crm_oportunidades where id = v_op and org_id = p_org;
  if not found then raise exception 'No se encontró el lead'; end if;
  if not public.crm_puede_gestionar_op(v_op) then
    if o.asignado_a is null then raise exception 'Primero toma este lead para poder hacerle una proforma'; end if;
    raise exception 'Este cliente lo atiende otro asesor';
  end if;
  select * into k from public.crm_contactos where id = o.contacto_id;

  -- Condiciones (si no vienen, las del proyecto).
  v_lista := round(v_lista, 2);
  begin
    v_desc := round(coalesce((d ->> 'descuento')::numeric, 0), 2);
    v_forma := coalesce(nullif(d ->> 'forma_pago', ''), 'credito');
    v_ent_pct := coalesce((d ->> 'entrada_pct')::numeric, c.entrada_pct);
    v_cuotas := coalesce((d ->> 'cuotas_entrada')::integer, c.cuotas_entrada);
    v_tasa := coalesce((d ->> 'tasa_anual')::numeric, c.tasa_anual);
    v_plazo := coalesce((d ->> 'plazo_anios')::integer, c.plazo_anios);
    v_reserva := (d ->> 'reserva')::numeric;
  exception when others then raise exception 'Revisa los valores de la proforma: alguno no es un número';
  end;
  if v_forma not in ('credito', 'contado') then raise exception 'Forma de pago no válida'; end if;
  if v_desc < 0 or v_desc >= v_lista then raise exception 'El descuento no es válido'; end if;
  if v_rol = 'agente' and v_desc > round(v_lista * c.descuento_max_pct / 100, 2) then
    raise exception '%', 'Tu descuento máximo en este proyecto es ' || replace(rtrim(rtrim(c.descuento_max_pct::text, '0'), '.'), '.', ',') || ' % ('
      || public.crm_dinero(round(v_lista * c.descuento_max_pct / 100, 2)) || '). Pide a un administrador uno mayor.';
  end if;
  if v_ent_pct not between 0 and 100 then raise exception 'La entrada va de 0 %% a 100 %%'; end if;
  if v_cuotas not between 0 and 120 then raise exception 'Las cuotas de la entrada van de 0 a 120'; end if;
  if v_tasa not between 0 and 30 then raise exception 'La tasa va de 0 %% a 30 %%'; end if;
  if v_plazo not between 1 and 30 then raise exception 'El plazo va de 1 a 30 años'; end if;
  if v_reserva is null then
    v_reserva := case when c.reserva_tipo = 'monto' then c.reserva_valor else round((v_lista - v_desc) * c.reserva_valor / 100, 2) end;
  end if;
  if v_reserva < 0 then raise exception 'La reserva no es válida'; end if;
  calc := public.cotizacion_calcular(v_lista, v_desc, v_forma, v_ent_pct, v_reserva, v_cuotas, v_tasa, v_plazo);

  update public.crm_cotizador_config set ultimo_numero = ultimo_numero + 1 where org_id = p_org and proyecto = v_proy returning ultimo_numero into v_num;
  v_numero := c.prefijo || '-' || lpad(v_num::text, 4, '0');
  select nombre into v_nombre_asesor from public.miembros where org_id = p_org and user_id = auth.uid();

  insert into public.crm_cotizaciones (org_id, numero, proyecto, oportunidad_id, contacto_id, cliente_nombre, cliente_telefono, cliente_correo,
    cliente_identificacion, unidades, precio_lista, descuento, precio_final, forma_pago, entrada_pct, entrada, reserva, cuotas_entrada,
    cuota_entrada, saldo, tasa_anual, plazo_anios, cuota_mensual, vigencia_hasta, notas, condiciones, asesor_email, asesor_nombre)
  values (p_org, v_numero, v_proy, o.id, k.id, k.nombre, k.telefono, k.correo, left(v_ident, 30), v_units, v_lista, v_desc,
    (calc ->> 'precio_final')::numeric, v_forma, v_ent_pct, (calc ->> 'entrada')::numeric, (calc ->> 'reserva')::numeric, v_cuotas,
    (calc ->> 'cuota_entrada')::numeric, (calc ->> 'saldo')::numeric,
    case when v_forma = 'credito' then v_tasa end, case when v_forma = 'credito' then v_plazo end, (calc ->> 'cuota_mensual')::numeric,
    current_date + c.vigencia_dias, nullif(left(btrim(coalesce(d ->> 'notas', '')), 1000), ''), c.condiciones, v_yo, coalesce(v_nombre_asesor, v_yo))
  returning * into q;

  update public.crm_oportunidades set
    etapa = case when etapa in ('nuevo', 'contactado', 'cita') then 'proforma' else etapa end,
    valor_estimado = q.precio_final, proforma_numero = q.numero, unidad_interes = v_codigos, proyecto = coalesce(proyecto, v_proy)
  where id = o.id;
  insert into public.crm_actividades (org_id, oportunidad_id, contacto_id, tipo, contenido, creado_por)
  values (p_org, o.id, o.contacto_id, 'sistema',
    'Proforma ' || q.numero || ': ' || v_codigos || ' · ' || public.crm_dinero(q.precio_final) ||
    case when q.cuota_mensual is not null then ' · cuota estimada ' || public.crm_dinero(q.cuota_mensual) || '/mes' else ' · de contado' end, v_yo);
  return to_jsonb(q);
end;
$$;

create or replace function public.anular_cotizacion(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
declare q public.crm_cotizaciones%rowtype;
begin
  select * into q from public.crm_cotizaciones where id = p_id;
  if not found or not public.crm_puede_ver_op(q.oportunidad_id) then raise exception 'No se encontró la proforma'; end if;
  if not (public.tiene_rol_org(q.org_id, array['propietario', 'administrador']) or (public.rol_en(q.org_id) = 'agente' and q.asesor_email = public.mi_email())) then
    raise exception 'Solo quien la hizo o un administrador puede anular la proforma';
  end if;
  if q.estado = 'anulada' then raise exception 'La proforma ya está anulada'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribe el motivo de la anulación'; end if;
  update public.crm_cotizaciones set estado = 'anulada', anulada_motivo = left(btrim(p_motivo), 300) where id = p_id;
  insert into public.crm_actividades (org_id, oportunidad_id, contacto_id, tipo, contenido, creado_por)
  values (q.org_id, q.oportunidad_id, q.contacto_id, 'sistema', 'Proforma ' || q.numero || ' anulada: ' || left(btrim(p_motivo), 300), public.mi_email());
end;
$$;

-- --------------------------------------------------------- enlace privado para el cliente ---
-- Solo con el token exacto. Sin teléfono, correo ni identificación del cliente.
create or replace function public.cotizacion_publica(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q public.crm_cotizaciones%rowtype; m public.org_marca%rowtype; o public.organizaciones%rowtype; c public.crm_cotizador_config%rowtype; v_proy text;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into q from public.crm_cotizaciones where token = p_token;
  if not found then return null; end if;
  select * into o from public.organizaciones where id = q.org_id;
  if o.estado = 'cancelada' then return null; end if;
  if q.estado = 'anulada' then return jsonb_build_object('anulada', true, 'numero', q.numero); end if;
  select * into m from public.org_marca where org_id = q.org_id;
  select * into c from public.crm_cotizador_config where org_id = q.org_id and proyecto = q.proyecto;
  select nombre into v_proy from public.crm_proyectos where org_id = q.org_id and slug = q.proyecto;
  return jsonb_build_object(
    'numero', q.numero, 'fecha', q.created_at, 'vigencia_hasta', q.vigencia_hasta, 'vigente', q.vigencia_hasta >= current_date,
    'empresa', coalesce(m.nombre_comercial, o.nombre), 'logo_path', m.logo_path, 'color_primario', m.color_primario, 'color_acento', m.color_acento,
    'mostrar_pie_gpunlock', coalesce(m.mostrar_pie_gpunlock, true),
    'proyecto', v_proy, 'cliente_nombre', q.cliente_nombre, 'asesor_nombre', q.asesor_nombre, 'asesor_email', q.asesor_email, 'whatsapp', c.whatsapp,
    'unidades', q.unidades, 'precio_lista', q.precio_lista, 'descuento', q.descuento, 'precio_final', q.precio_final,
    'forma_pago', q.forma_pago, 'entrada_pct', q.entrada_pct, 'entrada', q.entrada, 'reserva', q.reserva, 'cuotas_entrada', q.cuotas_entrada,
    'cuota_entrada', q.cuota_entrada, 'saldo', q.saldo, 'tasa_anual', q.tasa_anual, 'plazo_anios', q.plazo_anios, 'cuota_mensual', q.cuota_mensual,
    'notas', q.notas, 'condiciones', q.condiciones);
end;
$$;

-- ------------------------------------------------------------------- permisos ---
revoke execute on function public.guardar_fotos_unidad(uuid, text[]), public.guardar_config_cotizador(uuid, text, jsonb),
  public.crear_cotizacion(uuid, jsonb), public.anular_cotizacion(uuid, text), public.cotizacion_publica(text) from public, anon;
grant execute on function public.guardar_fotos_unidad(uuid, text[]), public.guardar_config_cotizador(uuid, text, jsonb),
  public.crear_cotizacion(uuid, jsonb), public.anular_cotizacion(uuid, text) to authenticated;
grant execute on function public.cotizacion_publica(text) to anon, authenticated;

-- Tiempo real: una proforma nueva aparece en la ficha del lead de todo el equipo.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_cotizaciones') then
    alter publication supabase_realtime add table public.crm_cotizaciones;
  end if;
end $$;
