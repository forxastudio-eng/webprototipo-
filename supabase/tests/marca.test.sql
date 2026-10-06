-- Marca por empresa: quién puede cambiarla, validaciones, logos en Storage y lectura pública.
\set ON_ERROR_STOP on
\set a  '00000000-0000-0000-0000-0000000000e1'
\set ad '00000000-0000-0000-0000-0000000000e2'
\set ag '00000000-0000-0000-0000-0000000000e3'
\set b  '00000000-0000-0000-0000-0000000000e4'
insert into auth.users (id, email) values (:'a','dueno-a@x.com'), (:'ad','admin-a@x.com'), (:'ag','agente-a@x.com'), (:'b','dueno-b@x.com');
select test.login(:'a','dueno-a@x.com'); select public.crear_organizacion('Inmobiliaria A') as org_a \gset
select test.login(:'b','dueno-b@x.com'); select public.crear_organizacion('Inmobiliaria B') as org_b \gset
reset role;
insert into public.miembros (org_id, user_id, email, rol) values (:'org_a', :'ad', 'admin-a@x.com', 'administrador'), (:'org_a', :'ag', 'agente-a@x.com', 'agente');

-- 1. Quién puede ----------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select (public.guardar_marca(:'org_a', 'Andes Propiedades', 'andes', '#1e4fd8', null, null, null, false)) ->> 'color_primario' as c \gset
select test.assert(:'c' = '#1E4FD8', 'el propietario guarda su marca (el color se normaliza a mayúsculas)');
select test.login(:'ad','admin-a@x.com');
select public.guardar_marca(:'org_a', 'Andes Propiedades', 'andes', '#0F8A5F', '#F0C330', null, null, false);
select test.assert((select color_primario = '#0F8A5F' and color_acento = '#F0C330' from public.org_marca where org_id = :'org_a'), 'el administrador también la cambia');
select test.login(:'ag','agente-a@x.com');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', 'X Hack', null, '#000000', null, null, null, false) $$, 'un agente no puede cambiar la marca');
select test.assert((select count(*) = 1 from public.org_marca), 'un agente sí la ve (para pintar su app)');
select test.falla($$ update public.org_marca set color_primario = '#000000' $$, 'nadie edita la tabla directamente');
select test.login(:'b','dueno-b@x.com');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', 'Intruso', null, '#000000', null, null, null, false) $$, 'otra empresa no puede cambiar la marca ajena');
select test.assert((select count(*) = 0 from public.org_marca), 'otra empresa no ve la marca ajena');
select test.anon();
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', 'Anon', null, '#000000', null, null, null, false) $$, 'sin sesión no se cambia la marca');
select test.falla($$ select * from public.org_marca $$, 'sin sesión no se lee la tabla');

-- 2. Validaciones ----------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, null, 'rojo', null, null, null, false) $$, 'el color debe ser #RRGGBB');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, null, '#FF0000', 'azul', null, null, false) $$, 'el acento debe ser #RRGGBB');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', 'A', null, '#FF0000', null, null, null, false) $$, 'el nombre comercial tiene al menos 2 letras');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, 'Mi Empresa!', '#FF0000', null, null, null, false) $$, 'dirección corta con caracteres inválidos');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, 'ab', '#FF0000', null, null, null, false) $$, 'dirección corta demasiado corta');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, 'consola', '#FF0000', null, null, null, false) $$, 'direcciones reservadas (consola, app, admin…)');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, 'andes', '#FF0000', null, '$$ || :'org_b' || $$/logo.png', null, false) $$, 'el logo debe estar en la carpeta de la propia empresa');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, 'andes', '#FF0000', null, '$$ || :'org_a' || $$/logo.svg', null, false) $$, 'no se admite SVG');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, 'andes', '#FF0000', null, '$$ || :'org_a' || $$/../x.png', null, false) $$, 'no se admiten rutas con ..');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, 'andes', '#FF0000', null, null, null, true) $$, 'quitar el pie de GPUnlock exige el plan Agencia');
select test.login(:'b','dueno-b@x.com');
select test.falla($$ select public.guardar_marca('$$ || :'org_b' || $$', null, 'andes', '#FF0000', null, null, null, false) $$, 'la dirección corta es única');

-- 3. Logos en Storage ---------------------------------------------------------------------------
select test.login(:'a','dueno-a@x.com');
insert into storage.objects (bucket_id, name) values ('marcas', :'org_a' || '/logo-1.png');
select test.assert((select count(*) = 1 from storage.objects where name = :'org_a' || '/logo-1.png'), 'el propietario sube el logo a su carpeta');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('marcas', '$$ || :'org_b' || $$/logo.png') $$, 'no se sube a la carpeta de otra empresa');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('marcas', 'suelto.png') $$, 'no se sube fuera de una carpeta de empresa');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('marcas', '$$ || :'org_a' || $$/virus.exe') $$, 'solo PNG, JPG o WebP');
select test.login(:'ag','agente-a@x.com');
select test.falla($$ insert into storage.objects (bucket_id, name) values ('marcas', '$$ || :'org_a' || $$/agente.png') $$, 'un agente no sube logos');
select test.assert((select count(*) = 0 from storage.objects), 'un agente no lista los archivos de la marca');
select test.login(:'b','dueno-b@x.com');
select test.assert((select count(*) = 0 from storage.objects), 'otra empresa no lista los archivos de la marca');
select test.login(:'a','dueno-a@x.com');
select public.guardar_marca(:'org_a', 'Andes Propiedades', 'andes', '#0F8A5F', null, :'org_a' || '/logo-1.png', null, false);
select test.assert((select logo_path = :'org_a' || '/logo-1.png' from public.org_marca), 'guarda la ruta del logo');
delete from storage.objects where name = :'org_a' || '/logo-1.png';
select test.assert((select count(*) = 0 from storage.objects), 'puede borrar su logo anterior');
select test.assert((select public from storage.buckets where id = 'marcas') and (select file_size_limit = 1048576 from storage.buckets where id = 'marcas'), 'el bucket es público y limita a 1 MB');

-- 4. Lectura pública para la pantalla de inicio de sesión ----------------------------------------------------
select test.anon();
select public.marca_publica('andes') as pub \gset
select test.assert((:'pub'::jsonb ->> 'nombre') = 'Andes Propiedades' and (:'pub'::jsonb ->> 'color_primario') = '#0F8A5F', 'la pantalla de inicio de sesión lee la marca por la dirección corta');
select test.assert(not (:'pub'::jsonb ? 'org_id') and not (:'pub'::jsonb ? 'subdominio'), 'la lectura pública no revela el id de la empresa');
select test.assert(public.marca_publica('no-existe') is null, 'una dirección inexistente no devuelve nada');
select test.assert(public.marca_publica('ANDES') is not null, 'la dirección no distingue mayúsculas');
select test.assert(public.marca_publica('') is null and public.marca_publica(null) is null, 'vacío o nulo: nada');

-- 5. Plan Agencia y suscripción --------------------------------------------------------------------------------
reset role;
update public.organizaciones set plan_id = 'agencia' where id = :'org_a';
select test.login(:'a','dueno-a@x.com');
select public.guardar_marca(:'org_a', 'Andes Propiedades', 'andes', '#0F8A5F', null, null, null, true);
select test.assert((select not mostrar_pie_gpunlock from public.org_marca), 'en el plan Agencia se puede quitar el pie de GPUnlock');
reset role;
update public.organizaciones set estado = 'vencida' where id = :'org_a';
select test.login(:'a','dueno-a@x.com');
select test.falla($$ select public.guardar_marca('$$ || :'org_a' || $$', null, 'andes', '#112233', null, null, null, false) $$, 'con la suscripción vencida no se cambia la marca');
select test.assert((select color_primario = '#0F8A5F' from public.org_marca), 'pero la marca ya guardada se sigue viendo');
reset role;
select test.assert(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'org_marca'), 'org_marca está en la publicación de tiempo real');
select test.assert(not has_function_privilege('anon', 'public.guardar_marca(uuid,text,text,text,text,text,text,boolean)', 'execute'), 'anon no puede ejecutar guardar_marca');

select 'marca: OK' as resultado;
