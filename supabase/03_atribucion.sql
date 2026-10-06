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
