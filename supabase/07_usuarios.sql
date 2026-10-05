-- ============================================================================
-- GPUnlock · 07 · Roles del equipo
-- Deja UNA sola cuenta con rol: el editor. Cualquier otra fila (por ejemplo de
-- una instalación anterior) se elimina. La CUENTA (correo + contraseña) se crea
-- aparte: Authentication → Users → Add user, o con scripts/crear_usuarios.mjs.
-- Después, el editor puede agregar o cambiar roles desde el panel.
-- ============================================================================

insert into public.user_roles (email, role, nombre) values
  ('gabichopalomeque@gmail.com', 'editor', null)
on conflict (email) do update set role = excluded.role;

delete from public.user_roles where email <> 'gabichopalomeque@gmail.com';
