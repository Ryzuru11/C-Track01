import { useEffect, useState } from 'react';
import {
  RBAC_CHANGED_EVENT,
  getCurrentUser,
  getUserPermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  canAccessPage,
  getRoleMeta,
} from '../utils/auth';

/**
 * Re-renders the calling component whenever the stored user / permissions
 * change (login, GET /auth/me resync, socket `rbac:updated`, other tabs).
 *
 * @returns {{
 *   user: Object|null,
 *   permissions: string[],
 *   role: ReturnType<typeof getRoleMeta>,
 *   can: (key: string) => boolean,
 *   canAny: (keys: string[]) => boolean,
 *   canAll: (keys: string[]) => boolean,
 *   canAccessPage: (pageKey: string|string[]) => boolean,
 *   version: number,
 * }}
 */
export default function useAccess() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const onStorage = (e) => {
      if (e.key === 'user' || e.key === null) bump();
    };
    window.addEventListener(RBAC_CHANGED_EVENT, bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(RBAC_CHANGED_EVENT, bump);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return {
    user: getCurrentUser(),
    permissions: getUserPermissions(),
    role: getRoleMeta(),
    can: hasPermission,
    canAny: hasAnyPermission,
    canAll: hasAllPermissions,
    canAccessPage,
    version,
  };
}
