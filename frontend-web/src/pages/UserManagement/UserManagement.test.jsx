import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import UserManagement from './UserManagement';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getUsers: vi.fn(),
  getUserDetails: vi.fn(),
  createUser: vi.fn(),
  updateUserProfile: vi.fn(),
  updateUserStatus: vi.fn(),
  deleteUser: vi.fn(),
  getDepartments: vi.fn(),
  getUserAvatar: vi.fn(async () => ({ avatar: null })),
  uploadAvatar: vi.fn(),
  clearAvatarCache: vi.fn(),
  getAssignableRoles: vi.fn(),
}));

const ALL_USER_PERMS = ['users.view', 'users.create', 'users.update', 'users.delete', 'users.toggle_status'];

const loginAs = (permissions, role = 'admin') => {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 'me', role, platform: 'web', permissions }));
};

const user = (id, name, role, roleDisplayName, roleLevel, can) => ({
  id, name, email: `${id}@example.com`, status: 'active', department: 'Ops', position: 'Staff',
  role, roleDisplayName, roleLevel, roleColor: '#2563eb', can,
});

const USERS = [
  user('u-manager', 'Budi Manager', 'manager', 'Manager', 50, { update: false, delete: false, toggleStatus: false }),
  user('u-employee', 'Siti Karyawan', 'employee', 'Employee', 10, { update: true, delete: false, toggleStatus: true }),
  user('u-spv', 'Rian Supervisor', 'supervisor', 'Supervisor Lapangan', 40, { update: true, delete: false, toggleStatus: true }),
];

const rowOf = async (name) => (await screen.findAllByText(name))[0].closest('tr');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.getUsers.mockResolvedValue({ users: USERS });
  api.getAssignableRoles.mockResolvedValue({
    data: [
      { id: '5', name: 'supervisor', displayName: 'Supervisor Lapangan', platform: 'web', level: 40 },
      { id: '4', name: 'employee', displayName: 'Employee', platform: 'mobile', level: 10 },
    ],
  });
});

describe('UserManagement (RBAC)', () => {
  it('builds summary cards from the roles present, highest level first', async () => {
    loginAs(ALL_USER_PERMS);
    render(<UserManagement />);

    await screen.findAllByText('Budi Manager');
    const labels = [...document.querySelectorAll('.summary-card .label')].map((el) => el.textContent);
    expect(labels).toEqual(['Total', 'Manager', 'Supervisor Lapangan', 'Employee']);
  });

  it('disables row actions the server says the current user may not perform', async () => {
    loginAs(['users.view', 'users.update', 'users.toggle_status']);
    render(<UserManagement />);

    const managerRow = await rowOf('Budi Manager');
    const employeeRow = await rowOf('Siti Karyawan');

    const editOf = (row) => row.querySelector('.edit-btn');
    expect(editOf(managerRow)).toBeDisabled();
    expect(editOf(managerRow)).toHaveAttribute('title', 'Tidak dapat mengelola user dengan role setara/lebih tinggi');
    expect(editOf(employeeRow)).toBeEnabled();
    expect(employeeRow.querySelector('.toggle-btn')).toBeEnabled();
  });

  it('hides buttons for permissions the role does not have', async () => {
    loginAs(['users.view', 'users.update']);
    render(<UserManagement />);

    const row = await rowOf('Siti Karyawan');
    expect(row.querySelector('.delete-btn')).toBeNull();
    expect(row.querySelector('.toggle-btn')).toBeNull();
    expect(screen.queryByRole('button', { name: /Add User/i })).not.toBeInTheDocument();
  });

  it('offers only assignable roles when adding a user', async () => {
    loginAs(ALL_USER_PERMS);
    render(<UserManagement />);
    await screen.findAllByText('Budi Manager');
    await waitFor(() => expect(api.getAssignableRoles).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Add User/i }));
    const modal = document.querySelector('.modal-content');
    const roleSelect = within(modal).getAllByRole('combobox').find((s) => s.getAttribute('name') === 'role');
    const options = [...roleSelect.querySelectorAll('option')].map((o) => [o.value, o.textContent]);

    // Exactly what /roles/assignable returned; the mobile-only role is labelled as such
    expect(options).toEqual([
      ['supervisor', 'Supervisor Lapangan'],
      ['employee', 'Employee (Mobile)'],
    ]);
  });

  it('does not request assignable roles without create/update permission', async () => {
    loginAs(['users.view']);
    render(<UserManagement />);
    await screen.findAllByText('Budi Manager');
    expect(api.getAssignableRoles).not.toHaveBeenCalled();
  });
});
