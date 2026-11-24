import { describe, it, expect, beforeEach } from 'vitest';
import {
  PAGE_PERMISSIONS,
  getCurrentUser,
  getUserRole,
  getRoleMeta,
  isAuthenticated,
  hasPermissionData,
  getUserPermissions,
  hasPermission,
  hasAnyPermission,
  canAccessWeb,
  canAccessPage,
  firstAllowedPath,
  setStoredUser,
  RBAC_CHANGED_EVENT,
  clearAuth,
  initSession,
  isSessionValid,
} from './auth';

const login = (user) => {
  localStorage.setItem('token', 'fake-jwt-token');
  localStorage.setItem('user', JSON.stringify(user));
};

const ALL_PERMISSIONS = [
  'dashboard.view', 'analytics.view',
  'tasks.view', 'tasks.create', 'tasks.update', 'tasks.delete', 'tasks.toggle_status', 'tasks.import', 'tasks.export',
  'assignments.view', 'assignments.create', 'assignments.update', 'assignments.delete',
  'monitoring.view_reports', 'monitoring.view_locations', 'monitoring.manage_reports',
  'users.view', 'users.create', 'users.update', 'users.delete', 'users.toggle_status',
  'teams.view', 'teams.create', 'teams.update', 'teams.delete',
  'ai.use', 'roles.manage',
];

describe('Frontend Auth Utilities (RBAC v2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('Authentication and user', () => {
    it('returns null / false when no user is stored', () => {
      expect(getCurrentUser()).toBeNull();
      expect(getUserRole()).toBeNull();
      expect(isAuthenticated()).toBe(false);
      expect(getUserPermissions()).toEqual([]);
      expect(hasPermissionData()).toBe(false);
    });

    it('identifies an authenticated user with token and user object', () => {
      const user = { id: 'u1', name: 'Admin User', role: 'admin', platform: 'web', permissions: ['tasks.view'] };
      login(user);

      expect(isAuthenticated()).toBe(true);
      expect(getCurrentUser()).toEqual(user);
      expect(getUserRole()).toBe('admin');
      expect(hasPermissionData()).toBe(true);
    });

    it('parses the legacy Laravel roles array for the role name', () => {
      localStorage.setItem('user', JSON.stringify({ id: 'u2', roles: [{ name: 'SuperAdmin' }] }));
      expect(getUserRole()).toBe('superadmin');
    });

    it('getRoleMeta prefers server display fields and falls back to the slug', () => {
      login({ role: 'manager', roleDisplayName: 'Manager', roleLevel: 50, roleColor: '#0891b2' });
      expect(getRoleMeta()).toEqual({ name: 'manager', displayName: 'Manager', level: 50, color: '#0891b2' });

      login({ role: 'supervisor' });
      expect(getRoleMeta().displayName).toBe('Supervisor');
    });

    it('setStoredUser strips the avatar and dispatches rbac:changed', () => {
      let received = null;
      const listener = (e) => { received = e.detail; };
      window.addEventListener(RBAC_CHANGED_EVENT, listener);
      setStoredUser({ id: 'u1', avatar: 'base64...', permissions: ['ai.use'] });
      window.removeEventListener(RBAC_CHANGED_EVENT, listener);

      expect(getCurrentUser()).toEqual({ id: 'u1', permissions: ['ai.use'] });
      expect(received).toEqual({ id: 'u1', permissions: ['ai.use'] });
    });
  });

  describe('Permissions', () => {
    it('hasPermission / hasAnyPermission read user.permissions', () => {
      login({ id: 'm1', role: 'manager', platform: 'web', permissions: ['tasks.view', 'tasks.create'] });

      expect(hasPermission('tasks.view')).toBe(true);
      expect(hasPermission('tasks.delete')).toBe(false);
      expect(hasPermission('')).toBe(false);
      expect(hasAnyPermission(['tasks.delete', 'tasks.create'])).toBe(true);
      expect(hasAnyPermission(['users.view', 'roles.manage'])).toBe(false);
    });

    it('never special-cases role names: a "superadmin" without permissions has none', () => {
      login({ id: 'sa', role: 'superadmin', platform: 'web', permissions: [] });
      expect(hasPermission('roles.manage')).toBe(false);
      expect(canAccessPage('ROLES')).toBe(false);
    });

    it('canAccessWeb is decided by the role platform', () => {
      login({ role: 'admin', platform: 'web', permissions: [] });
      expect(canAccessWeb()).toBe(true);

      login({ role: 'employee', platform: 'mobile', permissions: [] });
      expect(canAccessWeb()).toBe(false);

      login({ role: 'admin' }); // old session without platform
      expect(canAccessWeb()).toBe(false);
    });
  });

  describe('Page access', () => {
    it('denies every page when not authenticated', () => {
      expect(canAccessPage('DASHBOARD')).toBe(false);
      expect(firstAllowedPath()).toBeNull();
    });

    it('maps page keys to permissions, MONITORING being any-of', () => {
      login({ role: 'custom', platform: 'web', permissions: ['monitoring.view_locations', 'ai.use'] });

      expect(PAGE_PERMISSIONS.MONITORING).toEqual(['monitoring.view_reports', 'monitoring.view_locations']);
      expect(canAccessPage('MONITORING')).toBe(true);
      expect(canAccessPage('CHATBOT')).toBe(true);
      expect(canAccessPage('DASHBOARD')).toBe(false);
      expect(canAccessPage('UNKNOWN_PAGE')).toBe(false);
      expect(canAccessPage(['DASHBOARD', 'CHATBOT'])).toBe(true);
    });

    it('admin defaults: no Analytics and no Roles page', () => {
      const adminPermissions = ALL_PERMISSIONS.filter((k) => !['analytics.view', 'users.delete', 'roles.manage'].includes(k));
      login({ role: 'admin', platform: 'web', permissions: adminPermissions });

      expect(canAccessPage('DASHBOARD')).toBe(true);
      expect(canAccessPage('USER_MANAGEMENT')).toBe(true);
      expect(canAccessPage('ANALYTICS')).toBe(false);
      expect(canAccessPage('ROLES')).toBe(false);
    });

    it('superadmin (all keys) can open the Roles page', () => {
      login({ role: 'superadmin', platform: 'web', permissions: ALL_PERMISSIONS });
      expect(canAccessPage('ROLES')).toBe(true);
      expect(canAccessPage('ANALYTICS')).toBe(true);
    });

    it('firstAllowedPath follows the sidebar order', () => {
      login({ role: 'x', platform: 'web', permissions: ALL_PERMISSIONS });
      expect(firstAllowedPath()).toBe('/dashboard');

      login({ role: 'x', platform: 'web', permissions: ['assignments.view', 'teams.view'] });
      expect(firstAllowedPath()).toBe('/taken');

      login({ role: 'x', platform: 'web', permissions: ['ai.use'] });
      expect(firstAllowedPath()).toBe('/chatbot');

      login({ role: 'x', platform: 'web', permissions: [] });
      expect(firstAllowedPath()).toBeNull();
    });
  });

  describe('Session Management & Logout', () => {
    it('clearAuth removes stored credentials and session data', () => {
      localStorage.setItem('token', 'fake-token');
      localStorage.setItem('user', JSON.stringify({ id: '1' }));
      localStorage.setItem('sessionExpiry', '123456789');

      clearAuth();

      expect(localStorage.getItem('token')).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
      expect(localStorage.getItem('sessionExpiry')).toBeNull();
    });

    it('initSession sets future expiry timestamp', () => {
      initSession();
      expect(isSessionValid()).toBe(true);
    });
  });
});
