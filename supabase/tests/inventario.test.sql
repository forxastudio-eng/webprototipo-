-- Inventario: quién puede qué, validaciones, importación todo-o-nada, estados con historial, lead y web pública.
\set ON_ERROR_STOP on
\set a  '00000000-0000-0000-0000-0000000000c1'
\set ad '00000000-0000-0000-0000-0000000000c2'
\set ag '00000000-0000-0000-0000-0000000000c3'
\set ag2 '00000000-0000-0000-0000-0000000000c4'
\set l  '00000000-0000-0000-0000-0000000000c5'
\set b  '00000000-0000-0000-0000-0000000000c6'
insert into auth.users (id, email) values (:'a','dueno-a@x.com'), (:'ad','admin-a@x.com'), (:'ag','agente-a@x.com'), (:'ag2','agente2-a@x.com'), (:'l','lector-a@x.com'), (:'b','dueno-b@x.com');
select test.login(:'a','dueno-a@x.com'); select public.crear_organizacion('Inmobiliaria A') as org_a \gset
select test.login(:'b','dueno-b@x.com'); select public.crear_organizacion('Inmobiliaria B') as org_b \gset
reset role;
insert into public.miembros (org_id, user_id, email, rol) values
  (:'org_a', :'ad', 'admin-a@x.com', 'administrador'), (:'org_a', :'ag', 'agente-a@x.com', 'agente'),
  (:'org_a', :'ag2', 'agente2-a@x.com', 'agente'), (:'org_a', :'l', 'lector-a@x.com', 'lector');
select clave_publica as clave_a from public.organizaciones where id = :'org_a' \gset
select test.login(:'a','dueno-a@x.com');
insert into public.crm_proyectos (org_id, slug, nombre) values (:'org_a', 'torre', 'Torre Alba'), (:'org_a', 'valle', 'Valle Verde');
select test.login(:'b','dueno-b@x.com');
insert into public.crm_proyectos (org_id, slug, nombre) values (:'org_b', 'torre', 'Torre de B');

-- 1. Quién puede ------------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre","codigo":"A-101","tipo":"departamento","piso":"1","area_m2":85.5,"dormitorios":2,"banos":2.5,"parqueos":1,"precio":120000}')) ->> 'id' as u1 \gset
select test.assert((select codigo = 'A-101' and estado = 'disponible' and precio = 120000 and banos = 2.5 and publica from public.crm_unidades where id = :'u1'), 'el propietario crea una unidad (estado disponible por defecto)');
select test.login(:'ad','admin-a@x.com');
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre","codigo":"A-102","tipo":"suite","precio":95000}')) ->> 'id' as u2 \gset
select test.assert((select tipo = 'suite' from public.crm_unidades where id = :'u2'), 'el administrador también crea unidades');
select test.login(:'ag','agente-a@x.com');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"X-1"}') $$, 'un agente no crea unidades');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', '$$ || :'u1' || $$', '{"proyecto":"torre","codigo":"A-101","precio":1}') $$, 'un agente no edita precios');
select test.falla($$ select public.eliminar_unidad('$$ || :'u2' || $$') $$, 'un agente no elimina unidades');
select test.falla($$ select public.importar_unidades('$$ || :'org_a' || $$', '[{"proyecto":"torre","codigo":"Z-1"}]') $$, 'un agente no importa');
select test.login(:'l','lector-a@x.com');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"X-2"}') $$, 'un lector no crea unidades');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u1' || $$', 'reservada') $$, 'un lector no reserva');
select test.login(:'b','dueno-b@x.com');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"X-3"}') $$, 'otra empresa no crea unidades en la mía');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', '$$ || :'u1' || $$', '{"proyecto":"torre","codigo":"A-101","precio":1}') $$, 'otra empresa no edita mis unidades');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u1' || $$', 'vendida') $$, 'otra empresa no cambia mis estados');
select test.falla($$ select public.eliminar_unidad('$$ || :'u2' || $$') $$, 'otra empresa no elimina mis unidades');
select test.anon();
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"X-4"}') $$, 'sin sesión no se crean unidades');
select test.falla($$ select * from public.crm_unidades $$, 'sin sesión no se lee el inventario');

-- 2. Lectura: todo el equipo, nadie de afuera; ninguna escritura directa ------------------------------
select test.login(:'ag','agente-a@x.com');
select test.assert((select count(*) = 2 from public.crm_unidades), 'un agente ve el inventario');
select test.login(:'l','lector-a@x.com');
select test.assert((select count(*) = 2 from public.crm_unidades), 'un lector ve el inventario');
select test.login(:'b','dueno-b@x.com');
select test.assert((select count(*) = 0 from public.crm_unidades), 'otra empresa no ve mi inventario');
select test.assert((select count(*) = 0 from public.crm_unidades_historial), 'ni su historial');
select test.login(:'a','dueno-a@x.com');
select test.falla($$ insert into public.crm_unidades (org_id, proyecto, codigo) values ('$$ || :'org_a' || $$', 'torre', 'DIRECTO') $$, 'no se inserta directo en la tabla');
select test.falla($$ update public.crm_unidades set precio = 1 $$, 'no se actualiza directo');
select test.falla($$ delete from public.crm_unidades $$, 'no se borra directo');

-- 3. Validaciones ------------------------------------------------------------------------------
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"no-existe","codigo":"Q-1"}') $$, 'el proyecto debe existir en tu empresa');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"  "}') $$, 'el código es obligatorio');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"Q-1","tipo":"castillo"}') $$, 'tipo no válido');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"Q-1","estado":"regalada"}') $$, 'estado no válido');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"Q-1","precio":"mucho"}') $$, 'el precio debe ser un número');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"Q-1","precio":-1}') $$, 'el precio no es negativo');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"Q-1","dormitorios":2.5}') $$, 'los dormitorios son enteros');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"Q-1","banos":1.3}') $$, 'los baños van de medio en medio');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"Q-1","area_m2":999999}') $$, 'área fuera de rango');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"a-101"}') $$, 'el código no se repite en el proyecto (sin distinguir mayúsculas)');
select public.guardar_unidad(:'org_a', null, '{"proyecto":"valle","codigo":"A-101"}');
select test.assert((select count(*) = 3 from public.crm_unidades), 'el mismo código sí puede existir en otro proyecto');
select test.falla($$ select public.guardar_unidad('$$ || :'org_b' || $$', null, '{"proyecto":"torre","codigo":"A-101"}') $$, 'no puedo crear en la empresa B');
-- Editar: solo cambia lo que viene
select public.guardar_unidad(:'org_a', :'u1', '{"proyecto":"torre","codigo":"A-101","precio":125000}');
select test.assert((select precio = 125000 and area_m2 = 85.5 and dormitorios = 2 from public.crm_unidades where id = :'u1'), 'editar el precio no borra el resto de los datos');
select test.assert((select count(*) = 1 from public.crm_unidades_historial where unidad_id = :'u1' and precio_antes = 120000 and precio_despues = 125000), 'el cambio de precio queda en el historial');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', '00000000-0000-0000-0000-00000000dead', '{"proyecto":"torre","codigo":"ZZ"}') $$, 'editar una unidad que no existe');

-- 4. Importar ----------------------------------------------------------------------------------
select public.importar_unidades(:'org_a', '[
  {"fila":2,"proyecto":"torre","codigo":"B-201","tipo":"departamento","piso":"2","area_m2":70,"dormitorios":2,"precio":98000},
  {"fila":3,"proyecto":"torre","codigo":"B-202","tipo":"suite","area_m2":45,"precio":71000,"estado":"reservada"},
  {"fila":4,"proyecto":"torre","codigo":"a-101","precio":130000,"estado":"vendida"}
]'::jsonb) as r \gset
select test.assert((:'r'::jsonb ->> 'ok')::boolean and (:'r'::jsonb ->> 'creadas')::int = 2 and (:'r'::jsonb ->> 'actualizadas')::int = 1, 'importa: 2 nuevas y 1 actualizada (el código no distingue mayúsculas)');
select test.assert((select precio = 130000 and estado = 'disponible' and area_m2 = 85.5 from public.crm_unidades where id = :'u1'), 'una unidad existente solo cambia las columnas del archivo y conserva su estado');
select test.assert((select estado = 'reservada' from public.crm_unidades where codigo = 'B-202'), 'una nueva toma el estado del archivo');
select public.importar_unidades(:'org_a', '[{"proyecto":"torre","codigo":"A-101","estado":"vendida"}]'::jsonb, true);
select test.assert((select estado = 'vendida' from public.crm_unidades where id = :'u1'), 'con «actualizar estado» sí cambia el de las existentes');
select public.cambiar_estado_unidad(:'u1', 'disponible');
select (public.importar_unidades(:'org_a', '[
  {"fila":2,"proyecto":"torre","codigo":"C-1","precio":1},
  {"fila":3,"proyecto":"nada","codigo":"C-2"},
  {"fila":4,"proyecto":"torre","codigo":"C-3","precio":"abc"},
  {"fila":5,"proyecto":"torre","codigo":"C-1"},
  {"fila":6,"proyecto":"torre","codigo":""}
]'::jsonb)) as r \gset
select test.assert(not (:'r'::jsonb ->> 'ok')::boolean and (:'r'::jsonb ->> 'total_errores')::int = 4, 'con errores devuelve todos (4) y no guarda nada');
select test.assert((:'r'::jsonb -> 'errores' -> 0 ->> 'fila') = '3' and (:'r'::jsonb -> 'errores' -> 0 ->> 'error') like '%no existe%', 'cada error trae su fila y su motivo');
select test.assert((select count(*) = 0 from public.crm_unidades where codigo = 'C-1'), 'todo o nada: la fila válida tampoco se guardó');
select test.falla($$ select public.importar_unidades('$$ || :'org_a' || $$', '[]') $$, 'un archivo vacío no se importa');
select test.falla($$ select public.importar_unidades('$$ || :'org_a' || $$', (select jsonb_agg(jsonb_build_object('proyecto','torre','codigo','M-' || g)) from generate_series(1, 2001) g)) $$, 'máximo 2.000 filas');
select test.falla($$ select public.importar_unidades('$$ || :'org_b' || $$', '[{"proyecto":"torre","codigo":"A-1"}]') $$, 'no se importa a otra empresa');

-- 5. Estados, historial y lead --------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select (public.crm_crear_lead(:'org_a', 'Cliente Uno', '0991111111', null, 'torre', null, null, 'whatsapp', 'agente-a@x.com')) ->> 'oportunidad_id' as op1 \gset
select (public.crm_crear_lead(:'org_a', 'Cliente Dos', '0992222222', null, 'torre', null, null, 'whatsapp', 'agente2-a@x.com')) ->> 'oportunidad_id' as op2 \gset
select test.login(:'ag','agente-a@x.com');
select public.cambiar_estado_unidad(:'u1', 'reservada', :'op1', 'Dejó 500 de señal');
select test.assert((select estado = 'reservada' from public.crm_unidades where id = :'u1'), 'un agente reserva');
select test.assert((select etapa = 'reserva' and unidad_interes = 'A-101' and valor_estimado = 130000 from public.crm_oportunidades where id = :'op1'), 'reservar mueve el lead a «reserva» con la unidad y su precio como valor');
select test.assert((select count(*) = 1 from public.crm_unidades_historial where unidad_id = :'u1' and estado_antes = 'disponible' and estado_despues = 'reservada'
                    and oportunidad_id = :'op1' and por = 'agente-a@x.com' and nota = 'Dejó 500 de señal'), 'el historial dice quién, cuándo, para qué lead y la nota');
select test.assert((select count(*) = 1 from public.crm_actividades where oportunidad_id = :'op1' and tipo = 'cambio_etapa' and contenido like '%reserva'), 'y la línea de tiempo del lead registra el cambio de etapa');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u1' || $$', 'reservada') $$, 'no se reserva dos veces');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u2' || $$', 'reservada', '$$ || :'op2' || $$') $$, 'un agente no asocia la unidad al lead de otro agente');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u2' || $$', 'vendida') $$, 'un agente no vende');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u2' || $$', 'no_disponible') $$, 'un agente no bloquea');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u2' || $$', 'inventado') $$, 'estado no válido');
select test.login(:'ad','admin-a@x.com');
select public.cambiar_estado_unidad(:'u1', 'vendida', :'op1');
select test.assert((select estado = 'vendida' from public.crm_unidades where id = :'u1') and (select etapa = 'vendido' and cerrado_at is not null from public.crm_oportunidades where id = :'op1'), 'el administrador vende: el lead pasa a «vendido» y se cierra');
select test.login(:'ag','agente-a@x.com');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u1' || $$', 'disponible') $$, 'un agente no reabre una unidad vendida');
select test.login(:'ad','admin-a@x.com');
select public.cambiar_estado_unidad(:'u1', 'disponible', null, 'La venta se cayó');
select test.assert((select estado = 'disponible' from public.crm_unidades where id = :'u1'), 'un administrador sí la reabre');
select test.assert((select count(*) = 8 from public.crm_unidades_historial where unidad_id = :'u1'), 'el historial de la unidad tiene 8 entradas: alta, 2 cambios de precio y 5 de estado');
select public.cambiar_estado_unidad(:'u2', 'reservada', :'op2');
select test.assert((select etapa = 'reserva' and unidad_interes = 'A-102' from public.crm_oportunidades where id = :'op2'), 'un administrador sí asocia el lead de cualquier agente');
select test.login(:'b','dueno-b@x.com');
select (public.crm_crear_lead(:'org_b', 'Cliente de B', '0993333333', null, 'torre', null, null, 'whatsapp', null)) ->> 'oportunidad_id' as op_b \gset
select test.login(:'ad','admin-a@x.com');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u1' || $$', 'reservada', '$$ || :'op_b' || $$') $$, 'no se asocia una unidad a un lead de otra empresa');
select public.cambiar_estado_unidad(:'u2', 'disponible');

-- 6. Eliminar ---------------------------------------------------------------------------------------
select public.cambiar_estado_unidad(:'u1', 'vendida');
select test.falla($$ select public.eliminar_unidad('$$ || :'u1' || $$') $$, 'una unidad vendida no se elimina');
select public.cambiar_estado_unidad(:'u1', 'no_disponible');
select public.eliminar_unidad(:'u1');
select test.assert((select count(*) = 0 from public.crm_unidades where id = :'u1'), 'una unidad no vendida se elimina');
select test.assert((select count(*) = 0 from public.crm_unidades_historial where unidad_id = :'u1'), 'junto con su historial');
select test.login(:'a','dueno-a@x.com');
select test.falla($$ delete from public.crm_proyectos where org_id = '$$ || :'org_a' || $$' and slug = 'torre' $$, 'un proyecto con unidades no se elimina');
select public.guardar_unidad(:'org_a', null, '{"proyecto":"valle","codigo":"V-1","precio":50000}');
insert into public.crm_proyectos (org_id, slug, nombre) values (:'org_a', 'vacio', 'Sin unidades');
delete from public.crm_proyectos where org_id = :'org_a' and slug = 'vacio';
select test.assert(not exists (select 1 from public.crm_proyectos where slug = 'vacio'), 'un proyecto sin unidades sí se elimina');

-- 7. Suscripción vencida: se ve, no se cambia -------------------------------------------------------
reset role;
update public.organizaciones set estado = 'vencida' where id = :'org_a';
select test.login(:'a','dueno-a@x.com');
select test.assert((select count(*) > 0 from public.crm_unidades), 'vencida: el inventario se sigue viendo');
select test.falla($$ select public.guardar_unidad('$$ || :'org_a' || $$', null, '{"proyecto":"torre","codigo":"W-1"}') $$, 'vencida: no se crean unidades');
select test.falla($$ select public.cambiar_estado_unidad('$$ || :'u2' || $$', 'reservada') $$, 'vencida: no se cambian estados');
select test.falla($$ select public.importar_unidades('$$ || :'org_a' || $$', '[{"proyecto":"torre","codigo":"W-2"}]') $$, 'vencida: no se importa');
reset role;
update public.organizaciones set estado = 'activa', periodo_hasta = now() + interval '30 days' where id = :'org_a';

-- 8. Web pública --------------------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select public.guardar_unidad(:'org_a', null, '{"proyecto":"torre","codigo":"P-1","precio":80000,"publica":false}');
select public.guardar_unidad(:'org_a', null, '{"proyecto":"torre","codigo":"P-2","precio":81000,"estado":"no_disponible"}');
select test.anon();
select public.inventario_publico(:'clave_a') as pub \gset
select test.assert(jsonb_array_length((:'pub'::jsonb) -> 'unidades') = 5, 'la web ve las unidades públicas y no bloqueadas (A-102, B-201, B-202 y las 2 de Valle Verde)');
select test.assert(not exists (select 1 from jsonb_array_elements((:'pub'::jsonb) -> 'unidades') e where e ->> 'codigo' in ('P-1', 'P-2')), 'no sale lo marcado como no público ni lo no disponible');
select test.assert(not exists (select 1 from jsonb_array_elements((:'pub'::jsonb) -> 'unidades') e where e ? 'id' or e ? 'org_id' or e ? 'publica'), 'no revela ids ni datos internos');
select test.assert(exists (select 1 from jsonb_array_elements((:'pub'::jsonb) -> 'unidades') e where e ->> 'codigo' = 'B-201' and (e ->> 'precio')::numeric = 98000 and e ->> 'proyecto_nombre' = 'Torre Alba'), 'trae precio y nombre del proyecto');
select jsonb_array_length((public.inventario_publico(:'clave_a', 'valle')) -> 'unidades') as n_valle \gset
select test.assert(:n_valle = 2, 'se puede pedir un solo proyecto');
select test.falla($$ select public.inventario_publico('pk_inexistente') $$, 'clave no válida');
select test.falla($$ select * from public.crm_unidades $$, 'la tabla sigue cerrada para la web');
select test.login(:'a','dueno-a@x.com');
update public.crm_proyectos set precios_publicos = false where org_id = :'org_a' and slug = 'torre';
select test.anon();
select test.assert(not exists (select 1 from jsonb_array_elements((public.inventario_publico(:'clave_a', 'torre')) -> 'unidades') e where e ->> 'precio' is not null), 'si el proyecto oculta precios, no salen');
select test.assert(jsonb_array_length((public.inventario_publico(:'clave_a', 'torre')) -> 'unidades') = 3, 'pero las unidades sí');
select test.login(:'a','dueno-a@x.com');
update public.crm_proyectos set activo = false where org_id = :'org_a' and slug = 'valle';
select test.anon();
select test.assert(jsonb_array_length((public.inventario_publico(:'clave_a')) -> 'unidades') = 3, 'los proyectos ocultos no salen en la web');
reset role;
update public.organizaciones set estado = 'cancelada' where id = :'org_a';
select test.anon();
select test.falla($$ select public.inventario_publico('$$ || :'clave_a' || $$') $$, 'una empresa cancelada no muestra su inventario');
reset role;
select test.assert(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crm_unidades') or not exists (select 1 from pg_publication where pubname = 'supabase_realtime'),
                   'crm_unidades está en la publicación de tiempo real');
