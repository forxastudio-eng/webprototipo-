-- Endurecimiento que pide el asesor de seguridad de Supabase: search_path fijo y sin ejecución pública de disparadores.
\set ON_ERROR_STOP on
-- 1. Toda función propia fija su search_path.
select test.assert((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.prokind = 'f' and p.proconfig is null
                      and p.proname not like 'pg\_%'), 'todas las funciones del esquema public fijan su search_path')
  \gset
-- 2. Las funciones de disparador no son ejecutables por la API (ni anon ni authenticated)…
select test.assert(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
                                 and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
                   'ninguna función de disparador es ejecutable por anon ni authenticated');
-- …y aun así los disparadores funcionan cuando actúa un usuario (se verifica con un alta y una edición reales).
\set a '00000000-0000-0000-0000-0000000000d1'
insert into auth.users (id, email) values (:'a', 'dueno@x.com');
select test.login(:'a','dueno@x.com'); select public.crear_organizacion('Org D') as org \gset
reset role;
select clave_publica as clave from public.organizaciones where id = :'org' \gset
select test.anon(); select public.crm_registrar_lead(:'clave', 'Ana Prueba', '0991234567', null, 'torre'); reset role;
select test.assert((select count(*) = 1 from public.crm_oportunidades), 'el alta pública sigue funcionando (disparadores activos)');
select test.login(:'a','dueno@x.com');
update public.crm_contactos set nombre = '  Ana Editada  ';
select test.assert((select nombre = 'Ana Editada' and updated_at >= created_at from public.crm_contactos), 'los disparadores de normalización y de fecha siguen activos');
update public.crm_oportunidades set etapa = 'contactado';
select test.assert((select count(*) = 1 from public.crm_actividades where tipo = 'cambio_etapa'), 'el historial de cambios de etapa sigue funcionando');
-- 3. Lo que debe seguir siendo público: la captura de leads de la web.
select test.assert(has_function_privilege('anon', 'public.crm_registrar_lead(text,text,text,text,text,text,text,text,text,jsonb)', 'execute'), 'la captura de leads sigue abierta a la web (a propósito)');
select 'endurecimiento: OK' as resultado;
