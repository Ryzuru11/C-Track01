import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Taken from './Taken';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getAssignments: vi.fn(),
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
  getTasks: vi.fn(),
  getUsers: vi.fn(),
  getTeams: vi.fn(),
  getUserAvatar: vi.fn(async () => ({ avatar: null })),
}));

const TASK = {
  taskId: 'task-1', ticketNumber: 'TSK-0001', title: 'Inspeksi Tower A', location: 'Jl. Malioboro',
  createdByRole: { name: 'manager', displayName: 'Manager', color: '#0891b2', showBadge: true },
};
const ASSIGNMENT = {
  takenTaskId: 'tt-1', ticketNumber: 'ASN-0001', taskId: 'task-1', status: 'pending',
  date: '2026-10-27T00:00:00.000Z', startTime: '2026-10-27T01:00:00.000Z',
  userIds: ['e1'], userStatuses: { e1: 'pending' },
  users: [{ id: 'e1', name: 'Budi Karyawan', email: 'e1@example.com' }],
  task: TASK, reports: [], locations: [],
};
const USERS = [
  { id: 'e1', name: 'Budi Karyawan', email: 'e1@example.com', role: 'employee', platform: 'mobile', status: 'active' },
  { id: 'e2', name: 'Siti Karyawan', email: 'e2@example.com', role: 'employee', platform: 'mobile', status: 'active' },
  { id: 'a1', name: 'John Admin', email: 'a1@example.com', role: 'admin', platform: 'web', status: 'active' },
];

const loginAs = (permissions) => {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ id: 'me', role: 'admin', platform: 'web', permissions }));
};

const renderTaken = () => render(<MemoryRouter><Taken /></MemoryRouter>);
const rowOf = async (text) => (await screen.findAllByText(text))[0].closest('tr');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.getAssignments.mockResolvedValue({ takenTasks: [ASSIGNMENT] });
  api.getTasks.mockResolvedValue({ tasks: [TASK] });
  api.getUsers.mockResolvedValue({ users: USERS });
  api.getTeams.mockResolvedValue({ teams: [] });
  api.updateAssignment.mockResolvedValue({ takenTask: ASSIGNMENT });
});

describe('Taken (assignments) — RBAC and edit', () => {
  it('shows the creator badge next to the task title', async () => {
    loginAs(['assignments.view']);
    renderTaken();
    const row = await rowOf('Inspeksi Tower A');
    expect(row).toHaveTextContent('Dibuat oleh Manager');
  });

  it('view-only access hides edit/delete and does not load the pickers', async () => {
    loginAs(['assignments.view']);
    renderTaken();
    const row = await rowOf('Inspeksi Tower A');

    expect(row.querySelector('.edit-btn')).toBeNull();
    expect(row.querySelector('.delete-btn')).toBeNull();
    expect(api.getUsers).not.toHaveBeenCalled();
    expect(api.getTeams).not.toHaveBeenCalled();
  });

  it('edits an assignment: pre-fills it, lists only mobile employees, and saves with PUT', async () => {
    loginAs(['assignments.view', 'assignments.update']);
    renderTaken();
    const row = await rowOf('Inspeksi Tower A');
    await waitFor(() => expect(api.getUsers).toHaveBeenCalled());

    fireEvent.click(row.querySelector('.edit-btn'));
    expect(await screen.findByRole('heading', { name: 'Edit Assignment' })).toBeInTheDocument();

    const available = document.querySelector('.available-users-container');
    expect(available).toHaveTextContent('Siti Karyawan');
    expect(available).not.toHaveTextContent('John Admin'); // web roles are never assignable
    expect(available).not.toHaveTextContent('Budi Karyawan'); // already assigned

    fireEvent.click(screen.getByText('Siti Karyawan'));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' }));

    await waitFor(() => expect(api.updateAssignment).toHaveBeenCalledTimes(1));
    const [id, payload] = api.updateAssignment.mock.calls[0];
    expect(id).toBe('tt-1');
    expect(payload.userIds).toEqual(['e1', 'e2']);
    expect(payload.startTime).toBeTruthy();
    expect(api.createAssignment).not.toHaveBeenCalled();
  });

  it('shows the server message when the update is refused', async () => {
    api.updateAssignment.mockRejectedValueOnce({ response: { data: { message: 'Penugasan yang sudah selesai tidak dapat diubah' } } });
    loginAs(['assignments.view', 'assignments.update']);
    renderTaken();
    const row = await rowOf('Inspeksi Tower A');
    await waitFor(() => expect(api.getUsers).toHaveBeenCalled());

    fireEvent.click(row.querySelector('.edit-btn'));
    fireEvent.click(await screen.findByRole('button', { name: 'Simpan Perubahan' }));

    const shown = await screen.findAllByText('Penugasan yang sudah selesai tidak dapat diubah');
    expect(shown.length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Edit Assignment' })).toBeInTheDocument(); // modal stays open
  });
});
