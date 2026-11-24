import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RoleEditor from './RoleEditor';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  createRole: vi.fn(),
  updateRole: vi.fn(),
  updateRolePermissions: vi.fn(),
  getRole: vi.fn(),
  getRoleAudit: vi.fn(),
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const MODULES = [
  { module: 'dashboard', label: 'Dashboard Overview', permissions: [{ key: 'dashboard.view', label: 'Lihat', isBase: true }] },
  {
    module: 'tasks', label: 'Task Management', permissions: [
      { key: 'tasks.view', label: 'Lihat task', isBase: true },
      { key: 'tasks.create', label: 'Buat task', requires: ['tasks.view'] },
      { key: 'tasks.delete', label: 'Hapus task', requires: ['tasks.view'] },
    ],
  },
  { module: 'roles', label: 'Roles & Hak Akses', permissions: [{ key: 'roles.manage', label: 'Kelola role', locked: true }] },
];

const editableSystem = { permissions: true, details: true, showTaskBadge: true, name: false, level: false, delete: false };
const nothingEditable = { permissions: false, details: false, showTaskBadge: false, name: false, level: false, delete: false };

const ADMIN_ROLE = {
  id: '2', name: 'admin', displayName: 'Admin', description: '', level: 50, platform: 'web', isSystem: true,
  color: '#2563eb', showTaskBadge: false, userCount: 3, permissions: ['dashboard.view', 'tasks.view'], editable: editableSystem,
};
const SUPERADMIN_ROLE = {
  id: '1', name: 'superadmin', displayName: 'Superadmin', level: 100, platform: 'web', isSystem: true,
  color: '#7c3aed', showTaskBadge: false, userCount: 1, permissions: ['dashboard.view', 'tasks.view', 'tasks.create', 'tasks.delete', 'roles.manage'],
  editable: nothingEditable,
};

const renderEditor = (props) => {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onCatalogStale: vi.fn() };
  render(
    <MemoryRouter>
      <RoleEditor modules={MODULES} roles={[ADMIN_ROLE]} {...handlers} {...props} />
    </MemoryRouter>
  );
  return handlers;
};

const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RoleEditor — create', () => {
  it('generates the role code from the display name until the code is edited by hand', () => {
    renderEditor({ mode: 'create' });

    fireEvent.change(screen.getByLabelText(/Nama tampilan/), { target: { value: 'Supervisor Lapangan' } });
    expect(screen.getByLabelText('Kode role')).toHaveValue('supervisor_lapangan');

    fireEvent.change(screen.getByLabelText('Kode role'), { target: { value: 'spv' } });
    fireEvent.change(screen.getByLabelText(/Nama tampilan/), { target: { value: 'Supervisor' } });
    expect(screen.getByLabelText('Kode role')).toHaveValue('spv');
  });

  it('shows validation errors and does not call the API', async () => {
    renderEditor({ mode: 'create' });

    fireEvent.change(screen.getByLabelText('Level role (angka)'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Role' }));

    expect(await screen.findByText(/Nama tampilan wajib diisi/)).toBeInTheDocument();
    expect(screen.getByText(/Level harus antara 1 dan 99/)).toBeInTheDocument();
    expect(api.createRole).not.toHaveBeenCalled();
  });

  it('previews the task badge and sends it with the chosen permissions', async () => {
    api.createRole.mockResolvedValueOnce({ data: { id: '10', name: 'supervisor' }, meta: { autoAdded: [] } });
    const { onSaved } = renderEditor({ mode: 'create' });

    fireEvent.change(screen.getByLabelText(/Nama tampilan/), { target: { value: 'Supervisor' } });
    fireEvent.click(screen.getByLabelText(/Tampilkan badge pada task/));
    expect(screen.getAllByText('Dibuat oleh Supervisor').length).toBeGreaterThan(0);

    openTab('Hak Akses');
    fireEvent.click(screen.getByLabelText('Task Management — Hapus'));
    expect(screen.getByLabelText('Task Management — Lihat')).toBeChecked(); // include Read

    fireEvent.click(screen.getByRole('button', { name: 'Buat Role' }));

    await waitFor(() => expect(api.createRole).toHaveBeenCalledTimes(1));
    const payload = api.createRole.mock.calls[0][0];
    expect(payload).toMatchObject({ name: 'supervisor', displayName: 'Supervisor', level: 40, showTaskBadge: true });
    expect(payload.permissions.sort()).toEqual(['tasks.delete', 'tasks.view']);
    expect(onSaved).toHaveBeenCalledWith({ id: '10', name: 'supervisor' });
  });

  it('copies permissions from another role', () => {
    renderEditor({ mode: 'create' });
    fireEvent.change(screen.getByLabelText('Salin hak akses dari'), { target: { value: '2' } });

    openTab('Hak Akses');
    expect(screen.getByLabelText('Task Management — Lihat')).toBeChecked();
    expect(screen.getByLabelText('Task Management — Hapus')).not.toBeChecked();
  });

  it('asks the page to reload the catalog after a 422', async () => {
    api.createRole.mockRejectedValueOnce({ response: { status: 422, data: { message: 'Unknown permission' } } });
    const { onCatalogStale } = renderEditor({ mode: 'create' });

    fireEvent.change(screen.getByLabelText(/Nama tampilan/), { target: { value: 'Supervisor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Role' }));

    await waitFor(() => expect(onCatalogStale).toHaveBeenCalled());
  });
});

describe('RoleEditor — edit a system role', () => {
  it('locks the code and level, and saves only the fields that changed', async () => {
    api.updateRole.mockResolvedValueOnce({ data: { ...ADMIN_ROLE, showTaskBadge: true } });
    renderEditor({ mode: 'edit', role: ADMIN_ROLE });

    expect(screen.getByLabelText('Kode role')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Level role (angka)')).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Tampilkan badge pada task/));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan detail' }));

    await waitFor(() => expect(api.updateRole).toHaveBeenCalledWith('2', { showTaskBadge: true }));
  });

  it('saving permissions shows a diff confirmation before calling the API', async () => {
    api.updateRolePermissions.mockResolvedValueOnce({ data: ADMIN_ROLE, meta: { added: ['tasks.create'], removed: [], autoAdded: [] } });
    renderEditor({ mode: 'edit', role: ADMIN_ROLE });

    openTab('Hak Akses');
    fireEvent.click(screen.getByLabelText('Task Management — Buat'));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(api.updateRolePermissions).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/3 user/)).toBeInTheDocument(); // members affected

    const confirm = within(dialog).getAllByRole('button').find((b) => b.textContent !== 'Batal');
    fireEvent.click(confirm);

    await waitFor(() => expect(api.updateRolePermissions).toHaveBeenCalledTimes(1));
    expect(api.updateRolePermissions.mock.calls[0][0]).toBe('2');
    expect([...api.updateRolePermissions.mock.calls[0][1]].sort()).toEqual(['dashboard.view', 'tasks.create', 'tasks.view']);
  });

  it('loads the members tab lazily', async () => {
    api.getRole.mockResolvedValueOnce({ data: { ...ADMIN_ROLE, users: [{ id: 'u1', name: 'John Doe', email: 'john@example.com', status: 'active' }] } });
    renderEditor({ mode: 'edit', role: ADMIN_ROLE });

    expect(api.getRole).not.toHaveBeenCalled();
    openTab('Anggota');
    expect(await screen.findByText('John Doe')).toBeInTheDocument();
    expect(api.getRole).toHaveBeenCalledWith('2');
  });
});

describe('RoleEditor — superadmin (view only)', () => {
  it('opens read-only with an explanation and no save buttons', () => {
    renderEditor({ mode: 'edit', role: SUPERADMIN_ROLE });

    expect(screen.getByText(/selalu memiliki semua akses/)).toBeInTheDocument();
    expect(screen.getByLabelText('Task Management — Buat')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Simpan' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Tampilkan badge pada task/)).not.toBeInTheDocument();
  });
});
