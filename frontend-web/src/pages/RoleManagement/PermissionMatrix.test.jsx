import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PermissionMatrix from './PermissionMatrix';
import { diffPermissions, togglePermission } from './permissionUtils';

const MODULES = [
  {
    module: 'dashboard',
    label: 'Dashboard Overview',
    permissions: [{ key: 'dashboard.view', label: 'Lihat Dashboard Overview', isBase: true }],
  },
  {
    module: 'tasks',
    label: 'Task Management',
    permissions: [
      { key: 'tasks.view', label: 'Lihat task', isBase: true },
      { key: 'tasks.create', label: 'Buat task', requires: ['tasks.view'] },
      { key: 'tasks.update', label: 'Ubah task', requires: ['tasks.view'] },
      { key: 'tasks.delete', label: 'Hapus task', requires: ['tasks.view'] },
      { key: 'tasks.toggle_status', label: 'Aktifkan / nonaktifkan task', requires: ['tasks.view'] },
    ],
  },
  {
    module: 'monitoring',
    label: 'Monitoring Karyawan',
    permissions: [
      { key: 'monitoring.view_reports', label: 'Lihat laporan' },
      { key: 'monitoring.view_locations', label: 'Lihat lokasi' },
      { key: 'monitoring.manage_reports', label: 'Selesaikan / hapus laporan', requires: ['monitoring.view_reports'] },
    ],
  },
  {
    module: 'roles',
    label: 'Roles & Hak Akses',
    permissions: [{ key: 'roles.manage', label: 'Kelola role & hak akses', locked: true }],
  },
];

function Harness({ initial = [], readOnly = false }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PermissionMatrix modules={MODULES} value={value} onChange={setValue} readOnly={readOnly} roleName="Manager" />
      <output data-testid="value">{value.join(',')}</output>
    </>
  );
}

const box = (name) => screen.getByRole('checkbox', { name });
const valueOf = () => screen.getByTestId('value').textContent;

describe('PermissionMatrix', () => {
  it('renders an accessible table with a caption and labelled checkboxes', () => {
    render(<Harness initial={['tasks.view']} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/Hak akses Manager: 1 dari 10 aktif/i)).toBeInTheDocument();
    expect(box('Task Management — Hapus')).toBeInTheDocument();
    expect(box('Monitoring Karyawan — Lihat lokasi')).toBeInTheDocument();
    // Locked permission is not a checkbox
    expect(screen.queryByRole('checkbox', { name: /Roles & Hak Akses/i })).not.toBeInTheDocument();
    expect(screen.getByText('Khusus Superadmin')).toBeInTheDocument();
  });

  it('ticking an action also ticks Lihat for that module', () => {
    render(<Harness />);

    fireEvent.click(box('Task Management — Hapus'));

    expect(box('Task Management — Hapus')).toBeChecked();
    expect(box('Task Management — Lihat')).toBeChecked();
    expect(valueOf()).toBe('tasks.view,tasks.delete');
  });

  it('unticking Lihat clears the whole row and shows the inline note', () => {
    render(<Harness initial={['dashboard.view', 'tasks.view', 'tasks.create', 'tasks.update', 'tasks.toggle_status']} />);

    fireEvent.click(box('Task Management — Lihat'));

    expect(box('Task Management — Lihat')).not.toBeChecked();
    expect(box('Task Management — Buat')).not.toBeChecked();
    expect(box('Task Management — Ubah')).not.toBeChecked();
    expect(box('Task Management — Aktifkan / nonaktifkan task')).not.toBeChecked();
    expect(valueOf()).toBe('dashboard.view');
    expect(screen.getByText('Aksi lain memerlukan akses Lihat')).toBeInTheDocument();
  });

  it('follows explicit requires for modules without a Lihat column (monitoring)', () => {
    render(<Harness />);

    fireEvent.click(box('Monitoring Karyawan — Selesaikan / hapus laporan'));
    expect(valueOf()).toBe('monitoring.view_reports,monitoring.manage_reports');

    fireEvent.click(box('Monitoring Karyawan — Lihat laporan'));
    expect(valueOf()).toBe('');
  });

  it('clicking the row header toggles the whole row', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Task Management' }));
    expect(valueOf()).toBe('tasks.view,tasks.create,tasks.update,tasks.delete,tasks.toggle_status');

    fireEvent.click(screen.getByRole('button', { name: 'Task Management' }));
    expect(valueOf()).toBe('');
  });

  it('"Pilih semua" selects every grantable key but never the locked one', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Pilih semua' }));
    expect(valueOf().split(',')).toHaveLength(9);
    expect(valueOf()).not.toContain('roles.manage');
    expect(screen.getByText(/dari 10 hak akses aktif/i)).toHaveTextContent('9 dari 10 hak akses aktif');

    fireEvent.click(screen.getByRole('button', { name: 'Kosongkan' }));
    expect(valueOf()).toBe('');
  });

  it('read-only mode disables every checkbox', () => {
    render(<Harness initial={['tasks.view']} readOnly />);

    expect(box('Task Management — Lihat')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Pilih semua' })).not.toBeInTheDocument();
  });
});

describe('permission diff', () => {
  it('counts added and removed keys correctly', () => {
    const before = ['dashboard.view', 'tasks.view', 'tasks.create'];
    let after = togglePermission(before, 'tasks.delete', true, MODULES);
    after = togglePermission(after, 'monitoring.view_locations', true, MODULES);
    after = togglePermission(after, 'tasks.create', false, MODULES);

    const diff = diffPermissions(before, after);
    expect(diff.added).toEqual(['tasks.delete', 'monitoring.view_locations']);
    expect(diff.removed).toEqual(['tasks.create']);
  });
});
