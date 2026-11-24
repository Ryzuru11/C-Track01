import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Login from './Login';
import * as apiService from '../../services/api';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../services/api', () => ({
  login: vi.fn(),
}));

const fillAndSubmit = (email, password) => {
  fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
};

const mockLoginAs = (user) => {
  vi.spyOn(apiService, 'login').mockImplementation(async () => {
    localStorage.setItem('token', 'valid-token');
    localStorage.setItem('user', JSON.stringify(user));
    return { success: true };
  });
};

describe('Login Component', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders login form with email, password fields and submit button', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /Welcome Back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
  });

  it('shows error if API returns 401 unauthorized', async () => {
    vi.spyOn(apiService, 'login').mockRejectedValueOnce({
      response: { status: 401 },
    });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    fillAndSubmit('wrong@example.com', 'wrongpassword');

    await waitFor(() => {
      expect(screen.getByText(/Invalid email or password/i)).toBeInTheDocument();
    });
  });

  it('shows the server message when web login is refused for a mobile-only role (403)', async () => {
    vi.spyOn(apiService, 'login').mockRejectedValueOnce({
      response: { status: 403, data: { message: 'Web access is not available for this role' } },
    });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    fillAndSubmit('employee@example.com', 'password123');

    await waitFor(() => {
      expect(screen.getByText(/Web access is not available for this role/i)).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('blocks a mobile-platform account that slipped through and shows the restriction message', async () => {
    mockLoginAs({ role: 'employee', platform: 'mobile', permissions: [] });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    fillAndSubmit('employee@example.com', 'password123');

    await waitFor(() => {
      expect(
        screen.getByText(/Employee accounts can only access the mobile application/i)
      ).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('logs in admin and navigates to /dashboard', async () => {
    mockLoginAs({ role: 'admin', platform: 'web', permissions: ['dashboard.view', 'tasks.view'] });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    fillAndSubmit('admin@example.com', 'correctpassword');

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'), { timeout: 1000 });
  });

  it('navigates to the first allowed page when the role has no dashboard access', async () => {
    mockLoginAs({ role: 'supervisor', platform: 'web', permissions: ['assignments.view'] });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    fillAndSubmit('supervisor@example.com', 'correctpassword');

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/taken'), { timeout: 1000 });
  });
});
