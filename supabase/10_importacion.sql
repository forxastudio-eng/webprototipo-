-- ============================================================================
-- GPUnlock CRM · 10 · Importar la cartera de leads (Excel / CSV) y deshacer la importación
-- Ejecutar después de 09_ventas.sql. Seguro de repetir.
--
--   · La app lee el archivo (también exportaciones de Kommo, Pipedrive o HubSpot), propone las columnas,
--     muestra los errores por fila y envía solo lo válido. El servidor vuelve a validar TODO: si algo
--     no cuadra no se guarda nada.
--   · No duplica: un cliente que ya existe (mismo teléfono o correo) se reutiliza; si además ya tiene un
--     lead abierto en el mismo proyecto, la fila se cuenta como «ya existía».
--   · La cartera importada no cuenta en el límite mensual de leads, no aparece como «sin responder»
--     y no dispara tareas automáticas en masa.
--   · Cada importación queda registrada y se puede deshacer durante 7 días.
-- ============================================================================

create table if not exists public.crm_importaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizaciones(id) on delete cascade,
  tipo text not null default 'leads' check (tipo in ('leads')),
  archivo text,
  filas integer not null default 0,
  creados integer not null default 0,
  existentes integer not null default 0,
  por text,
  created_at timestamptz not null default now(),
  deshecha_at timestamptz
);
create index if not exists crm_importaciones_org_ix on public.crm_importaciones (org_id, created_at desc);
alter table public.crm_importaciones enable row level security;

alter table public.crm_contactos add column if not exists importacion_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_oportunidades_importacion_fk') then
    alter table public.crm_oportunidades add constraint crm_oportunidades_importacion_fk
      foreign key (importacion_id) references public.crm_importaciones(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_contactos_importacion_fk') then
    alter table public.crm_contactos add constraint crm_contactos_importacion_fk
      foreign key (importacion_id) references public.crm_importaciones(id) on delete set null;
  end if;
end $$;
create index if not exists crm_op_importacion_ix on public.crm_oportunidades (importacion_id) where importacion_id is not null;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'crm_importaciones'
  loop
    execute format('drop policy %I on public.crm_importaciones', r.policyname);
  end loop;
end $$;
create policy "importaciones: las ven propietario y administrador" on public.crm_importaciones
  for select to authenticated using (public.tiene_rol_org(org_id, array['propietario', 'administrador']));
revoke all on public.crm_importaciones from anon;
revoke insert, update, delete, truncate on public.crm_importaciones from authenticated;

-- ----------------------------------------------------------------------- importar ---
-- p_defectos: { proyecto: slug|null, fuente: 'cartera', asignado: email | '__repartir__' | null }
create or replace function public.importar_leads(p_org uuid, p_archivo text, p_filas jsonb, p_defectos jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  dflt jsonb := coalesce(p_defectos, '{}'::jsonb);
  v_yo text := public.mi_email();
  e jsonb; ord integer := 0; fila integer; n_err integer := 0; errores jsonb := '[]'::jsonb; msg text;
  v_nombre text; v_tel text; v_correo text; v_proy text; v_fuente text; v_etapa text; v_asig text; v_valor numeric; v_nota text; v_unidad text;
  vistos text[] := '{}';
  v_agentes text[]; v_rep integer := 0;
  v_imp uuid; v_cont uuid; v_op uuid; n_creados integer := 0; n_exist integer := 0;
  FUENTES constant text[] := array['formulario_web','whatsapp','llamada','facebook','instagram','tiktok','google','marketplace','portal','feria','cartera','co_broker','referido','oficina','otro'];
  ETAPAS constant text[] := array['nuevo','contactado','cita','proforma','reserva','vendido','perdido'];
begin
  if not public.tiene_rol_org(p_org, array['propietario', 'administrador']) then raise exception 'Solo el propietario o un administrador importa la cartera'; end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa. Renuévala para importar.'; end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'El archivo no tiene filas para importar'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Máximo 2.000 filas por archivo. Divide el archivo y vuelve a intentar.'; end if;
  if nullif(dflt ->> 'proyecto', '') is not null and not exists (select 1 from public.crm_proyectos where org_id = p_org and slug = dflt ->> 'proyecto') then raise exception 'El proyecto elegido no existe'; end if;
  if coalesce(dflt ->> 'fuente', 'cartera') <> all(FUENTES) then raise exception 'Fuente no válida'; end if;
  if nullif(dflt ->> 'asignado', '') is not null and dflt ->> 'asignado' <> '__repartir__'
     and not exists (select 1 from public.miembros where org_id = p_org and email = lower(dflt ->> 'asignado') and rol <> 'lector') then
    raise exception 'La persona elegida para recibir los leads no está en tu equipo';
  end if;
  select coalesce(array_agg(email order by email), '{}') into v_agentes from public.miembros where org_id = p_org and rol = 'agente';
  if dflt ->> 'asignado' = '__repartir__' and cardinality(v_agentes) = 0 then raise exception 'No hay agentes para repartir los leads'; end if;

  -- 1. Validar todo
  for e in select value from jsonb_array_elements(p_filas) loop
    ord := ord + 1; fila := coalesce((e ->> 'fila')::integer, ord); msg := null;
    v_nombre := btrim(coalesce(e ->> 'nombre', ''));
    v_tel := public.crm_normalizar_telefono(e ->> 'telefono');
    v_correo := nullif(lower(btrim(coalesce(e ->> 'correo', ''))), '');
    if char_length(v_nombre) not between 2 and 120 then msg := 'Falta el nombre (de 2 a 120 letras)';
    elsif nullif(btrim(coalesce(e ->> 'telefono', '')), '') is not null and char_length(v_tel) not between 9 and 15 then msg := 'Teléfono no válido';
    elsif v_correo is not null and v_correo !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then msg := 'Correo no válido';
    elsif v_tel = '' and v_correo is null then msg := 'Falta el teléfono o el correo';
    elsif nullif(e ->> 'proyecto', '') is not null and not exists (select 1 from public.crm_proyectos where org_id = p_org and slug = e ->> 'proyecto') then msg := 'El proyecto no existe';
    elsif nullif(e ->> 'fuente', '') is not null and e ->> 'fuente' <> all(FUENTES) then msg := 'Fuente no válida';
    elsif nullif(e ->> 'etapa', '') is not null and e ->> 'etapa' <> all(ETAPAS) then msg := 'Etapa no válida';
    elsif nullif(e ->> 'asignado', '') is not null and not exists (select 1 from public.miembros where org_id = p_org and email = lower(e ->> 'asignado') and rol <> 'lector') then msg := 'El asesor no está en tu equipo';
    else
      begin
        v_valor := nullif(e ->> 'valor', '')::numeric;
        if v_valor < 0 then msg := 'El valor no puede ser negativo'; end if;
      exception when others then msg := 'El valor no es un número';
      end;
    end if;
    if msg is null then
      if (v_tel <> '' and ('t:' || v_tel) = any(vistos)) or (v_correo is not null and ('c:' || v_correo) = any(vistos)) then msg := 'Cliente repetido en el archivo'; end if;
      if v_tel <> '' then vistos := vistos || ('t:' || v_tel); end if;
      if v_correo is not null then vistos := vistos || ('c:' || v_correo); end if;
    end if;
    if msg is not null then
      n_err := n_err + 1;
      if n_err <= 50 then errores := errores || jsonb_build_object('fila', fila, 'error', msg); end if;
    end if;
  end loop;
  if n_err > 0 then return jsonb_build_object('ok', false, 'errores', errores, 'total_errores', n_err); end if;

  -- 2. Guardar
  insert into public.crm_importaciones (org_id, archivo, filas, por) values (p_org, left(p_archivo, 200), jsonb_array_length(p_filas), v_yo) returning id into v_imp;
  for e in select value from jsonb_array_elements(p_filas) loop
    v_nombre := btrim(e ->> 'nombre');
    v_tel := public.crm_normalizar_telefono(e ->> 'telefono');
    v_correo := nullif(lower(btrim(coalesce(e ->> 'correo', ''))), '');
    v_proy := coalesce(nullif(e ->> 'proyecto', ''), nullif(dflt ->> 'proyecto', ''));
    v_fuente := coalesce(nullif(e ->> 'fuente', ''), nullif(dflt ->> 'fuente', ''), 'cartera');
    v_etapa := coalesce(nullif(e ->> 'etapa', ''), 'nuevo');
    v_asig := lower(nullif(e ->> 'asignado', ''));
    if v_asig is null and nullif(dflt ->> 'asignado', '') is not null then
      if dflt ->> 'asignado' = '__repartir__' then v_asig := v_agentes[(v_rep % cardinality(v_agentes)) + 1]; v_rep := v_rep + 1;
      else v_asig := lower(dflt ->> 'asignado'); end if;
    end if;
    v_valor := nullif(e ->> 'valor', '')::numeric;
    v_nota := nullif(left(btrim(coalesce(e ->> 'nota', '')), 4000), '');
    v_unidad := nullif(left(btrim(coalesce(e ->> 'unidad', '')), 120), '');

    v_cont := null;
    if v_tel <> '' then select id into v_cont from public.crm_contactos where org_id = p_org and telefono_norm = v_tel; end if;
    if v_cont is null and v_correo is not null then select id into v_cont from public.crm_contactos where org_id = p_org and correo = v_correo limit 1; end if;
    if v_cont is null then
      insert into public.crm_contactos (org_id, nombre, telefono, correo, creado_por, importacion_id)
      values (p_org, v_nombre, nullif(btrim(coalesce(e ->> 'telefono', '')), ''), v_correo, v_yo, v_imp) returning id into v_cont;
    else
      update public.crm_contactos set correo = coalesce(correo, v_correo), telefono = coalesce(telefono, nullif(btrim(coalesce(e ->> 'telefono', '')), '')) where id = v_cont;
    end if;

    if exists (select 1 from public.crm_oportunidades where contacto_id = v_cont and coalesce(proyecto, '') = coalesce(v_proy, '') and etapa not in ('vendido', 'perdido')) then
      n_exist := n_exist + 1;
      continue;
    end if;
    insert into public.crm_oportunidades (org_id, contacto_id, proyecto, unidad_interes, etapa, fuente, origen, asignado_a, valor_estimado, importacion_id,
                                          motivo_perdida, primera_respuesta_at)
    values (p_org, v_cont, v_proy, v_unidad, v_etapa, v_fuente, 'importacion', v_asig, v_valor, v_imp,
            case when v_etapa = 'perdido' then 'Importado como perdido' end, now())
    returning id into v_op;
    if v_nota is not null then
      insert into public.crm_actividades (org_id, oportunidad_id, contacto_id, tipo, contenido, creado_por) values (p_org, v_op, v_cont, 'nota', v_nota, 'importacion');
    end if;
    n_creados := n_creados + 1;
  end loop;
  update public.crm_importaciones set creados = n_creados, existentes = n_exist where id = v_imp;
  return jsonb_build_object('ok', true, 'importacion_id', v_imp, 'creados', n_creados, 'existentes', n_exist);
end;
$$;

-- --------------------------------------------------------------- deshacer ---
-- Borra los leads que creó esa importación (con su historial) y los contactos nuevos que queden sin leads.
create or replace function public.deshacer_importacion(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.crm_importaciones%rowtype; n_ops integer; n_cont integer;
begin
  select * into i from public.crm_importaciones where id = p_id for update;
  if not found or not public.tiene_rol_org(i.org_id, array['propietario', 'administrador']) then raise exception 'No se encontró la importación'; end if;
  if i.deshecha_at is not null then raise exception 'Esta importación ya se deshizo'; end if;
  if i.created_at < now() - interval '7 days' then raise exception 'Solo se puede deshacer durante 7 días'; end if;
  delete from public.crm_oportunidades where importacion_id = p_id;
  get diagnostics n_ops = row_count;
  delete from public.crm_contactos c where c.importacion_id = p_id and not exists (select 1 from public.crm_oportunidades o where o.contacto_id = c.id);
  get diagnostics n_cont = row_count;
  update public.crm_importaciones set deshecha_at = now() where id = p_id;
  return jsonb_build_object('leads_borrados', n_ops, 'contactos_borrados', n_cont);
end;
$$;

revoke execute on function public.importar_leads(uuid, text, jsonb, jsonb), public.deshacer_importacion(uuid) from public, anon;
grant execute on function public.importar_leads(uuid, text, jsonb, jsonb), public.deshacer_importacion(uuid) to authenticated;
