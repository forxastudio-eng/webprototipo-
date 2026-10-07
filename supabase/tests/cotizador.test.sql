-- Cotizador: cálculo en el servidor, lead existente o cliente nuevo, permisos, descuento por rol, numeración, enlace privado y fotos.
\set ON_ERROR_STOP on
\set a  '00000000-0000-0000-0000-0000000000d1'
\set ad '00000000-0000-0000-0000-0000000000d2'
\set ag '00000000-0000-0000-0000-0000000000d3'
\set ag2 '00000000-0000-0000-0000-0000000000d4'
\set l  '00000000-0000-0000-0000-0000000000d5'
\set b  '00000000-0000-0000-0000-0000000000d6'
insert into auth.users (id, email) values (:'a','dueno-a@x.com'), (:'ad','admin-a@x.com'), (:'ag','agente-a@x.com'), (:'ag2','agente2-a@x.com'), (:'l','lector-a@x.com'), (:'b','dueno-b@x.com');
select test.login(:'a','dueno-a@x.com'); select public.crear_organizacion('Inmobiliaria A', 'Ana Dueña') as org_a \gset
select test.login(:'b','dueno-b@x.com'); select public.crear_organizacion('Inmobiliaria B') as org_b \gset
reset role;
insert into public.miembros (org_id, user_id, email, rol, nombre) values
  (:'org_a', :'ad', 'admin-a@x.com', 'administrador', 'Adri Admin'), (:'org_a', :'ag', 'agente-a@x.com', 'agente', 'Gabo Agente'),
  (:'org_a', :'ag2', 'agente2-a@x.com', 'agente', 'Otra Agente'), (:'org_a', :'l', 'lector-a@x.com', 'lector', 'Lucho');
select test.login(:'a','dueno-a@x.com');
insert into public.crm_proyectos (org_id, slug, nombre) values (:'org_a', 'torre-alba', 'Torre Alba');
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre-alba","codigo":"A-101","area_m2":85.5,"dormitorios":2,"precio":120000}')) ->> 'id' as u1 \gset
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre-alba","codigo":"P-01","tipo":"parqueo","precio":8000}')) ->> 'id' as u2 \gset
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre-alba","codigo":"A-102","precio":100000,"estado":"reservada"}')) ->> 'id' as u3 \gset
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre-alba","codigo":"A-103"}')) ->> 'id' as u4 \gset
select (public.crm_crear_lead(:'org_a', 'Lucía Mora', '0991111111', 'lucia@x.com', 'torre-alba', null, null, 'whatsapp', 'agente-a@x.com')) ->> 'oportunidad_id' as op1 \gset
select (public.crm_crear_lead(:'org_a', 'Pedro Paz', '0992222222', null, 'torre-alba', null, null, 'whatsapp', 'agente2-a@x.com')) ->> 'oportunidad_id' as op2 \gset

-- 1. Cálculo (el mismo que la app; cifras verificadas también en e2e/cotizar.test.mjs) --------------
select public.cotizacion_calcular(128000, 3000, 'credito', 30, 2500, 12, 9.5, 20) as k \gset
select test.assert((:'k'::jsonb ->> 'precio_final')::numeric = 125000 and (:'k'::jsonb ->> 'entrada')::numeric = 37500 and (:'k'::jsonb ->> 'reserva')::numeric = 2500
                   and (:'k'::jsonb ->> 'cuota_entrada')::numeric = 2916.67 and (:'k'::jsonb ->> 'saldo')::numeric = 87500 and (:'k'::jsonb ->> 'cuota_mensual')::numeric = 815.61,
                   'crédito: 125.000 final, entrada 37.500, reserva 2.500, 12 cuotas de 2.916,67, saldo 87.500, cuota 815,61 (9,5 % a 20 años)');
select test.assert((public.cotizacion_calcular(100000, 0, 'contado', 10, 20000, 0, 9.5, 20) ->> 'entrada')::numeric = 20000, 'si la reserva supera la entrada, la entrada sube a la reserva');
select test.assert((public.cotizacion_calcular(100000, 0, 'contado', 10, 1000, 0, 9.5, 20) ->> 'cuota_mensual') is null, 'de contado no hay cuota mensual');
select test.assert((public.cotizacion_calcular(120000, 0, 'credito', 20, 0, 6, 0, 10) ->> 'cuota_mensual')::numeric = 800, 'con tasa 0 la cuota es saldo / meses');
select test.assert(public.crm_dinero(118000.5) = '$118.000,50' and public.crm_dinero(0) = '$0,00', 'el dinero se escribe como en Ecuador');

-- 2. Proforma para un lead existente (agente con su lead) -----------------------------------------
select test.login(:'ag','agente-a@x.com');
select public.crear_cotizacion(:'org_a', jsonb_build_object('oportunidad_id', :'op1', 'proyecto', 'torre-alba', 'unidades', jsonb_build_array(:'u1', :'u2'),
  'descuento', 3000, 'forma_pago', 'credito', 'entrada_pct', 30, 'reserva', 2500, 'cuotas_entrada', 12, 'tasa_anual', 9.5, 'plazo_anios', 20,
  'notas', 'Incluye parqueo', 'cliente', jsonb_build_object('identificacion', '1712345678'))) as q \gset
select test.assert((:'q'::jsonb ->> 'numero') = 'TORR-0001', 'número correlativo con prefijo del proyecto (TORR-0001)');
select test.assert((:'q'::jsonb ->> 'precio_lista')::numeric = 128000 and (:'q'::jsonb ->> 'precio_final')::numeric = 125000 and (:'q'::jsonb ->> 'cuota_mensual')::numeric = 815.61, 'el servidor calcula precio y cuota');
select test.assert((:'q'::jsonb ->> 'cliente_nombre') = 'Lucía Mora' and (:'q'::jsonb ->> 'cliente_telefono') = '0991111111' and (:'q'::jsonb ->> 'cliente_identificacion') = '1712345678', 'toma los datos del cliente desde su lead (y la cédula escrita)');
select test.assert(jsonb_array_length(:'q'::jsonb -> 'unidades') = 2 and (:'q'::jsonb -> 'unidades' -> 0 ->> 'codigo') = 'A-101', 'guarda una foto fija de las unidades (la más cara primero)');
select test.assert((:'q'::jsonb ->> 'asesor_nombre') = 'Gabo Agente' and (:'q'::jsonb ->> 'vigencia_hasta')::date = current_date + 15, 'firma el asesor y vence en 15 días');
select test.assert(length(:'q'::jsonb ->> 'token') = 64, 'tiene un enlace privado de 64 caracteres');
select test.assert((select etapa = 'proforma' and valor_estimado = 125000 and proforma_numero = 'TORR-0001' and unidad_interes = 'A-101, P-01' from public.crm_oportunidades where id = :'op1'),
                   'el lead pasa a «proforma» con el valor, el número y las unidades');
select test.assert((select count(*) = 1 from public.crm_actividades where oportunidad_id = :'op1' and tipo = 'sistema' and contenido like 'Proforma TORR-0001: A-101, P-01 · $125.000,00 · cuota estimada $815,61/mes'),
                   'y su línea de tiempo lo registra');
select test.assert((select estado = 'disponible' from public.crm_unidades where id = :'u1'), 'una proforma no reserva la unidad');
select public.crear_cotizacion(:'org_a', jsonb_build_object('oportunidad_id', :'op1', 'proyecto', 'torre-alba', 'unidades', jsonb_build_array(:'u1'))) as q2 \gset
select test.assert((:'q2'::jsonb ->> 'numero') = 'TORR-0002' and (:'q2'::jsonb ->> 'entrada_pct')::numeric = 30 and (:'q2'::jsonb ->> 'reserva')::numeric = 2400
                   and (:'q2'::jsonb ->> 'cuotas_entrada')::int = 12, 'sin condiciones usa las del proyecto (30 % de entrada, reserva 2 % = 2.400, 12 cuotas)');

-- 3. Reglas ----------------------------------------------------------------------------------------
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u1' || $$"],"descuento":10000}') $$, 'un agente no pasa su descuento máximo');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op2' || $$","proyecto":"torre-alba","unidades":["$$ || :'u1' || $$"]}') $$, 'un agente no cotiza el lead de otro agente');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u3' || $$"]}') $$, 'no se cotiza una unidad reservada');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u4' || $$"]}') $$, 'no se cotiza una unidad sin precio');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":[]}') $$, 'hace falta al menos una unidad');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u1' || $$"],"forma_pago":"trueque"}') $$, 'forma de pago no válida');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u1' || $$"],"plazo_anios":40}') $$, 'plazo fuera de rango');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u1' || $$"],"tasa_anual":"abc"}') $$, 'valores que no son números');
select test.login(:'ad','admin-a@x.com');
select (public.crear_cotizacion(:'org_a', jsonb_build_object('oportunidad_id', :'op2', 'proyecto', 'torre-alba', 'unidades', jsonb_build_array(:'u1'), 'descuento', 12000, 'forma_pago', 'contado'))) ->> 'numero' as n3 \gset
select test.assert(:'n3' = 'TORR-0003', 'un administrador da descuentos mayores y cotiza cualquier lead');
select test.login(:'l','lector-a@x.com');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u1' || $$"]}') $$, 'un lector no hace proformas');
select test.assert((select count(*) = 3 from public.crm_cotizaciones), 'un lector sí ve las proformas');
select test.login(:'ag','agente-a@x.com');
select test.assert((select count(*) = 2 from public.crm_cotizaciones), 'un agente solo ve las proformas de sus leads');
select test.login(:'b','dueno-b@x.com');
select test.assert((select count(*) = 0 from public.crm_cotizaciones), 'otra empresa no ve mis proformas');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u1' || $$"]}') $$, 'otra empresa no hace proformas en la mía');
select test.login(:'a','dueno-a@x.com');
select test.falla($$ insert into public.crm_cotizaciones (org_id, numero, proyecto, oportunidad_id, cliente_nombre, unidades, precio_lista, precio_final, forma_pago, entrada_pct, entrada, reserva, cuotas_entrada, cuota_entrada, saldo, vigencia_hasta)
                     values ('$$ || :'org_a' || $$', 'X-1', 'torre-alba', '$$ || :'op1' || $$', 'X', '[]', 1, 1, 'contado', 0, 0, 0, 0, 0, 0, current_date) $$, 'no se fabrican proformas directo en la tabla');

-- 4. Cliente nuevo (sin duplicar) ---------------------------------------------------------------------
select test.login(:'ag','agente-a@x.com');
select public.crear_cotizacion(:'org_a', jsonb_build_object('proyecto', 'torre-alba', 'unidades', jsonb_build_array(:'u2'),
  'cliente', jsonb_build_object('nombre', 'Marta Ríos', 'telefono', '099 333 3333', 'correo', 'marta@x.com'))) as q4 \gset
select test.assert((select c.nombre = 'Marta Ríos' and o.asignado_a = 'agente-a@x.com' and o.etapa = 'proforma' and o.fuente = 'oficina'
                    from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where o.id = (:'q4'::jsonb ->> 'oportunidad_id')::uuid),
                   'un cliente nuevo se crea como lead del agente, ya en «proforma»');
select public.crear_cotizacion(:'org_a', jsonb_build_object('proyecto', 'torre-alba', 'unidades', jsonb_build_array(:'u2'),
  'cliente', jsonb_build_object('nombre', 'Marta R.', 'telefono', '+593 99 333 3333'))) as q5 \gset
select test.assert((:'q5'::jsonb ->> 'oportunidad_id') = (:'q4'::jsonb ->> 'oportunidad_id') and (:'q5'::jsonb ->> 'cliente_nombre') = 'Marta Ríos', 'el mismo teléfono no duplica el cliente: usa su lead y su nombre');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"proyecto":"torre-alba","unidades":["$$ || :'u2' || $$"],"cliente":{"nombre":"Pedro Paz","telefono":"0992222222"}}') $$, 'si el cliente ya lo atiende otro asesor, se avisa');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"proyecto":"torre-alba","unidades":["$$ || :'u2' || $$"],"cliente":{"nombre":"Sin Teléfono"}}') $$, 'un cliente nuevo necesita teléfono');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"proyecto":"torre-alba","unidades":["$$ || :'u2' || $$"],"cliente":{"nombre":"X","telefono":"0994444444"}}') $$, 'y nombre');

-- 5. Configuración -------------------------------------------------------------------------------------
select test.falla($$ select public.guardar_config_cotizador('$$ || :'org_a' || $$', 'torre-alba', '{"entrada_pct":20}') $$, 'un agente no cambia la configuración');
select test.login(:'ad','admin-a@x.com');
select public.guardar_config_cotizador(:'org_a', 'torre-alba', '{"prefijo":"ta","entrada_pct":20,"reserva_tipo":"monto","reserva_valor":1500,"cuotas_entrada":6,"tasa_anual":8.75,"plazo_anios":25,"descuento_max_pct":2,"vigencia_dias":30,"whatsapp":"+593 99 555 5555","condiciones":"Precios sujetos a cambio."}') as cfg \gset
select test.assert((:'cfg'::jsonb ->> 'prefijo') = 'TA' and (:'cfg'::jsonb ->> 'whatsapp') = '593995555555' and (:'cfg'::jsonb ->> 'ultimo_numero')::int = 5, 'guarda la configuración (prefijo en mayúsculas, WhatsApp solo dígitos) sin reiniciar el contador');
select test.falla($$ select public.guardar_config_cotizador('$$ || :'org_a' || $$', 'torre-alba', '{"entrada_pct":120}') $$, 'valores fuera de rango');
select test.falla($$ select public.guardar_config_cotizador('$$ || :'org_a' || $$', 'torre-alba', '{"prefijo":"MUY-LARGO"}') $$, 'prefijo no válido');
select test.login(:'ag','agente-a@x.com');
select public.crear_cotizacion(:'org_a', jsonb_build_object('oportunidad_id', :'op1', 'proyecto', 'torre-alba', 'unidades', jsonb_build_array(:'u1'))) as q6 \gset
select test.assert((:'q6'::jsonb ->> 'numero') = 'TA-0006' and (:'q6'::jsonb ->> 'reserva')::numeric = 1500 and (:'q6'::jsonb ->> 'entrada')::numeric = 24000
                   and (:'q6'::jsonb ->> 'cuotas_entrada')::int = 6 and (:'q6'::jsonb ->> 'plazo_anios')::int = 25 and (:'q6'::jsonb ->> 'condiciones') = 'Precios sujetos a cambio.',
                   'la proforma siguiente usa la nueva configuración (TA-0006, reserva fija, 20 %, 6 cuotas, 25 años, condiciones)');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u1' || $$"],"descuento":2500}') $$, 'el nuevo tope de descuento (2 %) se aplica');

-- 6. Enlace privado para el cliente -----------------------------------------------------------------
reset role;
insert into public.org_marca (org_id, nombre_comercial, color_primario, logo_path, mostrar_pie_gpunlock) values (:'org_a', 'Andes Propiedades', '#1E4FD8', :'org_a' || '/logo-1.png', false);
select test.anon();
select public.cotizacion_publica(:'q'::jsonb ->> 'token') as pub \gset
select test.assert((:'pub'::jsonb ->> 'numero') = 'TORR-0001' and (:'pub'::jsonb ->> 'empresa') = 'Andes Propiedades' and (:'pub'::jsonb ->> 'color_primario') = '#1E4FD8'
                   and (:'pub'::jsonb ->> 'logo_path') like '%logo-1.png' and (:'pub'::jsonb ->> 'proyecto') = 'Torre Alba', 'el enlace muestra la proforma con la marca y los datos de la inmobiliaria');
select test.assert((:'pub'::jsonb ->> 'cuota_mensual')::numeric = 815.61 and (:'pub'::jsonb ->> 'vigente')::boolean and (:'pub'::jsonb ->> 'whatsapp') = '593995555555', 'con los montos, la vigencia y el WhatsApp del proyecto');
select test.assert(not (:'pub'::jsonb ? 'cliente_telefono') and not (:'pub'::jsonb ? 'cliente_correo') and not (:'pub'::jsonb ? 'cliente_identificacion') and not (:'pub'::jsonb ? 'token') and not (:'pub'::jsonb ? 'org_id'),
                   'sin teléfono, correo ni cédula del cliente, ni ids internos');
select test.assert(public.cotizacion_publica('abc') is null and public.cotizacion_publica(repeat('0', 64)) is null, 'un token inválido o inexistente no devuelve nada');
select test.falla($$ select * from public.crm_cotizaciones $$, 'la tabla sigue cerrada para la web');

-- 7. Anular -----------------------------------------------------------------------------------------------
select test.login(:'ag2','agente2-a@x.com');
select test.falla($$ select public.anular_cotizacion('$$ || (:'q'::jsonb ->> 'id') || $$', 'error') $$, 'otro agente no anula mis proformas');
select test.login(:'ag','agente-a@x.com');
select test.falla($$ select public.anular_cotizacion('$$ || (:'q'::jsonb ->> 'id') || $$', '') $$, 'anular exige motivo');
select public.anular_cotizacion((:'q'::jsonb ->> 'id')::uuid, 'Cliente pidió otra unidad');
select test.assert((select estado = 'anulada' and anulada_motivo = 'Cliente pidió otra unidad' from public.crm_cotizaciones where id = (:'q'::jsonb ->> 'id')::uuid), 'quien la hizo la anula con motivo');
select test.falla($$ select public.anular_cotizacion('$$ || (:'q'::jsonb ->> 'id') || $$', 'otra vez') $$, 'no se anula dos veces');
select test.anon();
select test.assert((public.cotizacion_publica(:'q'::jsonb ->> 'token') ->> 'anulada')::boolean and public.cotizacion_publica(:'q'::jsonb ->> 'token') ->> 'precio_final' is null, 'el enlace de una anulada solo dice que fue anulada');

-- 8. Vencida, fotos y web pública ------------------------------------------------------------------------
reset role;
update public.organizaciones set estado = 'vencida' where id = :'org_a';
select test.login(:'ag','agente-a@x.com');
select test.falla($$ select public.crear_cotizacion('$$ || :'org_a' || $$', '{"oportunidad_id":"$$ || :'op1' || $$","proyecto":"torre-alba","unidades":["$$ || :'u1' || $$"]}') $$, 'con la suscripción vencida no se hacen proformas');
reset role;
update public.organizaciones set estado = 'activa', periodo_hasta = now() + interval '30 days' where id = :'org_a';
select test.login(:'a','dueno-a@x.com');
insert into storage.objects (bucket_id, name) values ('inventario', :'org_a' || '/' || :'u1' || '/foto-1.jpg'), ('inventario', :'org_a' || '/' || :'u1' || '/foto-2.webp');
select test.assert((select count(*) = 2 from storage.objects where bucket_id = 'inventario'), 'el propietario sube fotos a la carpeta de su unidad');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('inventario', '$$ || :'org_b' || $$/$$ || :'u1' || $$/x.jpg') $$, 'no se sube a la carpeta de otra empresa');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('inventario', '$$ || :'org_a' || $$/00000000-0000-0000-0000-000000000000/x.jpg') $$, 'ni a una unidad que no existe');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('inventario', '$$ || :'org_a' || $$/$$ || :'u1' || $$/x.svg') $$, 'ni archivos que no son imagen');
select public.guardar_fotos_unidad(:'u1', array[:'org_a' || '/' || :'u1' || '/foto-2.webp', :'org_a' || '/' || :'u1' || '/foto-1.jpg']);
select test.assert((select fotos[1] like '%foto-2.webp' and array_length(fotos, 1) = 2 from public.crm_unidades where id = :'u1'), 'guarda las fotos en el orden elegido (la primera es la portada)');
select test.falla($$ select public.guardar_fotos_unidad('$$ || :'u1' || $$', array['$$ || :'org_a' || $$/$$ || :'u1' || $$/no-subida.jpg']) $$, 'una foto que no se subió no se guarda');
select test.falla($$ select public.guardar_fotos_unidad('$$ || :'u1' || $$', array['$$ || :'org_a' || $$/$$ || :'u2' || $$/foto-1.jpg']) $$, 'una foto de otra unidad no se guarda');
select test.login(:'ag','agente-a@x.com');
select test.falla($$ select public.guardar_fotos_unidad('$$ || :'u1' || $$', '{}') $$, 'un agente no cambia las fotos');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('inventario', '$$ || :'org_a' || $$/$$ || :'u1' || $$/y.jpg') $$, 'ni las sube');
reset role;
select clave_publica as clave_a from public.organizaciones where id = :'org_a' \gset
select test.anon();
select test.assert(exists (select 1 from jsonb_array_elements((public.inventario_publico(:'clave_a')) -> 'unidades') e where e ->> 'codigo' = 'A-101' and jsonb_array_length(e -> 'fotos') = 2),
                   'la web pública recibe las fotos de cada unidad');
select test.login(:'a','dueno-a@x.com');
select (public.crear_cotizacion(:'org_a', jsonb_build_object('oportunidad_id', :'op1', 'proyecto', 'torre-alba', 'unidades', jsonb_build_array(:'u1')))) -> 'unidades' -> 0 ->> 'foto' as foto \gset
select test.assert(:'foto' like '%foto-2.webp', 'la proforma guarda la portada de la unidad');
reset role;
select test.assert(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crm_cotizaciones') or not exists (select 1 from pg_publication where pubname = 'supabase_realtime'),
                   'crm_cotizaciones está en la publicación de tiempo real');
