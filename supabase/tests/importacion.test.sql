-- Importar la cartera: validación todo-o-nada, sin duplicar, reparto, límites del plan, automatizaciones y deshacer.
\set ON_ERROR_STOP on
\set a  '00000000-0000-0000-0000-0000000000a7'
\set ag '00000000-0000-0000-0000-0000000000a8'
\set ag2 '00000000-0000-0000-0000-0000000000a9'
\set b  '00000000-0000-0000-0000-0000000000aa'
insert into auth.users (id, email) values (:'a','dueno-a@x.com'), (:'ag','agente-a@x.com'), (:'ag2','agente2-a@x.com'), (:'b','dueno-b@x.com');
select test.login(:'a','dueno-a@x.com'); select public.crear_organizacion('Inmobiliaria A') as org_a \gset
select test.login(:'b','dueno-b@x.com'); select public.crear_organizacion('Inmobiliaria B') as org_b \gset
reset role;
insert into public.miembros (org_id, user_id, email, rol) values (:'org_a', :'ag', 'agente-a@x.com', 'agente'), (:'org_a', :'ag2', 'agente2-a@x.com', 'agente');
select test.login(:'a','dueno-a@x.com');
insert into public.crm_proyectos (org_id, slug, nombre) values (:'org_a', 'torre', 'Torre Alba');
select public.guardar_automatizacion(:'org_a', null, 'nuevo', 'Contactar a {cliente}', 15);
select (public.crm_crear_lead(:'org_a', 'Cliente Previo', '0991111111', null, 'torre', null, null, 'whatsapp', 'agente-a@x.com')) ->> 'oportunidad_id' as op0 \gset

-- 1. Quién puede ---------------------------------------------------------------------------------
select test.login(:'ag','agente-a@x.com');
select test.falla($$ select public.importar_leads('$$ || :'org_a' || $$', 'x.csv', '[{"nombre":"Ana","telefono":"0992222222"}]') $$, 'un agente no importa la cartera');
select test.login(:'b','dueno-b@x.com');
select test.falla($$ select public.importar_leads('$$ || :'org_a' || $$', 'x.csv', '[{"nombre":"Ana","telefono":"0992222222"}]') $$, 'otra empresa no importa en la mía');

-- 2. Validación todo o nada ------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select public.importar_leads(:'org_a', 'malo.csv', '[
  {"fila":2,"nombre":"Ok Uno","telefono":"0993333333"},
  {"fila":3,"nombre":"X","telefono":"0994444444"},
  {"fila":4,"nombre":"Sin Contacto"},
  {"fila":5,"nombre":"Tel Malo","telefono":"123"},
  {"fila":6,"nombre":"Correo Malo","correo":"no-es-correo"},
  {"fila":7,"nombre":"Proy Malo","telefono":"0995555555","proyecto":"nada"},
  {"fila":8,"nombre":"Etapa Mala","telefono":"0996666666","etapa":"ganado"},
  {"fila":9,"nombre":"Asesor Malo","telefono":"0997777777","asignado":"nadie@x.com"},
  {"fila":10,"nombre":"Valor Malo","telefono":"0998888888","valor":"mucho"},
  {"fila":11,"nombre":"Repetido","telefono":"099 333 3333"}
]'::jsonb) as r \gset
select test.assert(not (:'r'::jsonb ->> 'ok')::boolean and (:'r'::jsonb ->> 'total_errores')::int = 9, 'con errores devuelve los 9 y no guarda nada');
select test.assert((select string_agg(e ->> 'error', ' | ' order by (e ->> 'fila')::int) from jsonb_array_elements(:'r'::jsonb -> 'errores') e) =
  'Falta el nombre (de 2 a 120 letras) | Falta el teléfono o el correo | Teléfono no válido | Correo no válido | El proyecto no existe | Etapa no válida | El asesor no está en tu equipo | El valor no es un número | Cliente repetido en el archivo',
  'cada error con su motivo');
select test.assert((select count(*) = 1 from public.crm_oportunidades) and (select count(*) = 0 from public.crm_importaciones), 'todo o nada: no se creó ningún lead ni importación');
select test.falla($$ select public.importar_leads('$$ || :'org_a' || $$', 'x', '[]') $$, 'un archivo vacío no se importa');
select test.falla($$ select public.importar_leads('$$ || :'org_a' || $$', 'x', (select jsonb_agg(jsonb_build_object('nombre','N ' || g,'telefono','09' || lpad(g::text, 8, '0'))) from generate_series(1, 2001) g)) $$, 'máximo 2.000 filas');
select test.falla($$ select public.importar_leads('$$ || :'org_a' || $$', 'x', '[{"nombre":"Ana","telefono":"0992222222"}]', '{"asignado":"nadie@x.com"}') $$, 'el asesor por defecto debe ser del equipo');

-- 3. Importar --------------------------------------------------------------------------------------
select public.importar_leads(:'org_a', 'cartera-kommo.xlsx', '[
  {"fila":2,"nombre":"Lucía Mora","telefono":"0992222222","correo":"LUCIA@x.com","etapa":"cita","valor":"120000","nota":"Quiere piso alto","unidad":"A-101","fuente":"facebook"},
  {"fila":3,"nombre":"Pedro Paz","correo":"pedro@x.com","asignado":"AGENTE2-a@x.com"},
  {"fila":4,"nombre":"Cliente Previo","telefono":"+593 99 111 1111"},
  {"fila":5,"nombre":"Marta Ríos","telefono":"0994444444","etapa":"perdido"},
  {"fila":6,"nombre":"Juan Uno","telefono":"0995555555"},
  {"fila":7,"nombre":"Juan Dos","telefono":"0996666666"}
]'::jsonb, '{"proyecto":"torre","fuente":"cartera","asignado":"__repartir__"}') as r \gset
select test.assert((:'r'::jsonb ->> 'ok')::boolean and (:'r'::jsonb ->> 'creados')::int = 5 and (:'r'::jsonb ->> 'existentes')::int = 1, '5 leads nuevos y 1 que ya existía (mismo teléfono y proyecto)');
select (:'r'::jsonb ->> 'importacion_id') as imp \gset
select test.assert((select etapa = 'cita' and valor_estimado = 120000 and unidad_interes = 'A-101' and fuente = 'facebook' and proyecto = 'torre' and origen = 'importacion'
                    from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where c.nombre = 'Lucía Mora'), 'conserva etapa, valor, unidad, fuente y toma el proyecto por defecto');
select test.assert((select correo = 'lucia@x.com' from public.crm_contactos where nombre = 'Lucía Mora'), 'el correo se guarda en minúsculas');
select test.assert((select count(*) = 1 from public.crm_actividades a join public.crm_oportunidades o on o.id = a.oportunidad_id join public.crm_contactos c on c.id = o.contacto_id
                    where c.nombre = 'Lucía Mora' and a.tipo = 'nota' and a.contenido = 'Quiere piso alto'), 'la nota queda en su historial');
select test.assert((select asignado_a = 'agente2-a@x.com' from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where c.nombre = 'Pedro Paz'), 'respeta el asesor del archivo');
select test.assert((select count(distinct asignado_a) = 2 from public.crm_oportunidades where importacion_id = :'imp' and asignado_a is not null)
                   and (select count(*) = 0 from public.crm_oportunidades where importacion_id = :'imp' and asignado_a is null), 'los demás se reparten entre los agentes');
select test.assert((select motivo_perdida is not null from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where c.nombre = 'Marta Ríos'), 'un perdido importado lleva motivo');
select test.assert((select count(*) = 1 from public.crm_contactos where nombre = 'Cliente Previo'), 'no duplica al cliente que ya existía');
select test.assert((select count(*) = 0 from public.crm_actividades a join public.crm_oportunidades o on o.id = a.oportunidad_id where o.importacion_id = :'imp' and a.tipo = 'tarea'),
                   'la cartera importada no dispara tareas automáticas en masa');
select test.assert((select count(*) = 0 from public.crm_oportunidades where importacion_id = :'imp' and primera_respuesta_at is null), 'ni aparece como «sin responder»');
select test.assert((public.uso_org(:'org_a') ->> 'leads_mes')::int = 1, 'no cuenta en el límite mensual del plan (solo el lead creado a mano)');
select test.assert((select creados = 5 and existentes = 1 and archivo = 'cartera-kommo.xlsx' and por = 'dueno-a@x.com' from public.crm_importaciones where id = :'imp'), 'la importación queda registrada');
select test.assert((public.crm_metricas_ventas(:'org_a') -> 'primera_respuesta' ->> 'respondidos')::int = 0, 'la cartera no altera la medición de primera respuesta');
select test.login(:'ag','agente-a@x.com');
select test.assert((select count(*) = 0 from public.crm_importaciones), 'un agente no ve las importaciones');
select test.falla($$ select public.deshacer_importacion('$$ || :'imp' || $$') $$, 'ni las deshace');

-- 4. Deshacer -----------------------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select public.deshacer_importacion(:'imp') as d \gset
select test.assert((:'d'::jsonb ->> 'leads_borrados')::int = 5 and (:'d'::jsonb ->> 'contactos_borrados')::int = 5, 'deshacer borra los 5 leads y los 5 clientes nuevos');
select test.assert((select count(*) = 1 from public.crm_oportunidades) and (select count(*) = 1 from public.crm_contactos where nombre = 'Cliente Previo'), 'el cliente que ya existía y su lead se conservan');
select test.falla($$ select public.deshacer_importacion('$$ || :'imp' || $$') $$, 'no se deshace dos veces');
reset role;
update public.crm_importaciones set deshecha_at = null, created_at = now() - interval '8 days' where id = :'imp';
select test.login(:'a','dueno-a@x.com');
select test.falla($$ select public.deshacer_importacion('$$ || :'imp' || $$') $$, 'pasados 7 días ya no se deshace');

-- 5. Suscripción vencida -------------------------------------------------------------------------------
reset role;
update public.organizaciones set estado = 'vencida' where id = :'org_a';
select test.login(:'a','dueno-a@x.com');
select test.falla($$ select public.importar_leads('$$ || :'org_a' || $$', 'x.csv', '[{"nombre":"Ana","telefono":"0992222222"}]') $$, 'con la suscripción vencida no se importa');
