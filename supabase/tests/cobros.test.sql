-- Cobro por transferencia: quién puede qué, cálculo de periodos, vencimientos y que nunca se pierda un lead.
\set ON_ERROR_STOP on
\set a  '00000000-0000-0000-0000-00000000000a'
\set a2 '00000000-0000-0000-0000-0000000000a2'
\set b  '00000000-0000-0000-0000-00000000000b'
\set s  '00000000-0000-0000-0000-00000000005a'
insert into auth.users (id, email) values (:'a','a@x.com'), (:'a2','a2@x.com'), (:'b','b@x.com'), (:'s','super@gpunlock.com');
insert into public.superadmins (user_id, email) values (:'s', 'super@gpunlock.com');

select test.login(:'a','a@x.com');  select public.crear_organizacion('Inmobiliaria A','Ana') as org_a \gset
select test.login(:'b','b@x.com');  select public.crear_organizacion('Inmobiliaria B','Beto') as org_b \gset
reset role;
insert into public.miembros (org_id, user_id, email, rol) values (:'org_a', :'a2', 'a2@x.com', 'agente');

-- 1. Arranque -------------------------------------------------------------------------
select test.assert((select estado = 'prueba' and public.org_activa(id) from public.organizaciones where id = :'org_a'), 'empresa nueva: en prueba y activa');

-- 2. Solicitar el pago ----------------------------------------------------------------
select test.login(:'a','a@x.com');
select (public.solicitar_pago(:'org_a','profesional','mensual')) ->> 'id' as sol_a \gset
select test.assert((select total = 56.35 and iva = 7.35 and subtotal = 49 and estado = 'pendiente' and referencia ~ '^GPU-[0-9A-F]{4}-[0-9]{4}$'
                    from public.solicitudes_pago where id = :'sol_a'), 'el monto lleva IVA 15% y la referencia tiene formato GPU-XXXX-0000');
select test.falla($$ select public.solicitar_pago('$$ || :'org_b' || $$','inicial','mensual') $$, 'no se puede pedir un pago para otra empresa');
select test.falla($$ select public.solicitar_pago('$$ || :'org_a' || $$','inicial','semanal') $$, 'periodo inválido');
select test.falla($$ select public.solicitar_pago('$$ || :'org_a' || $$','no-existe','mensual') $$, 'plan inexistente');
select public.solicitar_pago(:'org_a','agencia','anual');   -- reemplaza la pendiente
select test.assert((select count(*) = 1 from public.solicitudes_pago where estado in ('pendiente','en_revision')), 'solo una solicitud abierta por empresa');
select test.assert((select count(*) = 1 from public.solicitudes_pago where estado = 'cancelada'), 'la anterior quedó cancelada');
select id as sol_a from public.solicitudes_pago where org_id = :'org_a' and estado = 'pendiente' \gset

select test.login(:'a2','a2@x.com');
select test.falla($$ select public.solicitar_pago('$$ || :'org_a' || $$','inicial','mensual') $$, 'un agente no puede contratar');
select test.assert((select count(*) = 0 from public.solicitudes_pago), 'un agente no ve las solicitudes de pago');
select test.assert((select count(*) = 0 from public.pagos_suscripcion), 'un agente no ve los pagos');
select test.anon();
select test.falla($$ select public.solicitar_pago('$$ || :'org_a' || $$','inicial','mensual') $$, 'sin sesión no se puede pedir un pago');
select test.falla($$ select * from public.solicitudes_pago $$, 'sin sesión no se leen solicitudes');

-- 3. Nadie se cambia el plan a sí mismo -----------------------------------------------
select test.login(:'a','a@x.com');
select test.falla($$ update public.organizaciones set plan_id = 'agencia', estado = 'activa' $$, 'el propietario no puede editar su plan ni su estado');
select test.falla($$ update public.solicitudes_pago set estado = 'aprobada' $$, 'el propietario no puede aprobar su propio pago');
select test.falla($$ insert into public.pagos_suscripcion (org_id, plan_id, periodo, subtotal, total, fecha_transferencia, cubre_desde, cubre_hasta)
                     values ('$$ || :'org_a' || $$','agencia','anual',1,1,current_date,now(),now()) $$, 'no se pueden fabricar pagos');
select test.falla($$ select public.aprobar_pago('$$ || :'sol_a' || $$', current_date) $$, 'el propietario no puede aprobar pagos');
select test.falla($$ select public.consola_empresas() $$, 'el propietario no entra a la consola');
select test.falla($$ select public.guardar_datos_cobro('x','x','x','x','x','x','x',0,0,'x') $$, 'el propietario no cambia los datos de cobro');
select test.falla($$ select public.cobros_actualizar_estados() $$, 'el cierre diario no lo ejecuta un usuario');
select test.falla($$ select public.cobros_aplicar_pago(null,null,null,0,0,0,null,null,null,null,null) $$, 'aplicar un pago no es público');

-- 4. Comprobante ----------------------------------------------------------------------
select test.falla($$ select public.subir_comprobante('$$ || :'sol_a' || $$', '$$ || :'org_a' || $$/no-existe.pdf') $$, 'el archivo debe existir en Storage');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('comprobantes', '$$ || :'org_b' || $$/intruso.pdf') $$, 'no se puede subir a la carpeta de otra empresa');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('comprobantes', 'carpeta-suelta.pdf') $$, 'no se puede subir fuera de una carpeta de empresa');
insert into storage.objects (bucket_id, name) values ('comprobantes', :'org_a' || '/transferencia.pdf');
select test.assert((select count(*) = 1 from storage.objects), 'el propietario sube y ve su comprobante');
select test.login(:'b','b@x.com');
select test.assert((select count(*) = 0 from storage.objects), 'otra empresa no ve el comprobante');
select test.login(:'a','a@x.com');
select test.falla($$ select public.subir_comprobante('$$ || :'sol_a' || $$', '$$ || :'org_b' || $$/transferencia.pdf') $$, 'el archivo debe ser de la carpeta de la propia empresa');
select public.subir_comprobante(:'sol_a', :'org_a' || '/transferencia.pdf');
select test.assert((select estado = 'en_revision' from public.solicitudes_pago where id = :'sol_a'), 'con comprobante queda en revisión');
select test.falla($$ select public.solicitar_pago('$$ || :'org_a' || $$','inicial','mensual') $$, 'con un pago en revisión no se pide otro');
select test.assert((public.uso_org(:'org_a') -> 'solicitud' ->> 'estado') = 'en_revision' and not (public.uso_org(:'org_a') -> 'solicitud' ? 'comprobante_path'),
                   'la app ve el estado de la solicitud, sin la ruta del comprobante');
select test.assert((public.uso_org(:'org_a') ->> 'activa')::boolean, 'mientras se revisa, la empresa sigue activa');

-- 5. Aprobación (solo el superadmin) ---------------------------------------------------
select test.login(:'s','super@gpunlock.com');
select test.assert((select count(*) = 1 from storage.objects), 'el superadmin ve los comprobantes');
select test.assert((jsonb_array_length(public.consola_pagos('en_revision')) = 1), 'la consola lista el pago por revisar');
select test.falla($$ select public.aprobar_pago('$$ || :'sol_a' || $$', current_date + 5) $$, 'fecha de transferencia en el futuro');
select public.aprobar_pago(:'sol_a', current_date, 'Pichincha', 'COMP-0001', '001-001-000000123');
reset role;
select test.assert((select plan_id = 'agencia' and estado = 'activa' and periodo_hasta = prueba_hasta + interval '1 year'
                    from public.organizaciones where id = :'org_a'),
                   'pagando en prueba: plan activo y el periodo empieza cuando termina la prueba (no se pierden días)');
select test.assert((select count(*) = 1 and bool_and(factura_numero = '001-001-000000123' and total = 1483.50 and subtotal = 1290 and iva = 193.50)
                    from public.pagos_suscripcion where org_id = :'org_a'),
                   'el pago quedó registrado con su factura (1.290 + 15% = 1.483,50)');
select test.assert((select estado = 'aprobada' and revisado_at is not null from public.solicitudes_pago where id = :'sol_a'), 'la solicitud quedó aprobada');
select test.assert((select count(*) = 1 from public.consola_auditoria where accion = 'pago_aprobado'), 'la aprobación quedó en la auditoría');
select test.login(:'s','super@gpunlock.com');
select test.falla($$ select public.aprobar_pago('$$ || :'sol_a' || $$', current_date) $$, 'un pago no se aprueba dos veces');

-- 6. Lo que ve cada quien --------------------------------------------------------------
select test.login(:'a','a@x.com');
select test.assert((select count(*) = 1 from public.pagos_suscripcion), 'el propietario ve sus pagos');
select test.login(:'b','b@x.com');
select test.assert((select count(*) = 0 from public.pagos_suscripcion), 'otra empresa no ve pagos ajenos');
select test.assert((select count(*) = 0 from public.solicitudes_pago), 'otra empresa no ve solicitudes ajenas');
select test.assert((select count(*) = 1 from public.organizaciones), 'otra empresa solo ve su propia empresa');
select test.assert((select count(*) = 1 from public.datos_cobro), 'cualquiera con sesión ve los datos para transferir');
select test.anon();
select test.falla($$ select * from public.datos_cobro $$, 'sin sesión no se ven los datos de cobro');

-- 7. Pago manual y datos de cobro --------------------------------------------------------
select test.login(:'s','super@gpunlock.com');
select public.registrar_pago_manual(:'org_b', 'inicial', 'anual', 218.50, current_date, 'Guayaquil', 'COMP-9', 'F-77');
reset role;
select test.assert((select plan_id = 'inicial' and estado = 'activa' and periodo_hasta = prueba_hasta + interval '1 year' from public.organizaciones where id = :'org_b'),
                   'pago manual: activa el plan');
select test.assert((select subtotal = 190 and iva = 28.50 from public.pagos_suscripcion where org_id = :'org_b'), 'pago manual: separa el IVA del total');
select test.login(:'s','super@gpunlock.com');
select public.guardar_datos_cobro('Pichincha','Corriente','2100123456','GPUnlock S.A.','1790000000001','cobros@gpunlock.com','593999111222', 12, 3, 'Pon tu referencia');
select test.assert((select iva_porcentaje = 12 and dias_gracia = 3 and whatsapp_cobros = '593999111222' from public.datos_cobro), 'los datos de cobro se guardan');
select test.falla($$ select public.guardar_datos_cobro('x','x','x','x','x','x','x',99,1,'x') $$, 'IVA fuera de rango');

-- 8. Vencimientos: activa → gracia → vencida ----------------------------------------------
reset role;
update public.organizaciones set periodo_hasta = now() - interval '1 day' where id = :'org_a';
select public.cobros_actualizar_estados();
select test.assert((select estado = 'gracia' and public.org_activa(id) from public.organizaciones where id = :'org_a'), 'vencido ayer: entra en gracia y sigue activa');
select test.assert((select count(*) = 1 from public.cobros_avisos where org_id = :'org_a' and tipo = 'gracia'), 'se prepara el aviso de gracia');
select public.cobros_actualizar_estados();
select test.assert((select count(*) = 1 from public.cobros_avisos where org_id = :'org_a' and tipo = 'gracia'), 'el aviso no se repite');
update public.organizaciones set periodo_hasta = now() - interval '4 days' where id = :'org_a';
select public.cobros_actualizar_estados();
select test.assert((select estado = 'vencida' and not public.org_activa(id) from public.organizaciones where id = :'org_a'), 'pasados los días de gracia (3): vencida y sin acceso de escritura');

-- Vencida = solo lectura, pero NUNCA se pierde un lead de la web
select clave_publica as clave_a from public.organizaciones where id = :'org_a' \gset
select test.anon();
select test.assert(public.crm_registrar_lead(:'clave_a', 'Cliente Web', '0991234567', null, 'torre', null, 'Hola', 'torre-alba') , 'empresa vencida: el formulario web sigue guardando leads');
select test.login(:'a','a@x.com');
select test.assert((select count(*) = 1 from public.crm_oportunidades), 'y el lead está en su CRM');
select test.falla($$ select public.crm_crear_lead('$$ || :'org_a' || $$', 'Otro Cliente', '0987654321') $$, 'vencida: no se crean leads a mano');
select test.falla($$ select public.invitar('$$ || :'org_a' || $$', 'nuevo@x.com', 'agente') $$, 'vencida: no se invita gente');

-- 9. Pagar tarde: la suscripción vuelve a contar desde hoy ----------------------------------
select public.solicitar_pago(:'org_a','profesional','mensual');
select id as sol_a2 from public.solicitudes_pago where org_id = :'org_a' and estado = 'pendiente' \gset
select test.login(:'s','super@gpunlock.com');
select public.aprobar_pago(:'sol_a2', current_date);
reset role;
select test.assert((select estado = 'activa' and plan_id = 'profesional' and periodo_hasta > now() + interval '29 days' and periodo_hasta < now() + interval '32 days'
                    from public.organizaciones where id = :'org_a'), 'pagando una cuenta vencida: un mes desde hoy');
select test.assert((select (select total from public.pagos_suscripcion where org_id = :'org_a' order by created_at desc limit 1) = 54.88), 'el IVA nuevo (12%) se usa en las solicitudes nuevas: 49 × 1,12 = 54,88');

-- 10. Pagar en gracia: continuidad, sin cobrar de más ni regalar días -----------------------------
update public.organizaciones set estado = 'gracia', periodo_hasta = now() - interval '2 days' where id = :'org_a';
select test.login(:'a','a@x.com');
select public.solicitar_pago(:'org_a','profesional','mensual');
select id as sol_a3 from public.solicitudes_pago where org_id = :'org_a' and estado = 'pendiente' \gset
select test.login(:'s','super@gpunlock.com');
select public.aprobar_pago(:'sol_a3', current_date);
reset role;
select test.assert((select estado = 'activa' and periodo_hasta between now() - interval '2 days' + interval '28 days' and now() - interval '2 days' + interval '32 days'
                    from public.organizaciones where id = :'org_a'), 'pagando en gracia: continúa desde el vencimiento anterior');

-- 11. Rechazar ------------------------------------------------------------------------------------
select test.login(:'a','a@x.com');
select public.solicitar_pago(:'org_a','profesional','mensual');
select id as sol_a4 from public.solicitudes_pago where org_id = :'org_a' and estado = 'pendiente' \gset
select test.login(:'s','super@gpunlock.com');
select test.falla($$ select public.rechazar_pago('$$ || :'sol_a4' || $$', '') $$, 'rechazar exige un motivo');
select public.rechazar_pago(:'sol_a4', 'No vemos la transferencia en el banco');
select test.login(:'a','a@x.com');
select test.assert((public.uso_org(:'org_a') -> 'solicitud' ->> 'estado') = 'rechazada' and (public.uso_org(:'org_a') -> 'solicitud' ->> 'motivo_rechazo') like 'No vemos%',
                   'la empresa ve el motivo del rechazo');
select public.solicitar_pago(:'org_a','profesional','mensual');
select test.assert((select count(*) = 1 from public.solicitudes_pago where estado = 'pendiente'), 'después de un rechazo puede pedir otra solicitud');

-- 12. Bajar de plan con más usuarios de los permitidos ----------------------------------------------
reset role;
update public.planes set max_usuarios = 1 where id = 'inicial';
select test.login(:'a','a@x.com');
select test.falla($$ select public.solicitar_pago('$$ || :'org_a' || $$','inicial','mensual') $$, 'no se puede bajar a un plan con menos usuarios que el equipo');
reset role;
update public.planes set max_usuarios = 2 where id = 'inicial';

-- 13. Consola ------------------------------------------------------------------------------------------
select test.login(:'s','super@gpunlock.com');
select test.assert((public.consola_resumen() ->> 'por_revisar')::int = 0 and (public.consola_resumen() -> 'empresas' ->> 'activa')::int = 2, 'resumen de la consola');
select test.assert(jsonb_array_length(public.consola_empresas()) = 2, 'la consola lista las empresas');
select public.consola_ajustar(:'org_a', p_prueba_dias => 10);
select public.consola_ajustar(:'org_b', p_estado => 'cancelada');
reset role;
select test.assert((select estado = 'cancelada' and not public.org_activa(id) from public.organizaciones where id = :'org_b'), 'ajuste manual: cancelar una empresa');
select test.assert((select count(*) >= 5 from public.consola_auditoria), 'cada acción de la consola queda en la auditoría');
select test.login(:'a','a@x.com');
select test.assert((select count(*) = 0 from public.consola_auditoria), 'la auditoría no la ve una empresa');

select 'cobros: OK' as resultado;

-- 11. Activar un plan cuyo pago se recibió por fuera (sin monto registrado) -------------------------
select test.login(:'a2','a2@x.com'); select public.crear_organizacion('Inmobiliaria C','Cata') as org_c \gset
select test.login(:'s','super@gpunlock.com');
select test.falla($$ select public.registrar_pago_manual('$$ || :'org_c' || $$', 'profesional', 'mensual', -5, current_date) $$, 'un monto negativo no es válido');
select public.registrar_pago_manual(:'org_c', 'profesional', 'mensual', 0, current_date);
reset role;
select test.assert((select plan_id = 'profesional' and estado = 'activa' and periodo_hasta > now() + interval '25 days' from public.organizaciones where id = :'org_c'),
                   'activar sin monto: el plan queda activo con su periodo');
select test.assert((select total = 0 from public.pagos_suscripcion where org_id = :'org_c'), 'queda el registro del periodo con monto 0');
