-- Embudo premium: tiempos del lead (primera respuesta), configuración, automatización por etapa, búsqueda y matching, métricas.
\set ON_ERROR_STOP on
\set a  '00000000-0000-0000-0000-0000000000b1'
\set ag '00000000-0000-0000-0000-0000000000b2'
\set ag2 '00000000-0000-0000-0000-0000000000b3'
\set b  '00000000-0000-0000-0000-0000000000b4'
insert into auth.users (id, email) values (:'a','dueno-a@x.com'), (:'ag','agente-a@x.com'), (:'ag2','agente2-a@x.com'), (:'b','dueno-b@x.com');
select test.login(:'a','dueno-a@x.com'); select public.crear_organizacion('Inmobiliaria A') as org_a \gset
select test.login(:'b','dueno-b@x.com'); select public.crear_organizacion('Inmobiliaria B') as org_b \gset
reset role;
insert into public.miembros (org_id, user_id, email, rol) values (:'org_a', :'ag', 'agente-a@x.com', 'agente'), (:'org_a', :'ag2', 'agente2-a@x.com', 'agente');
select test.login(:'a','dueno-a@x.com');
insert into public.crm_proyectos (org_id, slug, nombre) values (:'org_a', 'torre', 'Torre Alba'), (:'org_a', 'valle', 'Valle Verde');
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre","codigo":"A-1","tipo":"departamento","dormitorios":2,"precio":100000}')) ->> 'id' as u1 \gset
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre","codigo":"A-2","tipo":"departamento","dormitorios":3,"precio":150000}')) ->> 'id' as u2 \gset
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre","codigo":"S-1","tipo":"suite","dormitorios":1,"precio":70000}')) ->> 'id' as u3 \gset
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"valle","codigo":"L-1","tipo":"lote","precio":40000}')) ->> 'id' as u4 \gset
select (public.guardar_unidad(:'org_a', null, '{"proyecto":"torre","codigo":"A-3","tipo":"departamento","dormitorios":2,"precio":105000,"estado":"vendida"}')) ->> 'id' as u5 \gset

-- 1. Tiempos del lead ----------------------------------------------------------------------------
reset role;
select (public.crm_alta_lead(:'org_a', 'Lucía Mora', '0991111111', null, 'torre', null, 'Hola, quiero info', 'formulario_web', 'web', 'agente-a@x.com', 'web')) ->> 'oportunidad_id' as op1 \gset
select test.assert((select etapa_desde is not null and primera_respuesta_at is null and ultima_actividad_at is null from public.crm_oportunidades where id = :'op1'),
                   'un lead nuevo empieza sin respuesta (el mensaje del cliente no cuenta como respuesta)');
update public.crm_oportunidades set created_at = now() - interval '20 minutes', etapa_desde = now() - interval '20 minutes' where id = :'op1';
select test.login(:'ag','agente-a@x.com');
insert into public.crm_actividades (oportunidad_id, tipo, contenido, vence_at, creado_por) values (:'op1', 'tarea', 'Llamar mañana', now() + interval '1 day', 'agente-a@x.com');
select test.assert((select primera_respuesta_at is null and ultima_actividad_at is not null from public.crm_oportunidades where id = :'op1'), 'agendar una tarea es actividad, pero no es responder al cliente');
insert into public.crm_actividades (oportunidad_id, tipo, contenido, creado_por) values (:'op1', 'whatsapp', 'Le escribí por WhatsApp', 'agente-a@x.com');
select test.assert((select primera_respuesta_at between now() - interval '1 minute' and now() + interval '1 minute' from public.crm_oportunidades where id = :'op1'), 'un WhatsApp del asesor marca la primera respuesta');
select primera_respuesta_at as pr1 from public.crm_oportunidades where id = :'op1' \gset
insert into public.crm_actividades (oportunidad_id, tipo, contenido, creado_por) values (:'op1', 'llamada', 'Llamé', 'agente-a@x.com');
select test.assert((select primera_respuesta_at = :'pr1'::timestamptz from public.crm_oportunidades where id = :'op1'), 'la primera respuesta no cambia con las siguientes');
update public.crm_oportunidades set primera_respuesta_at = now() - interval '1 year', ultima_actividad_at = now() + interval '1 year' where id = :'op1';
select test.assert((select primera_respuesta_at = :'pr1'::timestamptz and ultima_actividad_at < now() + interval '1 day' from public.crm_oportunidades where id = :'op1'),
                   'nadie maquilla sus tiempos desde la app (el cambio se ignora)');
select etapa_desde as ed from public.crm_oportunidades where id = :'op1' \gset
update public.crm_oportunidades set etapa = 'contactado' where id = :'op1';
select test.assert((select etapa_desde > :'ed'::timestamptz from public.crm_oportunidades where id = :'op1'), 'cambiar de etapa marca desde cuándo está en ella');

-- 2. Configuración del embudo --------------------------------------------------------------------
select test.assert((public.crm_config_ventas(:'org_a') -> 'etapas' -> 'cita' ->> 'probabilidad')::int = 25 and (public.crm_config_ventas(:'org_a') ->> 'sla_minutos')::int = 15, 'valores por defecto: cita 25 %, responder en 15 minutos');
select test.falla($$ select public.guardar_config_ventas('$$ || :'org_a' || $$', 10, '{}') $$, 'un agente no cambia la configuración');
select test.login(:'a','dueno-a@x.com');
select public.guardar_config_ventas(:'org_a', 10, '{"cita":{"probabilidad":30,"dias_alerta":4},"proforma":{"probabilidad":55,"dias_alerta":null}}');
select test.assert((public.crm_config_ventas(:'org_a') -> 'etapas' -> 'cita' ->> 'probabilidad')::int = 30 and (public.crm_config_ventas(:'org_a') -> 'etapas' -> 'reserva' ->> 'probabilidad')::int = 85
                   and (public.crm_config_ventas(:'org_a') -> 'etapas' -> 'proforma' -> 'dias_alerta') = 'null'::jsonb, 'guarda lo que cambia y conserva el resto por defecto (y se puede quitar una alerta)');
select test.falla($$ select public.guardar_config_ventas('$$ || :'org_a' || $$', 10, '{"cita":{"probabilidad":120}}') $$, 'probabilidad fuera de rango');
select test.falla($$ select public.guardar_config_ventas('$$ || :'org_a' || $$', 0, '{}') $$, 'SLA fuera de rango');
select test.falla($$ select public.guardar_config_ventas('$$ || :'org_a' || $$', 10, '{"inventada":{"probabilidad":10}}') $$, 'etapa inexistente');
select test.login(:'b','dueno-b@x.com');
select test.assert(public.crm_config_ventas(:'org_a') is null, 'otra empresa no ve mi configuración');

-- 3. Automatización por etapa --------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select (public.guardar_automatizacion(:'org_a', null, 'nuevo', 'Contactar a {cliente} por WhatsApp', 15)) ->> 'id' as au1 \gset
select public.guardar_automatizacion(:'org_a', null, 'cita', 'Confirmar la visita a {proyecto} con {cliente}', 1440);
select test.falla($$ select public.guardar_automatizacion('$$ || :'org_a' || $$', null, 'cita', 'x', 10) $$, 'el texto de la tarea tiene al menos 3 letras');
select test.falla($$ select public.guardar_automatizacion('$$ || :'org_a' || $$', null, 'inexistente', 'Algo', 10) $$, 'etapa no válida');
select test.falla($$ select public.guardar_automatizacion('$$ || :'org_a' || $$', null, 'cita', 'Algo', 99999) $$, 'plazo de hasta 30 días');
select test.login(:'ag','agente-a@x.com');
select test.falla($$ select public.guardar_automatizacion('$$ || :'org_a' || $$', null, 'cita', 'Algo', 10) $$, 'un agente no crea automatizaciones');
select test.assert((select count(*) = 2 from public.crm_automatizaciones), 'un agente sí las ve');
select (public.crm_crear_lead(:'org_a', 'Pedro Paz', '0992222222', null, 'torre', null, null, 'whatsapp', null)) ->> 'oportunidad_id' as op2 \gset
select test.assert((select count(*) = 1 from public.crm_actividades where oportunidad_id = :'op2' and tipo = 'tarea' and creado_por = 'sistema'
                    and contenido = 'Contactar a Pedro Paz por WhatsApp' and vence_at between now() + interval '14 minutes' and now() + interval '16 minutes'),
                   'al llegar un lead nuevo se crea la tarea con su nombre y vence en 15 minutos');
update public.crm_oportunidades set etapa = 'cita' where id = :'op2';
select test.assert((select count(*) = 1 from public.crm_actividades where oportunidad_id = :'op2' and tipo = 'tarea' and contenido = 'Confirmar la visita a Torre Alba con Pedro Paz'), 'al pasar a «cita» se crea su tarea con el proyecto');
update public.crm_oportunidades set ia_resumen = 'x' where id = :'op2';
select test.assert((select count(*) = 2 from public.crm_actividades where oportunidad_id = :'op2' and tipo = 'tarea'), 'editar otro dato no vuelve a disparar la automatización');
select test.assert((select primera_respuesta_at is null from public.crm_oportunidades where id = :'op2'), 'las tareas automáticas no cuentan como respuesta');
select test.login(:'a','dueno-a@x.com');
select public.guardar_automatizacion(:'org_a', :'au1', 'nuevo', 'Contactar a {cliente} por WhatsApp', 15, false);
select (public.crm_crear_lead(:'org_a', 'Sin Tarea', '0993333333', null, 'torre', null, null, 'whatsapp', null)) ->> 'oportunidad_id' as op3 \gset
select test.assert((select count(*) = 0 from public.crm_actividades where oportunidad_id = :'op3' and tipo = 'tarea'), 'una automatización desactivada no crea tareas');
select public.eliminar_automatizacion(:'au1');
select test.assert((select count(*) = 1 from public.crm_automatizaciones), 'se elimina');
select test.login(:'b','dueno-b@x.com');
select test.assert((select count(*) = 0 from public.crm_automatizaciones), 'otra empresa no ve mis automatizaciones');

-- 4. Lo que busca el cliente y el matching ----------------------------------------------------------
select test.login(:'ag2','agente2-a@x.com');
select test.falla($$ select public.guardar_busqueda('$$ || :'op1' || $$', '{"tipos":["departamento"]}') $$, 'un agente no edita la búsqueda del lead de otro agente');
select test.login(:'ag','agente-a@x.com');
select public.guardar_busqueda(:'op1', '{"proyecto":"torre","tipos":["departamento"],"dormitorios_min":2,"precio_max":"110000","notas":"Piso alto"}');
select test.falla($$ select public.guardar_busqueda('$$ || :'op1' || $$', '{"tipos":["castillo"]}') $$, 'tipo no válido');
select test.falla($$ select public.guardar_busqueda('$$ || :'op1' || $$', '{"precio_min":200,"precio_max":100}') $$, 'presupuesto mínimo mayor al máximo');
select public.unidades_sugeridas(:'op1') as sug \gset
select test.assert((:'sug'::jsonb -> 0 ->> 'codigo') = 'A-1' and (:'sug'::jsonb -> 0 ->> 'puntaje')::int = 100, 'A-1 calza perfecto (proyecto, tipo, precio y dormitorios): 100');
select test.assert(not exists (select 1 from jsonb_array_elements(:'sug'::jsonb) e where e ->> 'codigo' in ('A-3', 'L-1')), 'no sugiere vendidas ni lo que no calza');
select test.assert(exists (select 1 from jsonb_array_elements(:'sug'::jsonb) e where e ->> 'codigo' = 'A-2' and (e ->> 'puntaje')::int = 70), 'A-2 calza en parte (se pasa del presupuesto): 70');
select test.assert(not (:'sug'::jsonb -> 0 ? 'org_id'), 'sin datos internos');
select public.leads_para_unidad(:'u1') as int1 \gset
select test.assert((:'int1'::jsonb -> 0 ->> 'nombre') = 'Lucía Mora' and (:'int1'::jsonb -> 0 ->> 'puntaje')::int = 100, 'en la unidad A-1 aparece Lucía como interesada');
select test.login(:'ag2','agente2-a@x.com');
select test.assert(jsonb_array_length(public.leads_para_unidad(:'u1')) = 0, 'otro agente no ve a los clientes que no son suyos');
select test.login(:'a','dueno-a@x.com');
select test.assert(jsonb_array_length(public.leads_para_unidad(:'u1')) = 1, 'el propietario sí');
update public.crm_oportunidades set etapa = 'perdido', motivo_perdida = 'Precio' where id = :'op1';
select test.assert(jsonb_array_length(public.leads_para_unidad(:'u1')) = 0, 'un lead cerrado ya no aparece como interesado');
update public.crm_oportunidades set etapa = 'contactado' where id = :'op1';
select public.guardar_busqueda(:'op2', '{}');
select test.assert(jsonb_array_length(public.unidades_sugeridas(:'op2')) = 0, 'sin criterios no se sugiere nada (no basta el proyecto)');
select test.login(:'b','dueno-b@x.com');
select test.assert((select count(*) = 0 from public.crm_busquedas) and jsonb_array_length(public.unidades_sugeridas(:'op1')) = 0, 'otra empresa no ve búsquedas ni sugerencias ajenas');

-- 5. Métricas ---------------------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
update public.crm_oportunidades set valor_estimado = 100000 where id = :'op1';
update public.crm_oportunidades set valor_estimado = 200000 where id = :'op2';
select public.crm_metricas_ventas(:'org_a') as m \gset
select test.assert((:'m'::jsonb -> 'primera_respuesta' ->> 'respondidos')::int = 1 and (:'m'::jsonb -> 'primera_respuesta' ->> 'mediana_min')::numeric between 19 and 21,
                   'primera respuesta: 1 lead respondido en ~20 minutos');
select test.assert((:'m'::jsonb -> 'primera_respuesta' ->> 'en_sla_pct')::int = 0 and (:'m'::jsonb ->> 'sla_minutos')::int = 10, 'fuera del SLA de 10 minutos');
select test.assert((:'m'::jsonb ->> 'sin_responder')::int = 2, 'dos leads abiertos sin responder');
select test.assert((:'m'::jsonb ->> 'valor_abierto')::numeric = 300000 and (:'m'::jsonb ->> 'valor_ponderado')::numeric = 70000, 'valor ponderado: 100.000 × 10 % + 200.000 × 30 % = 70.000');
select test.assert((:'m'::jsonb -> 'por_asesor' -> 0 ->> 'email') = 'agente-a@x.com', 'tiempo de respuesta por asesor');
reset role;
update public.crm_oportunidades set etapa_desde = now() - interval '10 days', ultima_actividad_at = now() - interval '10 days', created_at = now() - interval '10 days' where id = :'op2';
select test.login(:'a','dueno-a@x.com');
select test.assert((public.crm_metricas_ventas(:'org_a') ->> 'estancados')::int = 1, 'un lead en «cita» 10 días sin actividad cuenta como estancado (alerta a los 4 días)');
select test.login(:'b','dueno-b@x.com');
select test.falla($$ select public.crm_metricas_ventas('$$ || :'org_a' || $$') $$, 'otra empresa no ve mis métricas');
