-- Simula lo mínimo de Supabase para probar el SQL en un Postgres normal
-- (roles, auth.users, auth.uid(), auth.jwt(), storage y la publicación realtime).
-- SOLO para pruebas locales y CI: en Supabase todo esto ya existe.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- Como en Supabase: pgcrypto vive en el esquema «extensions», que NO está en el search_path de las
-- funciones con `set search_path = public`. Si el SQL usa gen_random_bytes() sin calificar, falla aquí.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant select on all tables in schema storage to authenticated;
grant insert, update, delete on storage.objects to authenticated;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

create publication supabase_realtime;

-- Ayudas de prueba
create schema if not exists test;
grant usage on schema test to public;
create or replace function test.login(p_id uuid, p_email text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated')::text, false);
  set role authenticated;
end $f$;
create or replace function test.anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '{}', false);
  set role anon;
end $f$;
create or replace function test.assert(p_ok boolean, p_msg text) returns void language plpgsql as $f$
begin
  if p_ok is not true then raise exception 'FALLÓ: %', p_msg; end if;
  raise notice 'ok  - %', p_msg;
end $f$;
-- Verifica que una sentencia sea rechazada (devuelve el texto del error).
create or replace function test.falla(p_sql text, p_msg text) returns void language plpgsql as $f$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok  - % (rechazado: %)', p_msg, left(sqlerrm, 70);
    return;
  end;
  raise exception 'FALLÓ: se esperaba un error en: %', p_msg;
end $f$;
