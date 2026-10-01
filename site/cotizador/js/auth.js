// Guardia de sesión del cotizador (index, cotizador, admin, historial).
// Los permisos ya no salen de cotizador_admins sino del rol de la persona en
// public.user_roles (función mi_rol()), el mismo que usa el panel /admin/:
//   editor        → administra el cotizador y ve el historial
//   administrador → ve el historial y sus dashboards
//   marketing     → ve el historial y sus dashboards
//   asesor        → solo cotiza

const CotizadorAuth = (() => {
  let currentUser = null;
  let rol = null;

  async function cargarRol() {
    if (!currentUser) { rol = null; return null; }
    const { data, error } = await supabaseClient.rpc('mi_rol');
    rol = error ? null : data;
    return rol;
  }

  async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session ? session.user : null;
    if (currentUser) await cargarRol();
    return currentUser;
  }

  async function login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    await cargarRol();
    return currentUser;
  }

  async function logout() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    rol = null;
  }

  async function requireSession() {
    const user = await init();
    if (!user) { window.location.href = 'index.html'; return null; }
    return user;
  }

  async function requireAdmin() {
    const user = await requireSession();
    if (!user) return null;
    return { user, isAdmin: getIsAdmin() };
  }

  async function requireHistorialAccess() {
    const user = await requireSession();
    if (!user) return null;
    return { user, puedeVerHistorial: getPuedeVerHistorial() };
  }

  function getUser() { return currentUser; }
  function getRol() { return rol; }
  function getIsAdmin() { return rol === 'editor'; }
  function getPuedeVerHistorial() { return ['editor', 'administrador', 'marketing'].includes(rol); }
  function getPuedeEntrarPanel() { return ['editor', 'administrador', 'marketing'].includes(rol); }
  async function checkAdmin() { await cargarRol(); return getIsAdmin(); }

  return {
    init, login, logout, requireSession, requireAdmin, requireHistorialAccess,
    getUser, getRol, getIsAdmin, getPuedeVerHistorial, getPuedeEntrarPanel, checkAdmin,
  };
})();
