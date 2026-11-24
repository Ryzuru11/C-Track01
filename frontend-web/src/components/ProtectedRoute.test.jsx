import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import * as apiService from '../services/api';
import { RBAC_CHANGED_EVENT, initSession } from '../utils/auth';

// Mock Sidebar component to isolate ProtectedRoute
vi.mock('../pages/shared/Sidebar', () => ({
  default: () => <aside data-testid="mock-sidebar">Sidebar</aside>,
}));

vi.mock('../services/api', () => ({
  refreshCurrentUser: vi.fn(),
  logout: vi.fn(),
}));

const login = (user) => {
  localStorage.setItem('token', 'fake-token');
  localStorage.setItem('user', JSON.stringify(user));
  initSession();
};

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute permission="DASHBOARD">
              <div>Dashboard Content</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/task"
          element={
            <ProtectedRoute permission="TASK">
              <div>Task Content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe('ProtectedRoute Component (RBAC v2)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('redirects to /login when there is no valid session', () => {
    renderAt('/dashboard');

    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
  });

  it('logs out and redirects to /login when the role platform is mobile', () => {
    login({ id: 'e1', role: 'employee', platform: 'mobile', permissions: [] });

    renderAt('/dashboard');

    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('renders children and sidebar when the user has the page permission', () => {
    login({ id: 'a1', role: 'admin', platform: 'web', permissions: ['dashboard.view'] });

    renderAt('/dashboard');

    expect(screen.getByTestId('mock-sidebar')).toBeInTheDocument();
    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
  });

  it('redirects a denied page to the first allowed page (no /dashboard loop)', () => {
    login({ id: 'c1', role: 'custom', platform: 'web', permissions: ['tasks.view'] });

    renderAt('/dashboard');

    expect(screen.getByText('Task Content')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
  });

  it('shows the NoAccess screen when no page is allowed', () => {
    login({ id: 'c2', role: 'custom', platform: 'web', permissions: [] });

    renderAt('/dashboard');

    expect(screen.getByRole('heading', { name: /Tidak ada akses/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Logout/i })).toBeInTheDocument();
    expect(screen.queryByTestId('mock-sidebar')).not.toBeInTheDocument();
  });

  it('fetches /auth/me once for an old session without permissions, then renders', async () => {
    login({ id: 'a1', role: 'admin' });
    vi.mocked(apiService.refreshCurrentUser).mockImplementation(async () => {
      const user = { id: 'a1', role: 'admin', platform: 'web', permissions: ['dashboard.view'] };
      localStorage.setItem('user', JSON.stringify(user));
      return user;
    });

    renderAt('/dashboard');

    expect(screen.getByText(/Memuat hak akses/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Dashboard Content')).toBeInTheDocument());
    expect(apiService.refreshCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('moves the user away when the page permission is revoked live', async () => {
    login({ id: 'm1', role: 'manager', platform: 'web', permissions: ['dashboard.view', 'tasks.view'] });

    renderAt('/dashboard');
    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();

    act(() => {
      localStorage.setItem('user', JSON.stringify({ id: 'm1', role: 'manager', platform: 'web', permissions: ['tasks.view'] }));
      window.dispatchEvent(new CustomEvent(RBAC_CHANGED_EVENT));
    });

    await waitFor(() => expect(screen.getByText('Task Content')).toBeInTheDocument());
  });
});
