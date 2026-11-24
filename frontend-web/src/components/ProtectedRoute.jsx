import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  isAuthenticated,
  canAccessPage,
  canAccessWeb,
  checkSession,
  setupSessionListener,
  clearAuth,
  hasPermissionData,
  firstAllowedPath,
} from '../utils/auth';
import { refreshCurrentUser } from '../services/api';
import useAccess from '../hooks/useAccess';
import Sidebar from '../pages/shared/Sidebar';
import NoAccess from './NoAccess';
import './NoAccess.css';

/**
 * Protected Route Component with permission-based access control (RBAC v2).
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components to render
 * @param {string|string[]} props.permission - Page key from PAGE_PERMISSIONS, or an array of page keys (any-of)
 * @param {boolean} props.requireAuth - Whether authentication is required (default: true)
 */
function ProtectedRoute({ children, permission, requireAuth = true }) {
  const location = useLocation();
  // Re-render when permissions change (socket rbac:updated, 403 resync, ...)
  useAccess();

  // Old sessions (before RBAC v2) have no permissions array: fetch /auth/me once first.
  const [loadingAccess, setLoadingAccess] = useState(() => checkSession() && !hasPermissionData());
  const wasAllowed = useRef(false);

  // Setup session activity listener on mount
  useEffect(() => {
    setupSessionListener();
  }, []);

  useEffect(() => {
    if (!loadingAccess) return undefined;
    let cancelled = false;
    refreshCurrentUser()
      .catch((error) => console.error('Failed to load access:', error))
      .finally(() => {
        if (!cancelled) setLoadingAccess(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadingAccess]);

  const sessionOk = checkSession() && (!requireAuth || isAuthenticated());
  const webOk = sessionOk && !loadingAccess && canAccessWeb();
  const allowed = webOk && (!permission || canAccessPage(permission));

  // Access revoked while the page was open → tell the user why they were moved.
  useEffect(() => {
    if (wasAllowed.current && webOk && !allowed) {
      toast.warning('Akses Anda ke halaman ini telah dicabut', { toastId: 'rbac-page-revoked' });
    }
    wasAllowed.current = allowed;
  }, [allowed, webOk]);

  if (!sessionOk) {
    // Session expired or not authenticated
    return <Navigate to="/login" replace />;
  }

  if (loadingAccess) {
    return <div className="no-access-loading">Memuat hak akses...</div>;
  }

  // Role platform must be web (employee accounts are mobile-only)
  if (!canAccessWeb()) {
    clearAuth();
    return <Navigate to="/login" replace />;
  }

  if (!allowed) {
    const target = firstAllowedPath();
    if (target && target !== location.pathname) {
      return <Navigate to={target} replace />;
    }
    return <NoAccess />;
  }

  // User is authenticated and has permission, render the page with layout
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-content">
        {children}
      </div>
    </div>
  );
}

export default ProtectedRoute;
