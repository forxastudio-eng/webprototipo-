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
