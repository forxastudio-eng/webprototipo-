-- Origen de los leads (UTM, Meta, Google) y aislamiento entre empresas.
\set ON_ERROR_STOP on
\set a  '00000000-0000-0000-0000-0000000000c1'
\set ag '00000000-0000-0000-0000-0000000000c2'
\set b  '00000000-0000-0000-0000-0000000000c3'
insert into auth.users (id, email) values (:'a','dueno-a@x.com'), (:'ag','agente-a@x.com'), (:'b','dueno-b@x.com');
select test.login(:'a','dueno-a@x.com'); select public.crear_organizacion('Org A') as org_a \gset
select test.login(:'b','dueno-b@x.com'); select public.crear_organizacion('Org B') as org_b \gset
reset role;
insert into public.miembros (org_id, user_id, email, rol) values (:'org_a', :'ag', 'agente-a@x.com', 'agente');
select clave_publica as clave_a from public.organizaciones where id = :'org_a' \gset
select clave_publica as clave_b from public.organizaciones where id = :'org_b' \gset

-- Atribución desde el formulario web --------------------------------------------------------
select test.anon();
select public.crm_registrar_lead(:'clave_a', 'Lucía Mora', '0991111111', 'lucia@x.com', 'torre-alba', 'Suite 2 dorm', 'Hola', 'torre-alba',
  null, '{"utm_source":"Instagram","utm_medium":"cpc","utm_campaign":"Torre Alba Suites","utm_content":"video1","fbclid":"IwAR123","fbp":"fb.1.1.2","evil":"x","ad_id":"  "}');
select public.crm_registrar_lead(:'clave_a', 'Andrés Vela', '0992222222', null, 'torre-alba', null, null, null, null, '{"gclid":"EAIaIQ"}');
select public.crm_registrar_lead(:'clave_a', 'Sofía Paz', '0993333333', null, 'torre-alba', null, null, null, null, null);
select public.crm_registrar_lead(:'clave_a', 'Tomás Rey', '0994444444', null, 'torre-alba', null, null, null, null, '"esto no es un objeto"');
select public.crm_registrar_lead(:'clave_b', 'Cliente de B', '0995555555', null, null, null, null, null, null, '{"utm_campaign":"campaña de B"}');
select test.assert(public.crm_registrar_lead(:'clave_a', 'Robot', '0996666666', null, null, null, null, null, 'soy un robot', null), 'el campo trampa finge éxito');
select test.falla($$ select public.crm_registrar_lead('pk_falsa', 'Alguien', '0991111111') $$, 'clave pública inválida');
reset role;
select test.assert((select count(*) = 0 from public.crm_contactos where nombre = 'Robot'), 'el robot no crea contacto');
select test.assert((select fuente = 'instagram' and utm_source = 'Instagram' and utm_campaign = 'Torre Alba Suites' and fbclid = 'IwAR123' and fbp = 'fb.1.1.2' and ad_id is null
                    from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where c.nombre = 'Lucía Mora'),
                   'utm_source=Instagram → fuente instagram; guarda campaña, fbclid y fbp; ignora claves desconocidas y vacías');
select test.assert((select fuente = 'google' and gclid = 'EAIaIQ' from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where c.nombre = 'Andrés Vela'), 'gclid → fuente google');
select test.assert((select fuente = 'formulario_web' and utm_campaign is null from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where c.nombre = 'Sofía Paz'), 'sin atribución → formulario_web');
select test.assert((select fuente = 'formulario_web' from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where c.nombre = 'Tomás Rey'), 'una atribución que no es objeto no rompe el alta');

-- El primer origen no se pisa; el cliente que vuelve no duplica la tarjeta -----------------------
select test.anon();
select public.crm_registrar_lead(:'clave_a', 'Lucía Mora', '0991111111', null, 'torre-alba', null, 'Vuelvo a escribir', null, null, '{"utm_source":"google","utm_campaign":"otra"}');
reset role;
select test.assert((select count(*) = 1 from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where c.nombre = 'Lucía Mora'), 'el mismo cliente y proyecto no duplica la oportunidad');
select test.assert((select utm_campaign = 'Torre Alba Suites' and fuente = 'instagram' from public.crm_oportunidades o join public.crm_contactos c on c.id = o.contacto_id where c.nombre = 'Lucía Mora'), 'la primera atribución se conserva');

-- Lead de Meta: el mismo leadgen_id llegando dos veces (Meta reintenta) -------------------------------
select public.crm_alta_lead(:'org_a', 'Meta Uno', '0997777777', null, 'torre-alba', null, null, 'facebook', 'meta', null, 'meta', '{"leadgen_id":"L-1","campaign_id":"C-9","adset_id":"S-9","ad_id":"A-9","form_id":"F-9"}');
select public.crm_alta_lead(:'org_a', 'Meta Uno', '0997777777', null, 'torre-alba', null, null, 'facebook', 'meta', null, 'meta', '{"leadgen_id":"L-1"}');
select public.crm_alta_lead(:'org_a', 'Otro Nombre', '0998888888', null, 'otro-proyecto', null, null, 'facebook', 'meta', null, 'meta', '{"leadgen_id":"L-1"}');
select test.assert((select count(*) = 1 from public.crm_oportunidades where leadgen_id = 'L-1'), 'el mismo leadgen_id nunca se crea dos veces, ni con otro teléfono');
select test.assert((select campaign_id = 'C-9' and ad_id = 'A-9' and form_id = 'F-9' from public.crm_oportunidades where leadgen_id = 'L-1'), 'guarda campaña, conjunto, anuncio y formulario de Meta');
select test.assert(length(public.crm_atribucion_limpia(jsonb_build_object('utm_campaign', repeat('x', 500))) ->> 'utm_campaign') = 150, 'los valores largos se recortan');

-- Métricas por campaña -------------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select test.assert((public.crm_metricas(:'org_a', 30) -> 'por_campana' -> 0 ->> 'campana') in ('Torre Alba Suites', 'C-9'), 'las métricas incluyen las campañas');
select test.assert(jsonb_array_length(public.crm_metricas(:'org_a', 30) -> 'por_campana') = 2, 'dos campañas en la empresa A (la de B no se cuela)');

-- Aislamiento entre empresas y entre roles ---------------------------------------------------------------
select test.assert((select count(*) > 0 and bool_and(org_id = :'org_a') from public.crm_oportunidades), 'el propietario de A solo ve leads de A');
select test.assert((select count(*) > 0 and bool_and(org_id = :'org_a') from public.crm_contactos), 'el propietario de A solo ve contactos de A');
select test.login(:'b','dueno-b@x.com');
select test.assert((select count(*) = 1 and bool_and(org_id = :'org_b') from public.crm_oportunidades), 'el propietario de B solo ve su lead');
select test.assert((select count(*) = 0 from public.crm_actividades where org_id = :'org_a'), 'B no ve actividades de A');
select test.assert(jsonb_array_length(public.crm_metricas(:'org_a', 30) -> 'por_campana') = 0, 'B no ve las campañas de A (RLS en las métricas)');
select test.falla($$ select public.crm_crear_lead('$$ || :'org_a' || $$', 'Intruso', '0991212121') $$, 'B no puede crear leads en A');
-- Un agente ve sus leads y los que no tienen dueño; nunca los de otro asesor.
reset role;
update public.crm_oportunidades set asignado_a = 'dueno-a@x.com' where leadgen_id = 'L-1';
select test.login(:'ag','agente-a@x.com');
select test.assert((select count(*) > 0 and bool_and(asignado_a is null) from public.crm_oportunidades), 'el agente ve los leads sin dueño');
select test.assert((select count(*) = 0 from public.crm_oportunidades where leadgen_id = 'L-1'), 'el agente no ve el lead asignado a otro');
reset role;
update public.crm_oportunidades set asignado_a = 'agente-a@x.com' where leadgen_id = 'L-1';
select test.login(:'ag','agente-a@x.com');
select test.assert((select count(*) = 1 from public.crm_oportunidades where leadgen_id = 'L-1'), 'el agente ve el lead que tiene asignado');
select test.falla($$ update public.crm_oportunidades set utm_campaign = 'manipulada' where leadgen_id = 'L-1' $$, 'el origen del lead no se edita desde la app');
select test.falla($$ update public.crm_oportunidades set fuente = 'referido', ad_id = null where leadgen_id = 'L-1' $$, 'tampoco junto con otros cambios');
update public.crm_oportunidades set etapa = 'contactado' where leadgen_id = 'L-1';
select test.assert((select etapa = 'contactado' from public.crm_oportunidades where leadgen_id = 'L-1'), 'sí puede cambiar la etapa de su lead');

select 'atribucion: OK' as resultado;
