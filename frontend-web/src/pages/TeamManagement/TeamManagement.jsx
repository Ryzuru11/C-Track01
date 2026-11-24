/**
 * Tujuan          : Halaman Team Management (admin/superadmin) — list, create, edit,
 *                  detail drawer (add/remove member), dan delete team.
 *                  Kolom Figma: #, TEAM NAME, STATUS, LEADER, COMPOSITION, ACTIONS.
 *                  WORKLOAD sengaja dihilangkan (tidak ada data backend).
 * Caller          : App.jsx (route /teams via ProtectedRoute permission TEAM_MANAGEMENT).
 * Dependensi      : services/api (getTeams, getTeam, createTeam, updateTeam, deleteTeam,
 *                  removeTeamMember, getUsers, getUserAvatar), utils/auth, components/ResponsiveTable.
 *                  utils/auth (getCurrentUser), components/ResponsiveTable.
 * Main Functions  : loadTeams, openAddModal, handleEdit, openDetail, handleSubmit,
 *                  handleDelete, addMembers, removeMember.
 * Side Effects    : GET/POST/PUT/DELETE /api/admin/teams*; avatar fetch via getUserAvatar.
 * Sinkronisasi    : lihat SYSTEM_MAP.md §6 (data model Team) & §5.1 (route map).
 * Catatan         : leaderId BUKAN anggota otomatis — leader tidak ditampilkan sebagai
 *                  removable member di detail drawer; diubah hanya lewat modal Edit.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  getTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  removeTeamMember,
  getUsers,
  getUserAvatar,
} from '../../services/api';
import ResponsiveTable from '../../components/ResponsiveTable/ResponsiveTable';
import Can from '../../components/Can';
import './TeamManagement.css';

const ITEMS_PER_PAGE = 6;
const MAX_VISIBLE_CHIPS = 4;

// Lazy avatar chip: hanya fetch getUserAvatar untuk chip yang ter-render (avatar cache di api.js).
function AvatarChip({ user, size = 20 }) {
  const [avatar, setAvatar] = useState(null);

  useEffect(() => {
    let isMounted = true;
    if (!user?.id) return;
    getUserAvatar(user.id)
      .then((data) => {
        if (isMounted) setAvatar(data);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const initials = (user?.name || '?')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);

  return (
    <div
      className="tm-avatar-chip taken-avatar-chip"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      title={user?.name || ''}
    >
      {avatar ? (
        <img src={avatar} alt={user?.name} />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

function getStatusBadgeClass(status) {
  const s = (status || 'active').toLowerCase();
  if (s === 'inactive') return 'status-badge status-inactive tm-status-badge tm-status-inactive';
  if (s === 'archived') return 'status-badge status-archived tm-status-badge tm-status-archived';
  return 'status-badge status-active tm-status-badge tm-status-active';
}

function getStatusLabel(status) {
  const s = (status || 'active').toLowerCase();
  if (s === 'inactive') return 'Inactive';
  if (s === 'archived') return 'Archived';
  return 'Active';
}

function TeamManagement() {
  const hasInitiatedLoad = useRef(false);
  const [teams, setTeams] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState({ show: false, message: '', type: '' });
  const [confirmModal, setConfirmModal] = useState({
    show: false,
    title: '',
    message: '',
    onConfirm: null,
    type: 'delete',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
  });
  const [expandedMembers, setExpandedMembers] = useState({});

  const toggleExpandMembers = (teamId) => {
    setExpandedMembers((prev) => ({
      ...prev,
      [teamId]: !prev[teamId],
    }));
  };

  // Counts for summary cards matching Taken page
  const teamCounts = {
    total: teams.length,
    active: teams.filter((t) => (t.status || 'active').toLowerCase() === 'active').length,
    inactive: teams.filter((t) => (t.status || '').toLowerCase() === 'inactive').length,
  };

  const handleStatusFilterClick = (status) => {
    setFilters((prev) => ({
      ...prev,
      status: prev.status === status ? '' : status,
    }));
    setCurrentPage(0);
  };

  // Add / Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentTeamId, setCurrentTeamId] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'active',
    leaderId: '',
    memberIds: [],
  });

  // Detail drawer
  const [showDrawer, setShowDrawer] = useState(false);
  const [detailTeam, setDetailTeam] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [filters, setFilters] = useState({ search: '', status: '' });
  const [currentPage, setCurrentPage] = useState(0);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: '' }), 3000);
  };

  const showConfirmModal = (title, message, onConfirm, options = {}) => {
    setConfirmModal({
      show: true,
      title,
      message,
      onConfirm,
      type: options.type || 'delete',
      confirmText: options.confirmText || 'Confirm',
      cancelText: options.cancelText || 'Cancel',
    });
  };

  const handleConfirm = () => {
    if (confirmModal.onConfirm) confirmModal.onConfirm();
    setConfirmModal({
      show: false,
      title: '',
      message: '',
      onConfirm: null,
      type: 'delete',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
    });
  };

  const handleCancelConfirm = () => {
    setConfirmModal({
      show: false,
      title: '',
      message: '',
      onConfirm: null,
      type: 'delete',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
    });
  };

  // Find which team a user currently belongs to (from user.team, user.teamId, or scanning teams)
  const getUserCurrentTeam = (user) => {
    if (!user) return null;
    if (user.team && user.team.id) {
      return user.team;
    }
    if (user.teamId) {
      const teamById = teams.find((t) => t.id === user.teamId);
      if (teamById) return { id: teamById.id, name: teamById.name };
    }
    const foundTeam = teams.find((t) => {
      const isMember = (t.members || []).some((m) => m.id === user.id);
      const isLeader = t.leader?.id === user.id;
      return isMember || isLeader;
    });
    if (foundTeam) {
      return { id: foundTeam.id, name: foundTeam.name };
    }
    return null;
  };

  // Load teams + users for pickers
  useEffect(() => {
    if (hasInitiatedLoad.current) return;
    hasInitiatedLoad.current = true;
    loadTeams();
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      const response = await getUsers();
      setAllUsers(response.users || []);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  }

  async function loadTeams() {
    try {
      setLoading(true);
      setError('');
      const response = await getTeams();
      setTeams(response.teams || []);
      setCurrentPage(0);
    } catch (err) {
      console.error('Error loading teams:', err);
      setError('Failed to load teams. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // Client-side filtering
  const filteredTeams = teams.filter((team) => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!team.name.toLowerCase().includes(q)) return false;
    }
    if (filters.status && (team.status || 'active').toLowerCase() !== filters.status) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredTeams.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages - 1);
  const startIdx = safePage * ITEMS_PER_PAGE;
  const pageTeams = filteredTeams.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
    setCurrentPage(0);
  };

  const handleClearFilters = () => {
    setFilters({ search: '', status: '' });
    setCurrentPage(0);
  };

  // ── Add / Edit modal ──────────────────────────────────────────
  const resetForm = () => {
    setFormData({ name: '', description: '', status: 'active', leaderId: '', memberIds: [] });
    setCurrentTeamId(null);
    setEditMode(false);
    setMemberSearch('');
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    resetForm();
    setError('');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddMember = (userId) => {
    const targetUser = allUsers.find((u) => u.id === userId);
    const userCurrentTeam = getUserCurrentTeam(targetUser);

    // If user is already registered in another team, show confirmation modal
    if (userCurrentTeam && userCurrentTeam.id !== currentTeamId) {
      showConfirmModal(
        'Pindahkan Anggota Tim',
        `${targetUser?.name || 'Pengguna ini'} saat ini sudah terdaftar di tim "${userCurrentTeam.name}". Apakah Anda yakin ingin memindahkannya ke tim ini?`,
        () => {
          setFormData((prev) => ({
            ...prev,
            memberIds: [...prev.memberIds, userId],
          }));
        },
        {
          type: 'warning',
          confirmText: 'Pindahkan',
          cancelText: 'Batal',
        }
      );
      return;
    }

    setFormData((prev) => ({
      ...prev,
      memberIds: [...prev.memberIds, userId],
    }));
  };

  const handleRemoveMemberFromForm = (userId) => {
    setFormData((prev) => {
      const memberIds = prev.memberIds.filter((id) => id !== userId);
      // Clear leader if the removed member was the leader
      const leaderId = prev.leaderId === userId ? '' : prev.leaderId;
      return { ...prev, memberIds, leaderId };
    });
  };

  const toggleMember = (userId) => {
    if (formData.memberIds.includes(userId)) {
      handleRemoveMemberFromForm(userId);
    } else {
      handleAddMember(userId);
    }
  };

  const handleEdit = async (teamId) => {
    try {
      setLoading(true);
      const response = await getTeam(teamId);
      const team = response.team;
      setFormData({
        name: team.name || '',
        description: team.description || '',
        status: (team.status || 'active').toLowerCase(),
        leaderId: team.leader?.id || '',
        memberIds: (team.members || []).map((m) => m.id),
      });
      setCurrentTeamId(teamId);
      setEditMode(true);
      setMemberSearch('');
      setShowModal(true);
    } catch (err) {
      console.error('Error loading team details:', err);
      showToast('Failed to load team details', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!formData.name || !formData.name.trim()) {
      showToast('Team name is required', 'error');
      return;
    }
    const payload = {
      name: formData.name.trim(),
      description: formData.description || null,
      status: formData.status || 'active',
      leaderId: formData.leaderId || null,
      memberIds: formData.memberIds,
    };
    try {
      if (editMode && currentTeamId) {
        await updateTeam(currentTeamId, payload);
        showToast('Team updated successfully!', 'success');
      } else {
        await createTeam(payload);
        showToast('Team created successfully!', 'success');
      }
      setShowModal(false);
      resetForm();
      loadTeams();
    } catch (err) {
      console.error('Error saving team:', err);
      const msg =
        err.response?.data?.message || err.response?.data?.error || 'Failed to save team. Please try again.';
      showToast(msg, 'error');
    }
  };

  // ── Detail drawer ─────────────────────────────────────────────
  const openDetail = async (teamId) => {
    try {
      setDetailLoading(true);
      setShowDrawer(true);
      const response = await getTeam(teamId);
      setDetailTeam(response.team);
    } catch (err) {
      console.error('Error loading team detail:', err);
      showToast('Failed to load team detail', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setShowDrawer(false);
    setDetailTeam(null);
  };

  const handleRemoveMember = async (userId, userName) => {
    if (!detailTeam) return;
    showConfirmModal(
      'Remove Member',
      `Are you sure you want to remove ${userName || 'this member'} from the team?`,
      async () => {
        try {
          setDetailLoading(true);
          await removeTeamMember(detailTeam.id, userId);
          showToast('Member removed successfully!', 'success');
          const response = await getTeam(detailTeam.id);
          setDetailTeam(response.team);
          loadTeams();
        } catch (err) {
          console.error('Error removing member:', err);
          showToast(err.response?.data?.message || 'Failed to remove member', 'error');
        } finally {
          setDetailLoading(false);
        }
      },
      { type: 'delete', confirmText: 'Remove', cancelText: 'Cancel' }
    );
  };

  // ── Delete ────────────────────────────────────────────────────
  const handleDelete = (team) => {
    showConfirmModal(
      'Delete Team',
      `Are you sure you want to delete "${team.name}"? Members will be unassigned (not deleted). This action cannot be undone.`,
      async () => {
        try {
          await deleteTeam(team.id);
          showToast('Team deleted successfully!', 'success');
          loadTeams();
        } catch (err) {
          console.error('Error deleting team:', err);
          showToast(err.response?.data?.message || 'Failed to delete team', 'error');
        }
      },
      { type: 'delete', confirmText: 'Delete', cancelText: 'Cancel' }
    );
  };

  const goToPage = (page) => {
    setCurrentPage(Math.max(0, Math.min(page, totalPages - 1)));
  };

  const hasActiveFilters = filters.search !== '' || filters.status !== '';

  // Users available for the edit modal's member multi-select (exclude current members)
  const editAvailableMembers = allUsers.filter((u) => !formData.memberIds.includes(u.id));
  // Selected members (leader must be chosen from these)
  const selectedMembers = allUsers.filter((u) => formData.memberIds.includes(u.id));

  // Filter available members by search query (name, email, department, position)
  const searchedAvailableMembers = editAvailableMembers.filter((u) => {
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase().trim();
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.department && u.department.toLowerCase().includes(q)) ||
      (u.position && u.position.toLowerCase().includes(q))
    );
  });

  // Selected members matching the search query (to provide hint if user is already selected)
  const searchedSelectedMembers = selectedMembers.filter((u) => {
    if (!memberSearch.trim()) return false;
    const q = memberSearch.toLowerCase().trim();
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.department && u.department.toLowerCase().includes(q)) ||
      (u.position && u.position.toLowerCase().includes(q))
    );
  });

  return (
    <div className="team-management-page">
      {toast.show && (
        <div className={`toast-notification ${toast.type}`}>
          <div className="toast-icon">
            {toast.type === 'success' && '✓'}
            {toast.type === 'error' && '✕'}
            {toast.type === 'warning' && '⚠'}
            {toast.type === 'info' && 'ℹ'}
          </div>
          <div className="toast-message">{toast.message}</div>
          <button className="toast-close" onClick={() => setToast({ show: false, message: '', type: '' })}>
            ✕
          </button>
        </div>
      )}

      {confirmModal.show && (
        <div className="confirm-overlay" onClick={handleCancelConfirm}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">
              {confirmModal.type === 'warning' ? (
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="24" fill="#FEF3C7" />
                  <path
                    d="M24 16V26M24 32H24.02"
                    stroke="#D97706"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="24" fill="#FEE2E2" />
                  <path
                    d="M16 18H18H32M30 18V32C30 32.5304 29.7893 33.0391 29.4142 33.4142C29.0391 33.7893 28.5304 34 28 34H20C19.4696 34 18.9609 33.7893 18.5858 33.4142C18.2107 33.0391 18 32.5304 18 32V18M21 18V16C21 15.4696 21.2107 14.9609 21.5858 14.5858C21.9609 14.2107 22.4696 14 23 14H25C25.5304 14 26.0391 14.2107 26.4142 14.5858C26.7893 14.9609 27 15.4696 27 16V18"
                    stroke="#EF4444"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <h3 className="confirm-title">{confirmModal.title}</h3>
            <p className="confirm-message">{confirmModal.message}</p>
            <div className="confirm-actions">
              <button className="btn-confirm-cancel" onClick={handleCancelConfirm}>
                {confirmModal.cancelText || 'Cancel'}
              </button>
              <button className={`btn-confirm-ok ${confirmModal.type || 'delete'}`} onClick={handleConfirm}>
                {confirmModal.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="taken-header tm-header">
        <div>
          <h1>Team Management</h1>
          <p className="taken-subtitle tm-subtitle">Manage teams, leaders, and member composition</p>
        </div>
        <Can perm="teams.create">
          <button className="btn-tambah tm-add-btn" onClick={handleOpenAddModal}>
            <span className="btn-icon tm-btn-icon">+</span>
            Add Team
          </button>
        </Can>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div
          className={`summary-card clickable-summary ${filters.status === '' ? 'active-summary' : ''}`}
          onClick={() => handleStatusFilterClick('')}
        >
          <div className="card-left">
            <span className={`dot ${filters.status === '' ? 'dot-white' : 'dot-black'}`}></span>
            <span className="label">Total</span>
          </div>
          <span className={`badge ${filters.status === '' ? 'badge-white' : 'badge-grey'}`}>{teamCounts.total}</span>
        </div>
        <div
          className={`summary-card clickable-summary ${filters.status === 'active' ? 'active-summary' : ''}`}
          onClick={() => handleStatusFilterClick('active')}
        >
          <div className="card-left">
            <span className={`dot ${filters.status === 'active' ? 'dot-white' : 'dot-green'}`}></span>
            <span className="label">Active</span>
          </div>
          <span className={`badge ${filters.status === 'active' ? 'badge-white' : 'badge-green'}`}>{teamCounts.active}</span>
        </div>
        <div
          className={`summary-card clickable-summary ${filters.status === 'inactive' ? 'active-summary' : ''}`}
          onClick={() => handleStatusFilterClick('inactive')}
        >
          <div className="card-left">
            <span className={`dot ${filters.status === 'inactive' ? 'dot-white' : 'dot-orange'}`}></span>
            <span className="label">Inactive</span>
          </div>
          <span className={`badge ${filters.status === 'inactive' ? 'badge-white' : 'badge-orange'}`}>{teamCounts.inactive}</span>
        </div>
      </div>

      <div className="filters-section tm-filters">
        <div className="filters-row tm-filters-row">
          <div className="input-with-icon flex-grow">
            <svg className="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21.0004 21.0004L16.6504 16.6504" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              type="text"
              name="search"
              placeholder="Search by team name..."
              value={filters.search}
              onChange={handleFilterChange}
              className="filter-input-icon tm-filter-input"
            />
          </div>
          <div className="input-with-icon select-wrapper tm-select-wrapper">
            <select name="status" value={filters.status} onChange={handleFilterChange} className="filter-select-icon tm-filter-select">
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <button onClick={handleClearFilters} className={`btn-clear tm-clear-btn ${hasActiveFilters ? 'active' : ''}`}>
            Clear Filters
          </button>
        </div>
      </div>

      {error && <div className="error-alert tm-error-alert">{error}</div>}

      <div className="taken-content tm-content">
        <ResponsiveTable className="rt-responsive tm-responsive" tableClassName="tm-table" loading={loading} minWidth="100%" maxHeight="100%">
          <thead className="dark-header tm-dark-header">
            <tr>
              <th className="tm-col-index">#</th>
              <th className="tm-col-name">TEAM NAME</th>
              <th className="tm-col-status">STATUS</th>
              <th className="tm-col-leader">LEADER</th>
              <th className="tm-col-composition">COMPOSITION</th>
              <th className="tm-col-actions">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {pageTeams.length === 0 ? (
              <tr>
                <td colSpan="6" className="empty-state tm-empty-state">
                  <div className="empty-content tm-empty-content">
                    <span className="empty-icon tm-empty-icon">👥</span>
                    <p>No teams found</p>
                    <span>{hasActiveFilters ? 'Try adjusting your filters' : 'Create a new team to get started'}</span>
                  </div>
                </td>
              </tr>
            ) : (
              pageTeams.map((team, index) => {
                const members = team.members || [];
                return (
                  <tr key={team.id}>
                    <td className="row-number tm-col-index">{startIdx + index + 1}</td>
                    <td className="tm-col-name">
                      <button className="tm-team-name-btn" onClick={() => openDetail(team.id)} title="View team details">
                        {team.name}
                      </button>
                      {team.description && <div className="tm-team-desc">{team.description}</div>}
                    </td>
                    <td className="tm-col-status">
                      <span className={getStatusBadgeClass(team.status)}>
                        {getStatusLabel(team.status)}
                      </span>
                    </td>
                    <td className="tm-col-leader">
                      {team.leader ? (
                        <div className="user-badges">
                          <span
                            className="team-badge tm-leader-badge"
                            title={`${team.leader.name} (${team.leader.email || ''}) • Leader`}
                          >
                            <AvatarChip user={team.leader} size={20} />
                            <span className="user-name-text tm-leader-name">{team.leader.name}</span>
                            <span className="tm-leader-tag" title="Leader">Leader</span>
                          </span>
                        </div>
                      ) : (
                        <span className="assignment-badge unassigned-badge" title="Belum ada leader">
                          <span className="unassigned-dot" /> Belum Ditugaskan
                        </span>
                      )}
                    </td>
                    <td className="tm-col-composition">
                      {members && members.length > 0 ? (
                        <div className="user-badges tm-composition">
                          {(() => {
                            const isExpanded = !!expandedMembers[team.id];
                            const MAX_VISIBLE = 2;
                            const visibleMembers = (members.length <= 3 || isExpanded) ? members : members.slice(0, MAX_VISIBLE);
                            const remainingCount = members.length - visibleMembers.length;
                            const remainingNames = members.slice(MAX_VISIBLE).map((m) => m.name).join(', ');

                            return (
                              <>
                                {visibleMembers.map((m) => (
                                  <span
                                    key={m.id}
                                    className="team-badge"
                                    title={`${m.name} (${m.email || 'No email'})`}
                                  >
                                    <AvatarChip user={m} size={20} />
                                    <span className="user-name-text">{m.name}</span>
                                  </span>
                                ))}
                                {remainingCount > 0 && (
                                  <button
                                    type="button"
                                    className="team-overflow-chip"
                                    onClick={() => toggleExpandMembers(team.id)}
                                    title={`Klik untuk melihat: ${remainingNames}`}
                                  >
                                    +{remainingCount} lainnya
                                  </button>
                                )}
                                {isExpanded && members.length > 3 && (
                                  <button
                                    type="button"
                                    className="team-collapse-chip"
                                    onClick={() => toggleExpandMembers(team.id)}
                                    title="Ciutkan daftar"
                                  >
                                    Tutup
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <span className="assignment-badge unassigned-badge" title="Belum ada anggota">
                          <span className="unassigned-dot" /> Belum Ada Anggota
                        </span>
                      )}
                    </td>
                    <td className="tm-col-actions">
                      <div className="tm-actions-cell">
                        <button className="action-btn view-btn" onClick={() => openDetail(team.id)} title="View details">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <Can perm="teams.update">
                        <button className="action-btn edit-btn" onClick={() => handleEdit(team.id)} title="Edit">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M11.333 2.00004C11.5081 1.82494 11.716 1.68605 11.9447 1.59129C12.1735 1.49653 12.4187 1.44775 12.6663 1.44775C12.914 1.44775 13.1592 1.49653 13.3879 1.59129C13.6167 1.68605 13.8246 1.82494 13.9997 2.00004C14.1748 2.17513 14.3137 2.383 14.4084 2.61178C14.5032 2.84055 14.552 3.08575 14.552 3.33337C14.552 3.58099 14.5032 3.82619 14.4084 4.05497C14.3137 4.28374 14.1748 4.49161 13.9997 4.66671L5.33301 13.3334L1.99967 14.3334L2.99967 11L11.333 2.00004Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        </Can>
                        <Can perm="teams.delete">
                        <button className="action-btn delete-btn" onClick={() => handleDelete(team)} title="Delete">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2 4H3.33333H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M5.33301 4.00004V2.66671C5.33301 2.31309 5.47348 1.97395 5.72353 1.7239C5.97358 1.47385 6.31272 1.33337 6.66634 1.33337H9.33301C9.68663 1.33337 10.0258 1.47385 10.2758 1.7239C10.5259 1.97395 10.6663 2.31309 10.6663 2.66671V4.00004M12.6663 4.00004V13.3334C12.6663 13.687 12.5259 14.0261 12.2758 14.2762C12.0258 14.5262 11.6866 14.6667 11.333 14.6667H4.66634C4.31272 14.6667 3.97358 14.5262 3.72353 14.2762C3.47348 14.0261 3.33301 13.687 3.33301 13.3334V4.00004H12.6663Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        </Can>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </ResponsiveTable>

        <div className="table-footer tm-table-footer">
          <div className="showing-text tm-showing-text">
            Showing <strong>{filteredTeams.length === 0 ? 0 : startIdx + 1}</strong> to{' '}
            <strong>{Math.min(startIdx + ITEMS_PER_PAGE, filteredTeams.length)}</strong> of{' '}
            <strong>{filteredTeams.length}</strong> teams
          </div>
          <div className="legend tm-legend">
            <span className="dot dot-green"></span> {teamCounts.active} Active
            <span className="dot dot-orange"></span> {teamCounts.inactive} Inactive
          </div>
          <div className="pagination tm-pagination">
            <button
              className="page-btn tm-page-btn"
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage === 0}
            >
              Prev
            </button>
            <span className="page-info tm-page-info">
              Page {safePage + 1} of {totalPages}
            </span>
            <button
              className="page-btn tm-page-btn"
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage >= totalPages - 1}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="modal-overlay tm-modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content tm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header tm-modal-header">
              <h2>{editMode ? 'Edit Team' : 'Add Team'}</h2>
              <button className="modal-close tm-modal-close" onClick={handleCloseModal}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {error && <div className="error-alert tm-modal-error">{error}</div>}

            <form onSubmit={handleSubmit} className="modal-form tm-modal-form">
              <div className="form-group tm-form-group">
                <label htmlFor="tm-name">
                  Team Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  id="tm-name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  placeholder="Enter team name"
                />
              </div>

              <div className="form-group tm-form-group">
                <label htmlFor="tm-description">Description</label>
                <textarea
                  id="tm-description"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  rows="3"
                  placeholder="Enter team description"
                ></textarea>
              </div>

              <div className="form-row tm-form-row">
                <div className="form-group tm-form-group">
                  <label htmlFor="tm-status">Status</label>
                  <select id="tm-status" name="status" value={formData.status} onChange={handleInputChange}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="form-group tm-form-group">
                  <label htmlFor="tm-leader">Leader</label>
                  <select id="tm-leader" name="leaderId" value={formData.leaderId} onChange={handleInputChange}>
                    <option value="">No Leader</option>
                    {selectedMembers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group tm-form-group">
                <label htmlFor="memberIds">Members <span className="required">*</span></label>

                {/* Selected Members - Always shown, looks like input field */}
                <div className="selected-users-container">
                  {selectedMembers.length === 0 ? (
                    <span className="selected-users-placeholder">No members selected - search below to add</span>
                  ) : (
                    selectedMembers.map((u) => (
                      <div key={u.id} className="selected-user-badge">
                        <AvatarChip user={u} size={18} />
                        <span className="user-name">{u.name}</span>
                        <button
                          type="button"
                          className="remove-user-btn"
                          onClick={() => toggleMember(u.id)}
                          title={`Remove ${u.name}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Member Search Bar */}
                <div className="user-search-container">
                  <input
                    type="text"
                    placeholder="Search members..."
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.preventDefault();
                    }}
                    className="user-search-input"
                  />
                  {memberSearch && (
                    <button
                      type="button"
                      className="clear-search-btn"
                      onClick={() => setMemberSearch('')}
                      title="Clear search"
                      aria-label="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Available Members */}
                <div className="available-users-container tm-member-picker">
                  {allUsers.length === 0 ? (
                    <div className="no-users-message">No users available</div>
                  ) : editAvailableMembers.length === 0 ? (
                    <div className="no-users-message">All users have been added to this team</div>
                  ) : searchedAvailableMembers.length === 0 ? (
                    <div className="no-users-message">
                      <div>No members found matching "{memberSearch}"</div>
                      {searchedSelectedMembers.length > 0 && (
                        <div className="user-dept" style={{ marginTop: '4px' }}>
                          ({searchedSelectedMembers.map((m) => m.name).join(', ')} already selected)
                        </div>
                      )}
                    </div>
                  ) : (
                    searchedAvailableMembers.map((u) => {
                      const userTeam = getUserCurrentTeam(u);
                      const isInOtherTeam = userTeam && userTeam.id !== currentTeamId;
                      return (
                        <div
                          key={u.id}
                          className="available-user-item tm-member-option"
                          onClick={() => toggleMember(u.id)}
                        >
                          <AvatarChip user={u} size={20} />
                          <span className="user-name">{u.name}</span>
                          {u.department ? (
                            <span className="user-dept"> • {u.department}</span>
                          ) : u.email ? (
                            <span className="user-dept"> • {u.email}</span>
                          ) : null}
                          {isInOtherTeam && (
                            <span className="tm-member-team-badge" title={`Saat ini terdaftar di tim: ${userTeam.name}`}>
                              Tim: {userTeam.name}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <small className="form-hint">
                  Search and click to add • {formData.memberIds.length} selected
                </small>
              </div>

              <div className="modal-actions tm-modal-actions">
                <button type="button" className="btn-cancel tm-btn-cancel" onClick={handleCloseModal}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit tm-btn-submit">
                  {editMode ? 'Update Team' : 'Add Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {showDrawer && (
        <div className="tm-drawer-overlay" onClick={closeDetail}>
          <div className="tm-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="tm-drawer-header">
              <div>
                <h2>{detailTeam?.name}</h2>
                <span className={getStatusBadgeClass(detailTeam?.status)}>
                  <span className="tm-badge-dot" />
                  {getStatusLabel(detailTeam?.status)}
                </span>
              </div>
              <button className="tm-modal-close" onClick={closeDetail}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {detailLoading && <div className="tm-drawer-loading">Loading...</div>}

            {detailTeam && (
              <div className="tm-drawer-body">
                {detailTeam.description && <p className="tm-drawer-desc">{detailTeam.description}</p>}

                <div className="tm-drawer-meta">
                  <span className="tm-meta-label">Leader</span>
                  {detailTeam.leader ? (
                    <div className="user-badges">
                      <span className="team-badge tm-leader-badge" title={`${detailTeam.leader.name} (${detailTeam.leader.email || ''}) • Leader`}>
                        <AvatarChip user={detailTeam.leader} size={20} />
                        <span className="user-name-text tm-leader-name">{detailTeam.leader.name}</span>
                        <span className="tm-leader-tag">Leader</span>
                      </span>
                    </div>
                  ) : (
                    <span className="assignment-badge unassigned-badge">
                      <span className="unassigned-dot" /> Belum Ditugaskan
                    </span>
                  )}
                </div>

                <div className="tm-drawer-section-title">
                  Members ({(detailTeam.members || []).length})
                </div>
                <div className="tm-member-list">
                  {(detailTeam.members || []).length === 0 ? (
                    <span className="tm-muted">No members in this team</span>
                  ) : (
                    (detailTeam.members || []).map((m) => (
                      <div key={m.id} className="tm-member-row">
                        <div className="tm-member-info">
                          <AvatarChip user={m} size={30} />
                          <div className="tm-member-text">
                            <span className="tm-member-name">{m.name}</span>
                            <span className="tm-member-email">{m.email}</span>
                          </div>
                        </div>
                        <Can perm="teams.update">
                        <button
                          className="tm-remove-member-btn"
                          onClick={() => handleRemoveMember(m.id, m.name)}
                          title="Remove member"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2 4H3.33333H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M5.33301 4.00004V2.66671C5.33301 2.31309 5.47348 1.97395 5.72353 1.7239C5.97358 1.47385 6.31272 1.33337 6.66634 1.33337H9.33301C9.68663 1.33337 10.0258 1.47385 10.2758 1.7239C10.5259 1.97395 10.6663 2.31309 10.6663 2.66671V4.00004M12.6663 4.00004V13.3334C12.6663 13.687 12.5259 14.0261 12.2758 14.2762C12.0258 14.5262 11.6866 14.6667 11.333 14.6667H4.66634C4.31272 14.6667 3.97358 14.5262 3.72353 14.2762C3.47348 14.0261 3.33301 13.687 3.33301 13.3334V4.00004H12.6663Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        </Can>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TeamManagement;
