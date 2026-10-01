-- ============================================================================
-- GPUnlock · 05 · Cambio de disponibilidad de unidades
-- El rol "administrador" no tiene permiso de UPDATE directo sobre ninguna
-- tabla; su única forma de modificar datos es esta función, que solo toca la
-- columna de estado, valida el valor y deja registro en public.actividad.
-- El editor también la usa desde el panel (así todo cambio de estado queda
-- registrado, sin importar quién lo haga).
-- ============================================================================

create or replace function public.cambiar_estado(p_tabla text, p_id text, p_estado text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas integer;
  v_etiqueta text;
begin
  if not public.tiene_rol('editor', 'administrador') then
    raise exception 'Tu rol no permite cambiar la disponibilidad';
  end if;

  -- Tablas y valores permitidos escritos a mano (sin SQL dinámico).
  if p_tabla = 'units' then
    if p_estado not in ('disponible','reservado','vendido') then raise exception 'Estado no válido'; end if;
    update public.units set status = p_estado where code = p_id;
    v_etiqueta := 'Vértice';
  elsif p_tabla = 'prisma_units' then
    if p_estado not in ('disponible','reservado','vendido') then raise exception 'Estado no válido'; end if;
    update public.prisma_units set status = p_estado where code = p_id;
    v_etiqueta := 'Prisma';
  elsif p_tabla = 'lots' then
    if p_estado not in ('disponible','reservado','no_disponible') then raise exception 'Estado no válido'; end if;
    update public.lots set status = p_estado where code = p_id;
    v_etiqueta := 'Valle Sereno';
  elsif p_tabla = 'cotizador_unidades' then
    if p_estado not in ('disponible','reservado','vendida','no_disponible') then raise exception 'Estado no válido'; end if;
    update public.cotizador_unidades set estado = p_estado where id = p_id::uuid;
    v_etiqueta := 'Cotizador';
  elsif p_tabla = 'cotizador_inventario_extra' then
    if p_estado not in ('disponible','reservado','vendida','no_disponible') then raise exception 'Estado no válido'; end if;
    update public.cotizador_inventario_extra set estado = p_estado where id = p_id::uuid;
    v_etiqueta := 'Cotizador · extra';
  else
    raise exception 'Tabla no permitida';
  end if;

  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'No se encontró la unidad %', p_id;
  end if;

  insert into public.actividad (email, accion, detalle)
  values (auth.jwt() ->> 'email', 'estado', v_etiqueta || ' · ' || p_id || ' → ' || p_estado);
end;
$$;

revoke all on function public.cambiar_estado(text, text, text) from public, anon;
grant execute on function public.cambiar_estado(text, text, text) to authenticated;
