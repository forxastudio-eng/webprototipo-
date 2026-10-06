-- ============================================================================
-- GPUnlock · 08 · Datos de demostración
-- Contenido FICTICIO para probar toda la plataforma: 5 unidades por proyecto en
-- el cotizador y precios inventados. Seguro de volver a ejecutar (upsert).
-- Ejecutar después de 01 → 07.
-- ============================================================================

-- Portafolio de la landing principal ------------------------------------------
delete from public.projects;
insert into public.projects (name, url, tagline, cover_url, ubicacion, tipo, sort_order) values
  ('Vértice', '/vertice/', 'Suites, departamentos y locales comerciales sobre la avenida Principal.', 'assets/covers/vertice.jpg', 'Ciudad Alta', 'Suites y locales', 1),
  ('Prisma Suites & Lofts', '/prisma/', 'Suites, lofts y espacios comerciales sobre la avenida del Parque.', 'assets/covers/prisma.jpg', 'Ciudad Alta', 'Suites, lofts y locales', 2),
  ('Valle Sereno', '/valle/', 'Lotes y desarrollo residencial en Valle Alto.', 'assets/covers/valle-sereno.jpg', 'Valle Alto', 'Lotes', 3),
  ('Lumen', '/#contacto', 'Edificio residencial de departamentos y suites.', 'assets/covers/lumen.jpg', 'Ciudad Alta', 'Departamentos', 4);

-- Vértice (landing)
insert into public.units (code, kind, grupo, title, tag, area, status, dorm, banos, extra, ficha, thumb, sort_order) values
  ('A1','suite','a','Suite A1','Tipo 1','54.97','disponible','1 dormitorio','1 baño','Balcón','img/fichas/A1.jpg','img/fichas/thumbs/A1.jpg',1),
  ('C1','suite','c','Suite C1','Tipo 3','58.20','disponible','2 dormitorios','1 baño',null,'img/fichas/C1.jpg','img/fichas/thumbs/C1.jpg',2),
  ('B1','suite','b','Suite B1','Tipo 2','62.40','disponible','2 dormitorios','1.5 baños','Terraza','img/fichas/B1.jpg','img/fichas/thumbs/B1.jpg',3),
  ('LOCAL01','local',null,'Local 01',null,'54.30','disponible',null,null,null,'img/zona-comercial.jpg','img/zona-comercial.jpg',4),
  ('LOCAL02','local',null,'Local 02',null,'40.65','reservado',null,null,null,'img/locales-calle.jpg','img/locales-calle.jpg',5)
on conflict (code) do update set title=excluded.title, status=excluded.status, area=excluded.area, sort_order=excluded.sort_order;

-- Prisma (landing)
insert into public.prisma_units (code, kind, grupo, title, tag, area, status, dorm, banos, extra, ficha, thumb, sort_order) values
  ('SUITE-102','suite',null,'Suite 102','Signature','60.95','disponible','1','1',null,'img/fichas/SUITE-102.jpg','img/fichas/SUITE-102.jpg',1),
  ('SUITE-103','suite',null,'Suite 103','Signature','97.86','reservado','2','2',null,'img/fichas/SUITE-103.jpg','img/fichas/SUITE-103.jpg',2),
  ('LOFT-101','loft',null,'Loft 101','Essential','98.42','disponible','1','1',null,'img/fichas/LOFT-101.jpg','img/fichas/LOFT-101.jpg',3),
  ('LOFT-104','loft',null,'Loft 104','Classic','59.42','disponible','1','1',null,'img/fichas/LOFT-104.jpg','img/fichas/LOFT-104.jpg',4),
  ('LOCAL-1','local',null,'Local 1',null,'56.2','disponible',null,null,null,'img/fichas/LOCAL-1.jpg','img/fichas/LOCAL-1.jpg',5)
on conflict (code) do update set title=excluded.title, status=excluded.status, area=excluded.area, sort_order=excluded.sort_order;

-- Valle Sereno (landing): 5 lotes con su polígono sobre el plano y 6 fotos del slider
insert into public.lots (code, status, area, price, cx, cy, points) values
  ('A1','disponible',2546.52,78000,73.16,18.4,'[[71.46, 15.84], [69.76, 18.87], [71.84, 21.36], [76.67, 21.36], [76.15, 16.67], [73.15, 16.57]]'::jsonb),
  ('A10','disponible',2597.51,81500,66.83,28.65,'[[62.32, 27.7], [61.93, 28.71], [62.57, 28.07], [63.1, 28.07], [63.23, 28.81], [62.45, 28.89], [69.63, 31.56], [70.93, 29.64], [70.4, 27.61]]'::jsonb),
  ('A11','reservado',2570.75,76000,61.87,15.99,'[[59.97, 14.19], [58.66, 17.86], [61.66, 18.79], [62.57, 18.32], [62.7, 17.59], [64.28, 17.4], [65.19, 15.01]]'::jsonb),
  ('A113','disponible',2394.49,84500,56.93,15.11,'[[53.31, 13.36], [53.31, 14.83], [55.39, 16.12], [55.39, 16.57], [54.87, 16.85], [56.31, 18.14], [58.53, 17.86], [59.84, 14], [58.66, 14], [58.27, 13.72], [58.4, 13.27], [58.01, 13.72], [57.49, 13.72], [57.35, 13.27], [57.1, 13.64]]'::jsonb),
  ('A116','no_disponible',2572.83,79000,68.59,41.95,'[[68.71, 37.82], [68.06, 38.1], [65.57, 41.31], [66.76, 41.22], [66.1, 41.96], [67.93, 43.98], [70.8, 43.7], [70.93, 41.77], [71.46, 41.68], [70.8, 40.39], [68.97, 40.57], [68.97, 40.21], [70.02, 39.94]]'::jsonb)
on conflict (code) do update set status=excluded.status, area=excluded.area, price=excluded.price, cx=excluded.cx, cy=excluded.cy, points=excluded.points;

delete from public.slider_images;
insert into public.slider_images (src, alt, sort_order) values
  ('img/mapa-ubicacion.jpg','Mapa satelital: ubicación del proyecto',0),
  ('img/aerial-lotes.jpg','Vista aérea de los lotes y vías internas del proyecto',1),
  ('img/aerial-hillside.jpg','Vista aérea de las vías y lotes',2),
  ('img/aerial-valle1.jpg','Vista aérea del valle',3),
  ('img/aerial-valle2.jpg','Vista aérea del valle, otra perspectiva',4),
  ('img/aerial-valle3.jpg','Vista aérea de los alrededores',5);

-- Cotizador: 5 proyectos con 5 unidades cada uno y precios ficticios -------------
-- (ubicación y colores en la paleta de GPUnlock)
insert into public.cotizador_proyectos
  (id, nombre, tagline, ubicacion, color_primario, color_acento, tipo_financiamiento, prefijo_proforma,
   reserva_pct, promesa_pct, tasa_default, plazo_default_anios, permite_descuento_manual, monto_descuento_clic, permite_multi_seleccion, sort_order) values
  ('colina',  'Colina Verde',          'Condominio privado de casas y suites · Ciudad Alta',               'Ciudad Alta', '#F2582B', '#F08A30', 'cuotas_entrega', 'COL', 0.02, 0.08, 10.5, 20, true,  0, true,  1),
  ('lumen',   'Lumen',                 'Edificio residencial · Barrio Jardín',                              'Ciudad Alta', '#161616', '#F2582B', 'cuotas_entrega', 'LUM', 0.02, 0.08, 10.5, 20, false, 0, false, 2),
  ('vertice', 'Vértice',               'Suites, departamentos y locales comerciales · Avenida Principal',   'Ciudad Alta', '#C9421B', '#F7A25F', 'cuotas_entrega', 'VER', 0.02, 0.08, 10.5, 20, false, 0, true,  3),
  ('valle',   'Valle Sereno',          'Lotes y desarrollo residencial · Valle Alto',                       'Valle Alto',  '#A93A18', '#F5B27A', 'pago_directo',   'VAS', 0.30, 0,    10.5, 20, false, 0, false, 4),
  ('prisma',  'Prisma Suites & Lofts', 'Suites, lofts y locales comerciales · Avenida del Parque',          'Ciudad Alta', '#2B2B2B', '#F08A30', 'cuotas_entrega', 'PRI', 0.02, 0.08, 10.5, 20, false, 0, false, 5)
on conflict (id) do update set
  nombre=excluded.nombre, tagline=excluded.tagline, ubicacion=excluded.ubicacion,
  color_primario=excluded.color_primario, color_acento=excluded.color_acento,
  tipo_financiamiento=excluded.tipo_financiamiento, prefijo_proforma=excluded.prefijo_proforma,
  reserva_pct=excluded.reserva_pct, promesa_pct=excluded.promesa_pct,
  permite_descuento_manual=excluded.permite_descuento_manual, permite_multi_seleccion=excluded.permite_multi_seleccion,
  sort_order=excluded.sort_order;

-- Colina Verde
insert into public.cotizador_unidades (proyecto_id, codigo, nombre, tipo, terreno_m2, construccion_m2, dormitorios, banos, parqueos, precio, aplica_vip, estado, sort_order) values
  ('colina', 'casa1',  'Casa 1',  'Casa Tipo 1', 120, 117, 3, 2.5, 2, 100000, true, 'disponible', 1),
  ('colina', 'casa2',  'Casa 2',  'Casa Tipo 1', 111, 117, 3, 2.5, 2,  98000, true, 'disponible', 2),
  ('colina', 'casa3',  'Casa 3',  'Casa Tipo 2', 206, 158, 3, 2.5, 2, 142000, true, 'disponible', 3),
  ('colina', 'casa4',  'Casa 4',  'Casa Tipo 1',  98, 117, 3, 2.5, 2,  95000, true, 'reservado',  4),
  ('colina', 'suite1', 'Suite 1', 'Suite',       115,  52, 1, 1.5, 1,  70000, true, 'disponible', 5)
on conflict (proyecto_id, codigo) do update set nombre=excluded.nombre, precio=excluded.precio, estado=excluded.estado, sort_order=excluded.sort_order;

-- Lumen
insert into public.cotizador_unidades (proyecto_id, codigo, nombre, tipo, area_util_m2, area_total_m2, dormitorios, banos, bodega_codigo, precio, estado, sort_order) values
  ('lumen', '201', 'Departamento 201', 'Departamento', 120.00, 140.00, 3, 2.5, '8 (3.80 m²)',  180000, 'disponible', 1),
  ('lumen', '202', 'Departamento 202', 'Departamento',  85.00,  92.00, 2, 2,   '14 (3.70 m²)', 130000, 'disponible', 2),
  ('lumen', '203', 'Suite 203',        'Suite',         46.00,  52.00, 1, 1.5, '9 (3.10 m²)',   85000, 'disponible', 3),
  ('lumen', '301', 'Departamento 301', 'Departamento', 110.00, 125.00, 3, 2.5, '7 (4.50 m²)',  165000, 'reservado',  4),
  ('lumen', '302', 'Suite 302',        'Suite',         60.00,  66.00, 1, 1.5, '16 (4.70 m²)',  95000, 'disponible', 5)
on conflict (proyecto_id, codigo) do update set nombre=excluded.nombre, precio=excluded.precio, estado=excluded.estado, sort_order=excluded.sort_order;

-- Vértice
insert into public.cotizador_unidades (proyecto_id, codigo, nombre, tipo, area_util_m2, dormitorios, banos, parqueos, bodega_codigo, bodega_area_m2, precio, precio_preventa, estado, sort_order) values
  ('vertice', 'A1',  'Suite A1',        'Suite',        54.97, 1, 1, 1, '23', 2.71,  90000, 84000, 'disponible', 1),
  ('vertice', 'A2',  'Suite A2',        'Suite',        56.31, 1, 1, 1, '24', 2.69,  92000, 86000, 'disponible', 2),
  ('vertice', 'A3',  'Monoambiente A3', 'Monoambiente', 50.86, 1, 1, 1, '34', 2.33,  82000, 77000, 'disponible', 3),
  ('vertice', 'L01', 'Local L01',       'Local',        54.30, null, 1, 1, '18', 3.83, 105000, 99000, 'disponible', 4),
  ('vertice', 'L02', 'Local L02',       'Local',        40.65, null, 1, 1, '19', 3.95,  78000, 74000, 'reservado',  5)
on conflict (proyecto_id, codigo) do update set nombre=excluded.nombre, precio=excluded.precio, precio_preventa=excluded.precio_preventa, estado=excluded.estado, sort_order=excluded.sort_order;

-- Valle Sereno (lotes, pago directo)
insert into public.cotizador_unidades (proyecto_id, codigo, nombre, tipo, planta, terreno_m2, precio, estado, sort_order) values
  ('valle', 'A1', 'Lote A1', 'Lote', 'Categoría A', 2546.52, 78000, 'disponible', 1),
  ('valle', 'A2', 'Lote A2', 'Lote', 'Categoría A', 2597.51, 81500, 'disponible', 2),
  ('valle', 'A3', 'Lote A3', 'Lote', 'Categoría B', 2394.49, 70000, 'disponible', 3),
  ('valle', 'A4', 'Lote A4', 'Lote', 'Categoría A', 2572.83, 79000, 'reservado',  4),
  ('valle', 'A5', 'Lote A5', 'Lote', 'Categoría B', 2506.20, 72500, 'disponible', 5)
on conflict (proyecto_id, codigo) do update set nombre=excluded.nombre, precio=excluded.precio, estado=excluded.estado, sort_order=excluded.sort_order;

-- Prisma Suites & Lofts
insert into public.cotizador_unidades (proyecto_id, codigo, nombre, tipo, planta, area_util_m2, area_total_m2, parqueos, precio, estado, sort_order) values
  ('prisma', '101', 'Loft 101',  'Loft',            'Piso 1 · Essential',        31.98,  98.42, null,  76000, 'disponible', 1),
  ('prisma', '102', 'Suite 102', 'Suite',           'Piso 1 · Signature',        46.71,  60.95, null, 104500, 'disponible', 2),
  ('prisma', '201', 'Loft 201',  'Loft',            'Piso 2 · Essential',        31.98,  36.43, 1,     83500, 'reservado',  3),
  ('prisma', 'L1',  'Local 1',   'Local Comercial', 'Planta Baja · Signature',   56.20,  56.20, 1,    144000, 'disponible', 4),
  ('prisma', 'I1',  'Isla 1',    'Isla Comercial',  'Planta Baja · Classic',      5.20,   5.20, null,  15600, 'disponible', 5)
on conflict (proyecto_id, codigo) do update set nombre=excluded.nombre, precio=excluded.precio, estado=excluded.estado, sort_order=excluded.sort_order;
