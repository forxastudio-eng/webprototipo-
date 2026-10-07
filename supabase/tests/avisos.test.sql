-- Avisos por correo del cobro: qué se genera, a quién, que no se repita ni llegue obsoleto, y que solo lo use el servidor.
\set ON_ERROR_STOP on
\set a  '00000000-0000-0000-0000-0000000000f1'
\set a2 '00000000-0000-0000-0000-0000000000f2'
\set b  '00000000-0000-0000-0000-0000000000f3'
\set s  '00000000-0000-0000-0000-0000000000f4'
insert into auth.users (id, email) values (:'a','dueno-a@x.com'), (:'a2','agente-a@x.com'), (:'b','dueno-b@x.com'), (:'s','super@gpunlock.com');
insert into public.superadmins (user_id, email) values (:'s', 'super@gpunlock.com');
select test.login(:'a','dueno-a@x.com'); select public.crear_organizacion('Inmobiliaria A','Ana') as org_a \gset
select test.login(:'b','dueno-b@x.com'); select public.crear_organizacion('Inmobiliaria B','Beto') as org_b \gset
reset role;
insert into public.miembros (org_id, user_id, email, rol) values (:'org_a', :'a2', 'agente-a@x.com', 'agente');
update public.datos_cobro set correo_cobros = 'cobros@gpunlock.com' where id;

-- 1. Solo el servidor ------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select test.falla($$ select public.avisos_pendientes() $$, 'un propietario no lee los avisos');
select test.falla($$ select public.avisos_marcar(1, true) $$, 'un propietario no marca avisos');
select test.falla($$ select * from public.cobros_avisos $$, 'la tabla de avisos no se lee con sesión de usuario');
select test.anon();
select test.falla($$ select public.avisos_pendientes() $$, 'sin sesión tampoco');
reset role;

-- 2. Comprobante recibido → aviso para GPUnlock -----------------------------------------------
select test.login(:'a','dueno-a@x.com');
select (public.solicitar_pago(:'org_a','profesional','mensual')) ->> 'id' as sol \gset
insert into storage.objects (bucket_id, name) values ('comprobantes', :'org_a' || '/t.pdf');
select test.assert((select count(*) = 0 from public.solicitudes_pago where estado = 'en_revision'), 'antes del comprobante no hay nada en revisión');
select public.subir_comprobante(:'sol', :'org_a' || '/t.pdf');
reset role; set role service_role;
select public.avisos_pendientes() as p \gset
select test.assert(jsonb_array_length(:'p'::jsonb) = 1, 'hay un aviso pendiente (el del comprobante)');
select test.assert((:'p'::jsonb -> 0 ->> 'tipo') = 'comprobante' and (:'p'::jsonb -> 0 ->> 'empresa') = 'Inmobiliaria A', 'es de tipo comprobante y nombra la empresa');
select test.assert((:'p'::jsonb -> 0 -> 'destinatarios') @> '["super@gpunlock.com","cobros@gpunlock.com"]'::jsonb, 'va al superadmin y al correo de cobros');
select test.assert((:'p'::jsonb -> 0 -> 'solicitud' ->> 'total')::numeric = 56.35 and (:'p'::jsonb -> 0 -> 'solicitud' ->> 'referencia') ~ '^GPU-', 'trae monto y referencia');
select (:'p'::jsonb -> 0 ->> 'id')::bigint as id1 \gset
-- Un envío fallido se reintenta; uno exitoso no se repite.
select public.avisos_marcar(:id1, false, 'Resend 500');
select test.assert((select intentos = 1 and enviado_at is null and error = 'Resend 500' from public.cobros_avisos where id = :id1), 'un fallo suma un intento y deja el aviso pendiente');
select test.assert(jsonb_array_length(public.avisos_pendientes()) = 1, 'sigue pendiente tras el fallo');
select public.avisos_marcar(:id1, true);
select test.assert(jsonb_array_length(public.avisos_pendientes()) = 0, 'enviado: ya no vuelve a salir');
select test.assert((select enviado_at is not null and error is null from public.cobros_avisos where id = :id1), 'queda registrada la hora de envío');
reset role;
-- Volver a subir otro comprobante genera otro aviso
select test.login(:'a','dueno-a@x.com');
insert into storage.objects (bucket_id, name) values ('comprobantes', :'org_a' || '/t2.pdf');
select pg_sleep(0.01);
select public.subir_comprobante(:'sol', :'org_a' || '/t2.pdf');
reset role;
select test.assert((select count(*) = 2 from public.cobros_avisos where tipo = 'comprobante'), 'un segundo comprobante genera un segundo aviso');

-- 3. Aprobar y rechazar → aviso para el propietario de la empresa -------------------------------
select test.login(:'s','super@gpunlock.com');
select public.rechazar_pago(:'sol', 'No vemos la transferencia');
reset role; set role service_role;
select public.avisos_pendientes() as p \gset
select test.assert((select count(*) = 2 from jsonb_array_elements(:'p'::jsonb)), 'quedan el 2.º comprobante y el rechazo');
select test.assert(exists (select 1 from jsonb_array_elements(:'p'::jsonb) e where e ->> 'tipo' = 'rechazado' and e -> 'destinatarios' = '["dueno-a@x.com"]'::jsonb
                           and e -> 'solicitud' ->> 'motivo' = 'No vemos la transferencia'), 'el rechazo va solo al propietario y trae el motivo');
select test.assert(not exists (select 1 from jsonb_array_elements(:'p'::jsonb) e where (e -> 'destinatarios') ? 'agente-a@x.com'), 'los agentes nunca reciben avisos de cobro');
reset role;
select test.login(:'a','dueno-a@x.com');
select (public.solicitar_pago(:'org_a','profesional','anual')) ->> 'id' as sol2 \gset
insert into storage.objects (bucket_id, name) values ('comprobantes', :'org_a' || '/t3.pdf');
select public.subir_comprobante(:'sol2', :'org_a' || '/t3.pdf');
select test.login(:'s','super@gpunlock.com');
select public.aprobar_pago(:'sol2', current_date);
reset role; set role service_role;
select test.assert(exists (select 1 from jsonb_array_elements(public.avisos_pendientes()) e where e ->> 'tipo' = 'aprobado' and e ->> 'plan_nombre' = 'Profesional'
                           and e -> 'solicitud' ->> 'periodo' = 'anual'), 'aprobar genera el aviso «pago aprobado»');
reset role;
update public.cobros_avisos set enviado_at = now() where enviado_at is null;

-- 4. Vencimientos: se generan, llegan a quien corresponde y no llegan si ya renovó ---------------
update public.organizaciones set estado = 'activa', periodo_hasta = now() + interval '5 days' where id = :'org_b';
select public.cobros_actualizar_estados();
set role service_role;
select public.avisos_pendientes() as p \gset
select test.assert(exists (select 1 from jsonb_array_elements(:'p'::jsonb) e where e ->> 'tipo' = 'd7' and e ->> 'empresa' = 'Inmobiliaria B'
                           and e -> 'destinatarios' = '["dueno-b@x.com"]'::jsonb), 'a 5 días del vencimiento sale el aviso «d7» al propietario');
select test.assert(exists (select 1 from jsonb_array_elements(:'p'::jsonb) e where e ->> 'tipo' = 'prueba_d3' or e ->> 'tipo' = 'prueba_d0' or e ->> 'tipo' = 'd7'), 'hay avisos de vencimiento');
reset role;
-- La empresa B renueva antes de que se envíe: el aviso queda obsoleto y no se manda.
update public.organizaciones set periodo_hasta = now() + interval '40 days' where id = :'org_b';
set role service_role;
select test.assert(not exists (select 1 from jsonb_array_elements(public.avisos_pendientes()) e where e ->> 'empresa' = 'Inmobiliaria B' and e ->> 'tipo' = 'd7'), 'si ya renovó, el aviso de vencimiento no sale');
reset role;
select test.assert((select error = 'obsoleto' and enviado_at is not null from public.cobros_avisos where org_id = :'org_b' and tipo = 'd7'), 'queda cerrado como obsoleto');

-- 5. Caducidad y tope de reintentos -------------------------------------------------------------
insert into public.cobros_avisos (org_id, tipo, referencia_fecha, created_at) values (:'org_a', 'rechazado', now() - interval '10 days', now() - interval '4 days');
insert into public.cobros_avisos (org_id, tipo, referencia_fecha, intentos) values (:'org_a', 'aprobado', now() - interval '1 hour', 5);
set role service_role;
select test.assert(jsonb_array_length(public.avisos_pendientes()) = 0, 'avisos de hace más de 3 días o con 5 fallos no se reintentan para siempre');
reset role;
select test.assert((select count(*) = 2 from public.cobros_avisos where error in ('caducado', 'sin éxito tras 5 intentos')), 'quedan marcados con su motivo');
select test.assert((select count(*) from public.cobros_avisos where enviado_at is null) = 0, 'nada queda abierto');
