/**
 * Authentication and Authorization Utilities (RBAC v2)
 *
 * Access is permission-based: the backend returns `user.permissions`
 * (array of keys such as "tasks.create") on login and on GET /auth/me.
 * The client never checks role names to decide what a user can do;
 * superadmin simply receives every permission key from the server.
 */

/** Window event dispatched whenever the stored user / permissions change. */
export const RBAC_CHANGED_EVENT = 'rbac:changed';

/**
 * Page key → permission key, or an array of keys meaning "any of".
 * Keys are used by ProtectedRoute, Sidebar and canAccessPage().
 */
export const PAGE_PERMISSIONS = {
  DASHBOARD: 'dashboard.view',
  ANALYTICS: 'analytics.view',
  TASK: 'tasks.view',
  TAKEN: 'assignments.view',
  MONITORING: ['monitoring.view_reports', 'monitoring.view_locations'],
  USER_MANAGEMENT: 'users.view',
  TEAM_MANAGEMENT: 'teams.view',
  CHATBOT: 'ai.use',
  ROLES: 'roles.manage',
};

/**
 * Navigable pages in sidebar order. Used to find the first page a user
 * may open (redirect target when a page is denied).
 */
export const PAGE_ORDER = [
  { page: 'DASHBOARD', path: '/dashboard' },
  { page: 'ANALYTICS', path: '/analytics' },
  { page: 'TASK', path: '/task' },
  { page: 'TAKEN', path: '/taken' },
  { page: 'USER_MANAGEMENT', path: '/users' },
  { page: 'TEAM_MANAGEMENT', path: '/teams' },
  { page: 'ROLES', path: '/roles' },
  { page: 'CHATBOT', path: '/chatbot' },
];

/**
 * Get current user from localStorage
 * @returns {Object|null} User object or null
 */
export const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (error) {
    console.error('Error parsing user data:', error);
    return null;
  }
};

/**
 * Store the user object (without the large avatar) and notify listeners.
 * @param {Object} user - User returned by /auth/login or /auth/me
 */
export const setStoredUser = (user) => {
  if (!user) return;
  const { avatar: _avatar, ...userWithoutAvatar } = user;
  localStorage.setItem('user', JSON.stringify(userWithoutAvatar));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RBAC_CHANGED_EVENT, { detail: userWithoutAvatar }));
  }
};

/**
 * Get current user's role name (slug). Display only; never use it for access checks.
 * @returns {string|null} Role name or null
 */
export const getUserRole = () => {
  const user = getCurrentUser();
  if (!user) return null;

  if (user.role && typeof user.role === 'string') {
    return user.role.toLowerCase();
  }

  // Legacy Laravel format returns roles as an array of objects
  if (user.roles && user.roles.length > 0) {
    return user.roles[0].name.toLowerCase();
  }

  return null;
};

/**
 * Role metadata for display (sidebar, chips).
 * @returns {{name: string|null, displayName: string, level: number|null, color: string|null}}
 */
export const getRoleMeta = () => {
  const user = getCurrentUser();
  const name = getUserRole();
  const fallbackName = name ? name.charAt(0).toUpperCase() + name.slice(1) : 'User';
  return {
    name,
    displayName: user?.roleDisplayName || fallbackName,
    level: typeof user?.roleLevel === 'number' ? user.roleLevel : null,
    color: user?.roleColor || null,
  };
};

/**
 * Get authentication token from localStorage
 * @returns {string|null} Token or null
 */
export const getToken = () => {
  return localStorage.getItem('token');
};

/**
 * Check if user is authenticated
 * @returns {boolean} True if authenticated
 */
export const isAuthenticated = () => {
  const token = getToken();
  const user = getCurrentUser();
  return !!(token && user);
};

/**
 * True when the stored user carries a permissions array (i.e. not an old session).
 * @returns {boolean}
 */
export const hasPermissionData = () => {
  const user = getCurrentUser();
  return Array.isArray(user?.permissions);
};

/**
 * Permission keys of the current user.
 * @returns {string[]} Empty array when unknown
 */
export const getUserPermissions = () => {
  const user = getCurrentUser();
  return Array.isArray(user?.permissions) ? user.permissions : [];
};

/**
 * @param {string} key - Permission key, e.g. "tasks.delete"
 * @returns {boolean}
 */
export const hasPermission = (key) => {
  if (!key) return false;
  return getUserPermissions().includes(key);
};

/**
 * @param {string[]} keys - Permission keys
 * @returns {boolean} True if the user has at least one of them
 */
export const hasAnyPermission = (keys = []) => {
  const permissions = getUserPermissions();
  return keys.some((key) => permissions.includes(key));
};

/**
 * @param {string[]} keys - Permission keys
 * @returns {boolean} True if the user has every one of them
 */
export const hasAllPermissions = (keys = []) => {
  const permissions = getUserPermissions();
  return keys.every((key) => permissions.includes(key));
};

/**
 * Check if user can access a page.
 * @param {string|string[]} pageKey - Key of PAGE_PERMISSIONS, or an array of keys (any-of)
 * @returns {boolean}
 */
export const canAccessPage = (pageKey) => {
  if (!isAuthenticated()) return false;
  if (Array.isArray(pageKey)) return pageKey.some((key) => canAccessPage(key));

  const required = PAGE_PERMISSIONS[pageKey];
  if (!required) return false;
  return Array.isArray(required) ? hasAnyPermission(required) : hasPermission(required);
};

/**
 * Web access is decided by the role's platform (employee = mobile only).
 * @returns {boolean}
 */
export const canAccessWeb = () => {
  const user = getCurrentUser();
  return user?.platform === 'web';
};

/**
 * First page (sidebar order) the current user may open.
 * @returns {string|null} Path, or null when nothing is allowed
 */
export const firstAllowedPath = () => {
  const entry = PAGE_ORDER.find(({ page }) => canAccessPage(page));
  return entry ? entry.path : null;
};

/**
 * Clear authentication data (logout)
 */
export const clearAuth = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('isAuthenticated');
  localStorage.removeItem('rememberMe');
  localStorage.removeItem('sessionExpiry');
};

/**
 * Session Management
 */

// Session timeout: 8 hours (in milliseconds)
const SESSION_TIMEOUT = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Initialize session with expiry time
 */
export const initSession = () => {
  const expiryTime = Date.now() + SESSION_TIMEOUT;
  localStorage.setItem('sessionExpiry', expiryTime.toString());
};

/**
 * Check if session is valid
 * @returns {boolean} True if session is still valid
 */
export const isSessionValid = () => {
  const expiryTime = localStorage.getItem('sessionExpiry');
  if (!expiryTime) return false;

  return Date.now() < parseInt(expiryTime, 10);
};

/**
 * Refresh session expiry time
 */
export const refreshSession = () => {
  if (isAuthenticated()) {
    initSession();
  }
};

/**
 * Check session and return authentication status
 * Clears auth if session expired
 * @returns {boolean} True if authenticated and session valid
 */
export const checkSession = () => {
  if (!isAuthenticated()) return false;

  if (!isSessionValid()) {
    clearAuth();
    return false;
  }

  return true;
};

/**
 * Get remaining session time in minutes
 * @returns {number} Minutes remaining in session
 */
export const getSessionTimeRemaining = () => {
  const expiryTime = localStorage.getItem('sessionExpiry');
  if (!expiryTime) return 0;

  const remaining = parseInt(expiryTime, 10) - Date.now();
  return Math.max(0, Math.floor(remaining / 60000)); // Convert to minutes
};

/**
 * Setup session activity listener
 * Refreshes session on user activity
 */
export const setupSessionListener = () => {
  const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];

  const refreshOnActivity = () => {
    if (checkSession()) {
      refreshSession();
    }
  };

  events.forEach(event => {
    document.addEventListener(event, refreshOnActivity, { passive: true });
  });
};
