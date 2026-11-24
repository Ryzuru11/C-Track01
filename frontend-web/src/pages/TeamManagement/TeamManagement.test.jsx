import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TeamManagement from './TeamManagement';
import * as apiService from '../../services/api';

vi.mock('../../services/api', () => ({
  getTeams: vi.fn(),
  getTeam: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  removeTeamMember: vi.fn(),
  getUsers: vi.fn(),
  getUserAvatar: vi.fn(),
}));

describe('TeamManagement Component - Member Search in Add Team', () => {
  const mockUsers = [
    {
      id: 'u-1',
      name: 'Ahmad Dahlan',
      email: 'ahmad@example.com',
      department: 'IT Infrastructure',
      position: 'Lead Engineer',
    },
    {
      id: 'u-2',
      name: 'Siti Aminah',
      email: 'siti@example.com',
      department: 'Operations',
      position: 'Field Supervisor',
    },
    {
      id: 'u-3',
      name: 'Rian Pratama',
      email: 'rian@example.com',
      department: 'Field Operations',
      position: 'Technician',
    },
  ];

  const mockTeams = [
    {
      id: 'team-1',
      name: 'Alpha Response Team',
      description: 'Tim respon cepat perbaikan tower dan kabel',
      status: 'active',
      leader: { id: 'u-2', name: 'Siti Aminah' },
      members: [{ id: 'u-3', name: 'Rian Pratama' }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // RBAC v2: buttons are gated by the stored user's permissions
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'sa-1',
      role: 'superadmin',
      platform: 'web',
      permissions: ['teams.view', 'teams.create', 'teams.update', 'teams.delete'],
    }));
    vi.spyOn(apiService, 'getTeams').mockResolvedValue({ teams: mockTeams });
    vi.spyOn(apiService, 'getUsers').mockResolvedValue({ users: mockUsers });
    vi.spyOn(apiService, 'getUserAvatar').mockResolvedValue(null);
  });

  it('renders the team list and Add Team button', async () => {
    render(<TeamManagement />);

    expect(screen.getByRole('heading', { name: /Team Management/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Add Team/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });
  });

  it('opens Add Team modal with member search field and displays all available users', async () => {
    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Team/i }));

    expect(screen.getByRole('heading', { name: 'Add Team' })).toBeInTheDocument();
    const searchInput = screen.getByPlaceholderText(/Search members/i);
    expect(searchInput).toBeInTheDocument();

    const picker = document.querySelector('.available-users-container');
    expect(within(picker).getByText('Ahmad Dahlan')).toBeInTheDocument();
    expect(within(picker).getByText('Siti Aminah')).toBeInTheDocument();
    expect(within(picker).getByText('Rian Pratama')).toBeInTheDocument();
  });

  it('filters available members by name when typing in search input', async () => {
    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Team/i }));

    const searchInput = screen.getByPlaceholderText(/Search members/i);
    fireEvent.change(searchInput, { target: { value: 'siti' } });

    const picker = document.querySelector('.available-users-container');
    // Siti Aminah should be visible in picker
    expect(within(picker).getByText('Siti Aminah')).toBeInTheDocument();
    // Ahmad Dahlan and Rian Pratama should NOT be visible in picker
    expect(within(picker).queryByText('Ahmad Dahlan')).not.toBeInTheDocument();
    expect(within(picker).queryByText('Rian Pratama')).not.toBeInTheDocument();
  });

  it('filters available members by email', async () => {
    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Team/i }));

    const searchInput = screen.getByPlaceholderText(/Search members/i);
    fireEvent.change(searchInput, { target: { value: 'rian@example.com' } });

    const picker = document.querySelector('.available-users-container');
    expect(within(picker).getByText('Rian Pratama')).toBeInTheDocument();
    expect(within(picker).queryByText('Ahmad Dahlan')).not.toBeInTheDocument();
    expect(within(picker).queryByText('Siti Aminah')).not.toBeInTheDocument();
  });

  it('shows empty message when no members match search and allows clearing search', async () => {
    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Team/i }));

    const searchInput = screen.getByPlaceholderText(/Search members/i);
    fireEvent.change(searchInput, { target: { value: 'NonexistentPerson' } });

    const picker = document.querySelector('.available-users-container');
    expect(within(picker).getByText(/No members found matching "NonexistentPerson"/i)).toBeInTheDocument();

    // Click clear search button (✕)
    const clearBtn = document.querySelector('.clear-search-btn');
    fireEvent.click(clearBtn);

    expect(searchInput.value).toBe('');
    expect(within(picker).getByText('Ahmad Dahlan')).toBeInTheDocument();
    expect(within(picker).getByText('Siti Aminah')).toBeInTheDocument();
    expect(within(picker).getByText('Rian Pratama')).toBeInTheDocument();
  });

  it('clears search when clicking the clear icon button (✕)', async () => {
    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Team/i }));

    const searchInput = screen.getByPlaceholderText(/Search members/i);
    fireEvent.change(searchInput, { target: { value: 'ahmad' } });

    const picker = document.querySelector('.available-users-container');
    expect(within(picker).getByText('Ahmad Dahlan')).toBeInTheDocument();
    expect(within(picker).queryByText('Siti Aminah')).not.toBeInTheDocument();

    const clearIconBtn = document.querySelector('.clear-search-btn');
    fireEvent.click(clearIconBtn);

    expect(searchInput.value).toBe('');
    expect(within(picker).getByText('Siti Aminah')).toBeInTheDocument();
  });

  it('adds selected member to selected badges and updates leader options', async () => {
    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Team/i }));

    // Search and select Ahmad Dahlan by clicking the item
    const searchInput = screen.getByPlaceholderText(/Search members/i);
    fireEvent.change(searchInput, { target: { value: 'ahmad' } });

    const picker = document.querySelector('.available-users-container');
    const ahmadItem = within(picker).getByText('Ahmad Dahlan');
    fireEvent.click(ahmadItem);

    // Ahmad should now appear in selected badges with a remove button
    expect(screen.getByTitle('Remove Ahmad Dahlan')).toBeInTheDocument();
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();

    // Leader select should now include Ahmad Dahlan
    const leaderSelect = screen.getByLabelText(/Leader/i);
    expect(leaderSelect).toContainHTML('Ahmad Dahlan');

    // Removing Ahmad Dahlan returns him to available members
    fireEvent.click(screen.getByTitle('Remove Ahmad Dahlan'));
    expect(screen.queryByTitle('Remove Ahmad Dahlan')).not.toBeInTheDocument();
  });

  it('indicates already selected member when search matches an already chosen user', async () => {
    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Add Team/i }));

    const picker = document.querySelector('.available-users-container');
    // Select Ahmad Dahlan while unfiltered
    const ahmadItem = within(picker).getByText('Ahmad Dahlan');
    fireEvent.click(ahmadItem);

    expect(screen.getByTitle('Remove Ahmad Dahlan')).toBeInTheDocument();

    // Now search for "Ahmad"
    const searchInput = screen.getByPlaceholderText(/Search members/i);
    fireEvent.change(searchInput, { target: { value: 'Ahmad' } });

    // Should indicate Ahmad Dahlan is already selected
    expect(within(picker).getByText(/Ahmad Dahlan already selected/i)).toBeInTheDocument();
  });

  it('renders summary cards with Total, Active, and Inactive counts matching Taken style', async () => {
    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });

    const summaryCards = document.querySelector('.summary-cards');
    const totalCard = within(summaryCards).getByText('Total').closest('.summary-card');
    const activeCard = within(summaryCards).getByText('Active').closest('.summary-card');
    const inactiveCard = within(summaryCards).getByText('Inactive').closest('.summary-card');

    expect(totalCard).toBeInTheDocument();
    expect(activeCard).toBeInTheDocument();
    expect(inactiveCard).toBeInTheDocument();

    // Default Total card is active
    expect(totalCard).toHaveClass('active-summary');

    // Click Active card to filter
    fireEvent.click(activeCard);
    expect(activeCard).toHaveClass('active-summary');
    expect(totalCard).not.toHaveClass('active-summary');

    // Alpha Response Team (active) should still be displayed
    expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();

    // Click Inactive card
    fireEvent.click(inactiveCard);
    expect(inactiveCard).toHaveClass('active-summary');
    expect(screen.getByText('No teams found')).toBeInTheDocument();
  });

  it('renders leader and composition using assigned users style chips', async () => {
    const multiMemberTeam = [
      {
        id: 'team-multi',
        name: 'Bravo Network Team',
        description: 'Network maintenance',
        status: 'active',
        leader: { id: 'u-1', name: 'Ahmad Dahlan', email: 'ahmad@example.com' },
        members: [
          { id: 'u-1', name: 'Ahmad Dahlan', email: 'ahmad@example.com' },
          { id: 'u-2', name: 'Siti Aminah', email: 'siti@example.com' },
          { id: 'u-3', name: 'Rian Pratama', email: 'rian@example.com' },
          { id: 'u-4', name: 'Budi Santoso', email: 'budi@example.com' },
        ],
      },
      {
        id: 'team-empty',
        name: 'Empty Team',
        description: 'No leader or members',
        status: 'inactive',
        leader: null,
        members: [],
      },
    ];

    vi.spyOn(apiService, 'getTeams').mockResolvedValueOnce({ teams: multiMemberTeam });

    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Bravo Network Team')).toBeInTheDocument();
    });

    // Check leader badge style in table body
    const leaderCell = document.querySelector('td.tm-col-leader');
    const leaderBadge = leaderCell.querySelector('.tm-leader-badge');
    expect(leaderBadge).toBeInTheDocument();
    expect(within(leaderBadge).getByText('Ahmad Dahlan')).toBeInTheDocument();
    expect(within(leaderBadge).getByText('Leader')).toBeInTheDocument();

    // Check composition chips and overflow
    const compositionCell = document.querySelector('td.tm-col-composition');
    const memberChips = compositionCell.querySelectorAll('.team-badge');
    // Initially shows 2 members + overflow button
    expect(memberChips.length).toBe(2);

    const overflowBtn = compositionCell.querySelector('.team-overflow-chip');
    expect(overflowBtn).toBeInTheDocument();
    expect(overflowBtn).toHaveTextContent('+2 lainnya');

    // Click overflow to expand
    fireEvent.click(overflowBtn);
    const expandedChips = compositionCell.querySelectorAll('.team-badge');
    expect(expandedChips.length).toBe(4);

    const collapseBtn = compositionCell.querySelector('.team-collapse-chip');
    expect(collapseBtn).toBeInTheDocument();
    expect(collapseBtn).toHaveTextContent('Tutup');

    // Click to collapse
    fireEvent.click(collapseBtn);
    expect(compositionCell.querySelectorAll('.team-badge').length).toBe(2);
  });

  it('shows confirmation dialog when trying to add a user who already belongs to another team', async () => {
    render(<TeamManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Response Team')).toBeInTheDocument();
    });

    // Open Add Team modal
    fireEvent.click(screen.getByRole('button', { name: /\+ Add Team/i }));

    const picker = document.querySelector('.available-users-container');
    // Rian Pratama belongs to Alpha Response Team
    const rianItem = within(picker).getByText('Rian Pratama');
    const rianRow = rianItem.closest('.available-user-item');
    expect(within(rianRow).getByText(/Tim: Alpha Response Team/i)).toBeInTheDocument();

    // Click Rian Pratama to add
    fireEvent.click(rianItem);

    // Confirmation modal should appear
    expect(screen.getByText('Pindahkan Anggota Tim')).toBeInTheDocument();
    expect(
      screen.getByText(/Rian Pratama saat ini sudah terdaftar di tim "Alpha Response Team"\. Apakah Anda yakin ingin memindahkannya ke tim ini\?/i)
    ).toBeInTheDocument();

    // 1. Cancel moving
    const cancelBtn = screen.getByRole('button', { name: /Batal/i });
    fireEvent.click(cancelBtn);

    // Confirmation should close, and Rian Pratama should NOT be in selected members
    expect(screen.queryByText('Pindahkan Anggota Tim')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Remove Rian Pratama')).not.toBeInTheDocument();

    // 2. Click again and confirm moving
    fireEvent.click(rianItem);
    expect(screen.getByText('Pindahkan Anggota Tim')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Pindahkan/i });
    fireEvent.click(confirmBtn);

    // Now Rian Pratama should be added to selected members
    expect(screen.getByTitle('Remove Rian Pratama')).toBeInTheDocument();
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
  });
});
