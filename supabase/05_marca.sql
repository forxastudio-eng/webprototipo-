-- ============================================================================
-- GPUnlock CRM · 05 · Marca de cada empresa (logos, colores, nombre comercial)
-- Ejecutar después de 04_cobros.sql. Seguro de repetir.
--
-- Cada inmobiliaria sube su logo y elige su color; la app calcula la paleta, revisa el
-- contraste y cambia el tema de todo el equipo al instante (Realtime sobre org_marca).
--   · Solo propietario y administrador cambian la marca, con la suscripción activa.
--   · Los logos viven en el bucket público «marcas», carpeta <org_id>/ (PNG, JPG o WebP, hasta 1 MB;
--     sin SVG a propósito: un SVG puede llevar scripts).
--   · La pantalla de inicio de sesión de cada empresa (/app/?e=<subdominio>) lee su marca con
--     marca_publica(), que solo devuelve datos de marca y solo si se conoce el subdominio exacto.
--   · «Con la tecnología de GPUnlock» solo se puede quitar en el plan Agencia.
-- ============================================================================

create table if not exists public.org_marca (
  org_id uuid primary key references public.organizaciones(id) on delete cascade,
  nombre_comercial text check (nombre_comercial is null or char_length(nombre_comercial) between 2 and 60),
  subdominio text unique check (subdominio is null or subdominio ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  color_primario text not null default '#F2582B' check (color_primario ~ '^#[0-9A-Fa-f]{6}$'),
  color_acento text check (color_acento is null or color_acento ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path text,
  logo_oscuro_path text,
  mostrar_pie_gpunlock boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.org_marca enable row level security;
drop trigger if exists org_marca_updated_at on public.org_marca;
create trigger org_marca_updated_at before update on public.org_marca
  for each row execute function public.set_updated_at();

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'org_marca'
  loop
    execute format('drop policy %I on public.org_marca', r.policyname);
  end loop;
end $$;
create policy "marca: la ve su equipo" on public.org_marca
  for select to authenticated using (public.es_miembro(org_id));
revoke all on public.org_marca from anon;
revoke insert, update, delete on public.org_marca from authenticated;

-- ---------------------------------------------------------------- logos (Storage) ---
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marcas', 'marcas', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = true;

-- Los archivos van en <org_id>/<nombre>.<png|jpg|jpeg|webp>. Escribe el propietario o el administrador de esa empresa.
create or replace function public.puede_escribir_marca(p_nombre text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  if coalesce(p_nombre, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$' then
    return false;
  end if;
  v_org := split_part(p_nombre, '/', 1)::uuid;
  return public.tiene_rol_org(v_org, array['propietario', 'administrador']) and public.org_activa(v_org);
end;
$$;
revoke execute on function public.puede_escribir_marca(text) from public, anon;
grant execute on function public.puede_escribir_marca(text) to authenticated;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'marcas:%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;
create policy "marcas: sube su equipo gestor" on storage.objects
  for insert to authenticated with check (bucket_id = 'marcas' and public.puede_escribir_marca(name));
create policy "marcas: borra su equipo gestor" on storage.objects
  for delete to authenticated using (bucket_id = 'marcas' and public.puede_escribir_marca(name));
-- Para borrar (y reemplazar) un archivo, la API de Storage exige también poder leerlo: solo quien gestiona la marca de esa empresa.
-- Los logos se ven por su URL pública sin pasar por aquí, y nadie más puede listar los archivos.
create policy "marcas: lee su equipo gestor" on storage.objects
  for select to authenticated using (bucket_id = 'marcas' and public.puede_escribir_marca(name));

-- ------------------------------------------------------------------- guardar la marca ---
create or replace function public.guardar_marca(
  p_org uuid, p_nombre text, p_subdominio text, p_color text, p_acento text,
  p_logo text, p_logo_oscuro text, p_ocultar_pie boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_sub text := nullif(lower(btrim(coalesce(p_subdominio, ''))), '');
  v_color text := upper(btrim(coalesce(p_color, '')));
  v_acento text := nullif(upper(btrim(coalesce(p_acento, ''))), '');
  v_plan text;
  v_fila public.org_marca%rowtype;
begin
  if not public.tiene_rol_org(p_org, array['propietario', 'administrador']) then raise exception 'Tu rol no permite cambiar la marca'; end if;
  if not public.org_activa(p_org) then raise exception 'Tu suscripción no está activa. Renuévala para cambiar la marca.'; end if;
  if v_nombre is not null and char_length(v_nombre) not between 2 and 60 then raise exception 'El nombre comercial debe tener entre 2 y 60 letras'; end if;
  if v_color !~ '^#[0-9A-F]{6}$' then raise exception 'El color principal debe ser un color como #F2582B'; end if;
  if v_acento is not null and v_acento !~ '^#[0-9A-F]{6}$' then raise exception 'El color de acento debe ser un color como #F08A30'; end if;
  if v_sub is not null then
    if v_sub !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then raise exception 'La dirección corta usa solo letras, números y guiones (3 a 40 caracteres)'; end if;
    if v_sub in ('www', 'app', 'consola', 'admin', 'api', 'mail', 'correo', 'soporte', 'ayuda', 'descargar', 'gpunlock', 'demo', 'login', 'registro', 'cuenta', 'embed', 'assets', 'css', 'js') then
      raise exception 'Esa dirección corta está reservada, elige otra';
    end if;
  end if;
  if p_logo is not null and p_logo !~* ('^' || p_org::text || '/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$') then raise exception 'Logo no válido'; end if;
  if p_logo_oscuro is not null and p_logo_oscuro !~* ('^' || p_org::text || '/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$') then raise exception 'Logo oscuro no válido'; end if;
  select plan_id into v_plan from public.organizaciones where id = p_org;
  if coalesce(p_ocultar_pie, false) and v_plan <> 'agencia' then
    raise exception 'Quitar «Con la tecnología de GPUnlock» es parte del plan Agencia';
  end if;

  begin
    insert into public.org_marca (org_id, nombre_comercial, subdominio, color_primario, color_acento, logo_path, logo_oscuro_path, mostrar_pie_gpunlock)
    values (p_org, v_nombre, v_sub, v_color, v_acento, p_logo, p_logo_oscuro, not coalesce(p_ocultar_pie, false))
    on conflict (org_id) do update set
      nombre_comercial = excluded.nombre_comercial, subdominio = excluded.subdominio, color_primario = excluded.color_primario,
      color_acento = excluded.color_acento, logo_path = excluded.logo_path, logo_oscuro_path = excluded.logo_oscuro_path,
      mostrar_pie_gpunlock = excluded.mostrar_pie_gpunlock
    returning * into v_fila;
  exception when unique_violation then
    raise exception 'Esa dirección corta ya está en uso, elige otra';
  end;
  return to_jsonb(v_fila);
end;
$$;

-- ----------------------------------------------- marca pública (pantalla de inicio de sesión) ---
-- Devuelve solo datos de marca de UNA empresa y solo si se conoce su dirección corta exacta.
create or replace function public.marca_publica(p_subdominio text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nombre', coalesce(m.nombre_comercial, o.nombre),
    'color_primario', m.color_primario,
    'color_acento', m.color_acento,
    'logo_path', m.logo_path,
    'logo_oscuro_path', m.logo_oscuro_path,
    'mostrar_pie_gpunlock', m.mostrar_pie_gpunlock)
  from public.org_marca m join public.organizaciones o on o.id = m.org_id
  where m.subdominio = lower(btrim(coalesce(p_subdominio, '')))
$$;

revoke execute on function public.guardar_marca(uuid, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.guardar_marca(uuid, text, text, text, text, text, text, boolean) to authenticated;
revoke execute on function public.marca_publica(text) from public;
grant execute on function public.marca_publica(text) to anon, authenticated;

-- Tiempo real: cuando la empresa cambia su marca, todo el equipo la recibe sin recargar.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'org_marca') then
    alter publication supabase_realtime add table public.org_marca;
  end if;
end $$;
