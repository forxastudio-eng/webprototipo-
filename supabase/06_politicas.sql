-- ============================================================================
-- GPUnlock · 06 · Políticas de acceso (RLS) por rol
-- Borra TODAS las políticas previas de estas tablas y de storage.objects y
-- las crea de nuevo, para que no quede ninguna regla vieja del tipo
-- "cualquier usuario autenticado puede editar". Pensado para el proyecto
-- nuevo y limpio; es seguro volver a ejecutarlo.
--
-- Resumen:
--                         editor   administrador   marketing   asesor   público
--  Landings (lectura)       ✓           ✓              ✓          ✓        ✓
--  Landings (edición)       ✓        solo estado       –          –        –
--  Cotizador (uso)          ✓           ✓              ✓          ✓        –
--  Cotizador (config.)      ✓        solo estado       –          –        –
--  Historial (ver/export)   ✓           ✓              ✓          –        –
--  Dashboard marketing      ✓ edita    lee           ✓ edita      –        –
--  Usuarios y roles         ✓           –              –          –        –
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where (schemaname = 'public' and tablename in (
            'user_roles','actividad','units','prisma_units','lots','slider_images','projects',
            'cotizador_proyectos','cotizador_unidades','cotizador_inventario_extra',
            'cotizador_asesores','cotizador_historial','cotizador_contador_proforma',
            'dashboard_content'))
       or (schemaname = 'storage' and tablename = 'objects')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- La tabla vieja de admins del cotizador queda reemplazada por user_roles.
drop table if exists public.cotizador_admins cascade;

-- ---------------------------------------------------------------- roles ---
create policy "roles: cada quien ve el suyo, el editor ve todos"
  on public.user_roles for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.tiene_rol('editor'));
create policy "roles: solo editor administra"
  on public.user_roles for all to authenticated
  using (public.tiene_rol('editor')) with check (public.tiene_rol('editor'));

create policy "actividad: lectura interna"
  on public.actividad for select to authenticated
  using (public.tiene_rol('editor','administrador','marketing'));
create policy "actividad: registrar propia"
  on public.actividad for insert to authenticated
  with check (public.tiene_rol('editor','marketing') and email = auth.jwt() ->> 'email');

-- ------------------------------------------------------------- landings ---
do $$
declare t text;
begin
  foreach t in array array['units','prisma_units','lots','slider_images','projects'] loop
    execute format('create policy "lectura publica" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "editor inserta" on public.%I for insert to authenticated with check (public.tiene_rol(''editor''))', t);
    execute format('create policy "editor actualiza" on public.%I for update to authenticated using (public.tiene_rol(''editor'')) with check (public.tiene_rol(''editor''))', t);
    execute format('create policy "editor elimina" on public.%I for delete to authenticated using (public.tiene_rol(''editor''))', t);
  end loop;
end $$;

-- ------------------------------------------------------------ cotizador ---
do $$
declare t text;
begin
  foreach t in array array['cotizador_proyectos','cotizador_unidades','cotizador_inventario_extra','cotizador_asesores'] loop
    execute format('create policy "equipo lee" on public.%I for select to authenticated using (public.mi_rol() is not null)', t);
    execute format('create policy "editor inserta" on public.%I for insert to authenticated with check (public.tiene_rol(''editor''))', t);
    execute format('create policy "editor actualiza" on public.%I for update to authenticated using (public.tiene_rol(''editor'')) with check (public.tiene_rol(''editor''))', t);
    execute format('create policy "editor elimina" on public.%I for delete to authenticated using (public.tiene_rol(''editor''))', t);
  end loop;
end $$;

create policy "historial: lectura para direccion y marketing"
  on public.cotizador_historial for select to authenticated
  using (public.tiene_rol('editor','administrador','marketing'));
create policy "historial: cualquier rol guarda sus proformas"
  on public.cotizador_historial for insert to authenticated
  with check (public.mi_rol() is not null and creado_por = auth.uid());
create policy "historial: solo editor elimina"
  on public.cotizador_historial for delete to authenticated
  using (public.tiene_rol('editor'));

-- El contador solo se usa a través de siguiente_numero_proforma() (security
-- definer); se deja lectura para el panel y edición solo al editor.
create policy "contador: lectura equipo"
  on public.cotizador_contador_proforma for select to authenticated
  using (public.mi_rol() is not null);
create policy "contador: editor"
  on public.cotizador_contador_proforma for all to authenticated
  using (public.tiene_rol('editor')) with check (public.tiene_rol('editor'));

-- ------------------------------------------------------------ marketing ---
create policy "dashboard: lectura interna"
  on public.dashboard_content for select to authenticated
  using (public.tiene_rol('editor','administrador','marketing'));
create policy "dashboard: editor y marketing insertan"
  on public.dashboard_content for insert to authenticated
  with check (public.tiene_rol('editor','marketing'));
create policy "dashboard: editor y marketing editan"
  on public.dashboard_content for update to authenticated
  using (public.tiene_rol('editor','marketing')) with check (public.tiene_rol('editor','marketing'));

-- -------------------------------------------------------------- storage ---
create policy "site-images: lectura publica"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'site-images');
create policy "site-images: editor sube"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'site-images' and public.tiene_rol('editor'));
create policy "site-images: editor actualiza"
  on storage.objects for update to authenticated
  using (bucket_id = 'site-images' and public.tiene_rol('editor'));
create policy "site-images: editor elimina"
  on storage.objects for delete to authenticated
  using (bucket_id = 'site-images' and public.tiene_rol('editor'));

create policy "cotizador-media: equipo lee"
  on storage.objects for select to authenticated
  using (bucket_id = 'cotizador-media' and public.mi_rol() is not null);
create policy "cotizador-media: editor sube"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cotizador-media' and public.tiene_rol('editor'));
create policy "cotizador-media: editor actualiza"
  on storage.objects for update to authenticated
  using (bucket_id = 'cotizador-media' and public.tiene_rol('editor'));
create policy "cotizador-media: editor elimina"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cotizador-media' and public.tiene_rol('editor'));
