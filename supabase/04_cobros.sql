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
                           where org_id = o.id and created_at >= date_trunc('month', now()) and importacion_id is null), 0),
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
      'leads_mes', (select count(*) from public.crm_oportunidades x where x.org_id = o.id and x.created_at >= date_trunc('month', now()) and x.importacion_id is null),
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
