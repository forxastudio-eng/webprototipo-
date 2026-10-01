-- ============================================================================
-- GPUnlock · Plataforma unificada — 01 · Roles y permisos
-- Ejecutar en orden: 01 → 02 → 03 → 04 → 05 → 06 (SQL Editor → New query → Run).
-- Todos los archivos son seguros de volver a ejecutar.
--
-- Modelo: el rol de cada persona se define por su CORREO en public.user_roles.
-- Así los roles pueden cargarse antes de crear las cuentas, y el editor puede
-- administrarlos desde el panel (Usuarios y roles) sin tocar SQL.
--
--   editor         → acceso total: crea, edita y elimina en todo el panel.
--   administrador  → lee todo, descarga tablas, ve el historial y sus
--                    dashboards; SOLO puede cambiar el estado de las unidades.
--   marketing      → lee todo, descarga tablas, ve el historial y sus
--                    dashboards; SOLO puede editar el dashboard de marketing.
--   asesor         → solo usa el cotizador (sin historial, sin panel).
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.user_roles (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('editor','administrador','marketing','asesor')),
  nombre text,
  created_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;

-- Rol de la persona que hace la consulta (null si no tiene rol asignado).
-- security definer: lee user_roles sin pasar por su propio RLS.
create or replace function public.mi_rol()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.user_roles
  where email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.tiene_rol(variadic roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.mi_rol() = any(roles), false)
$$;

grant execute on function public.mi_rol() to authenticated;
grant execute on function public.tiene_rol(text[]) to authenticated;

-- Registro de actividad (se muestra en el Escritorio del panel).
create table if not exists public.actividad (
  id bigint generated always as identity primary key,
  email text,
  accion text not null,
  detalle text,
  created_at timestamptz not null default now()
);
alter table public.actividad enable row level security;
