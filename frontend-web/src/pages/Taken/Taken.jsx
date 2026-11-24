import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAssignments, createAssignment, updateAssignment, deleteAssignment, getTasks, getUsers, getTeams, getUserAvatar } from '../../services/api';
import './Taken.css';
import ResponsiveTable from '../../components/ResponsiveTable/ResponsiveTable';
import Can from '../../components/Can';
import TaskCreatorBadge from '../../components/TaskCreatorBadge';
import useAccess from '../../hooks/useAccess';

// ISO date-time → value for <input type="datetime-local"> (local time)
const toDateTimeLocal = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ISO date → value for <input type="date"> (local date)
const toDateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Lazy avatar chip for user badge
function TakenAvatarChip({ user, size = 20 }) {
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
      className="taken-avatar-chip"
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

// Load initial state from localStorage
const getStoredUnread = () => {
  try {
    const val = localStorage.getItem('ctrack:unread_store');
    return val ? JSON.parse(val) : {};
  } catch (e) {
    return {};
  }
};

// ── Module-level unread store: always active, survives component unmount ──────
window.__ctrackUnreadStore = window.__ctrackUnreadStore || getStoredUnread();

const _broadcastUnreadUpdate = () => {
  window.dispatchEvent(new CustomEvent('ctrack:unread_total_updated', {
    detail: { counts: { ...window.__ctrackUnreadStore } }
  }));
};

// Global clear function so it can be called from Monitoring page or other pages
window.__ctrackClearUnread = (takenTaskId) => {
  const next = { ...window.__ctrackUnreadStore };
  delete next[takenTaskId];
  window.__ctrackUnreadStore = next;
  try {
    localStorage.setItem('ctrack:unread_store', JSON.stringify(next));
  } catch (e) { }
  _broadcastUnreadUpdate();
};

// Guard so listeners are only registered once (safe across HMR)
if (!window.__ctrackUnreadListenersAdded) {
  window.__ctrackUnreadListenersAdded = true;
  window.addEventListener('ctrack:new_message', (e) => {
    const id = e.detail?.takenTaskId;
    const reportId = e.detail?.reportId;
    if (!id || !reportId) return;

    // Ignore message if the user is currently viewing the forum for this report
    if (window.__ctrackActiveReportForumId === reportId) return;

    let currentMap = window.__ctrackUnreadStore[id];
    if (typeof currentMap !== 'object' || Array.isArray(currentMap) || currentMap === null) {
      currentMap = {};
    }

    const next = {
      ...window.__ctrackUnreadStore,
      [id]: { ...currentMap, [reportId]: (currentMap[reportId] || 0) + 1 }
    };
    window.__ctrackUnreadStore = next;
    try {
      localStorage.setItem('ctrack:unread_store', JSON.stringify(next));
    } catch (e) { }
    _broadcastUnreadUpdate();
  });
  window.addEventListener('ctrack:new_report', (e) => {
    const id = e.detail?.takenTaskId;
    const reportId = e.detail?.reportId;
    if (!id || !reportId) return;

    // Ignore report if the user is currently viewing the forum for this report
    if (window.__ctrackActiveReportForumId === reportId) return;

    let currentMap = window.__ctrackUnreadStore[id];
    if (typeof currentMap !== 'object' || Array.isArray(currentMap) || currentMap === null) {
      currentMap = {};
    }

    const next = {
      ...window.__ctrackUnreadStore,
      [id]: { ...currentMap, [reportId]: (currentMap[reportId] || 0) + 1 }
    };
    window.__ctrackUnreadStore = next;
    try {
      localStorage.setItem('ctrack:unread_store', JSON.stringify(next));
    } catch (e) { }
    _broadcastUnreadUpdate();
  });
}

function Taken() {
  const navigate = useNavigate();
  const { can, canAny } = useAccess();
  // The assign/edit form needs the task, employee and team pickers
  const canEditAssignments = canAny(['assignments.create', 'assignments.update']);
  const canPickTeams = canEditAssignments && can('teams.view');
  const isInitialMount = useRef(true);
  const hasInitiatedLoad = useRef(false); // Prevent double loading in StrictMode
  const [showModal, setShowModal] = useState(false);
  const [editingTakenId, setEditingTakenId] = useState(null); // null = create mode
  const [takens, setTakens] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [taskCounts, setTaskCounts] = useState({ total: 0, pending: 0, inProgress: 0, completed: 0 });
  const [toast, setToast] = useState({ show: false, message: '', type: '' });
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null, type: 'delete' });
  const [expandedUsers, setExpandedUsers] = useState({});

  const toggleExpandUsers = (takenTaskId) => {
    setExpandedUsers((prev) => ({
      ...prev,
      [takenTaskId]: !prev[takenTaskId],
    }));
  };

  // ── Unread badges per takenTaskId ────────────────────────────────────────────
  // Initialised from the module-level store so state survives navigate away/back
  const [unreadCounts, setUnreadCounts] = useState(() => ({ ...window.__ctrackUnreadStore }));

  const getUnreadCount = (taskId) => {
    const val = unreadCounts[taskId];
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (Array.isArray(val)) return val.length;
    // Format baru: Object map { reportId: count }
    return Object.values(val).reduce((sum, count) => sum + count, 0);
  };

  const clearUnread = (takenTaskId) => {
    if (typeof window.__ctrackClearUnread === 'function') {
      window.__ctrackClearUnread(takenTaskId);
    }
  };

  // Keep React state in sync when module-level store broadcasts updates
  useEffect(() => {
    const onUpdate = (e) => setUnreadCounts({ ...e.detail.counts });
    window.addEventListener('ctrack:unread_total_updated', onUpdate);
    return () => window.removeEventListener('ctrack:unread_total_updated', onUpdate);
  }, []);

  const [formData, setFormData] = useState({
    taskId: '',
    userIds: [],
    teamId: '',
    date: '',
    startTime: ''
  });

  const [filters, setFilters] = useState({
    search: '',
    taskId: '',
    userId: '',
    status: '',
    date: ''
  });

  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 6;

  const [userSearch, setUserSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [assignType, setAssignType] = useState('user'); // 'user' | 'team'

  // Toast notification function
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: '' });
    }, 3000);
  };

  // Show confirmation modal
  const showConfirmModal = (title, message, onConfirm, type = 'delete') => {
    setConfirmModal({ show: true, title, message, onConfirm, type });
  };

  // Handle confirm action
  const handleConfirm = () => {
    if (confirmModal.onConfirm) {
      confirmModal.onConfirm();
    }
    setConfirmModal({ show: false, title: '', message: '', onConfirm: null, type: 'delete' });
  };

  // Handle cancel confirmation
  const handleCancelConfirm = () => {
    setConfirmModal({ show: false, title: '', message: '', onConfirm: null, type: 'delete' });
  };

  // Load data on component mount
  useEffect(() => {
    if (hasInitiatedLoad.current) return;
    hasInitiatedLoad.current = true;
    loadAssignments();
    // Pickers are only needed by roles that can create or edit assignments
    if (canEditAssignments) {
      loadTasks();
      loadUsers();
    }
    if (canPickTeams) {
      loadTeams();
    }
    // Mount-only load (permissions are re-checked on the next visit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-filter when filters change (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const delayDebounce = setTimeout(() => {
      setCurrentPage(0); // Reset to first page when filters change
      loadAssignments(filters);
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [filters]);

  // Load assignments from API
  const loadAssignments = async (filterParams = {}) => {
    try {
      setLoading(true);
      setError('');
      // Don't send client-side text/status filters to API
      const { search, userId, date, status, ...apiParams } = filterParams;
      const response = await getAssignments(apiParams);
      let takensData = response.takenTasks || [];

      // Sync unread store: remove any keys that do not exist in the fetched takensData
      if (!filterParams || Object.keys(filterParams).length === 0) {
        const activeIds = new Set(takensData.map(t => String(t.takenTaskId)));
        const currentStore = { ...window.__ctrackUnreadStore };
        let changed = false;
        Object.keys(currentStore).forEach(key => {
          if (!activeIds.has(String(key))) {
            delete currentStore[key];
            changed = true;
          }
        });
        if (changed) {
          window.__ctrackUnreadStore = currentStore;
          try {
            localStorage.setItem('ctrack:unread_store', JSON.stringify(currentStore));
          } catch (e) { }
          _broadcastUnreadUpdate();
        }
      }

      const counts = { total: takensData.length, pending: 0, inProgress: 0, completed: 0 };
      takensData.forEach(t => {
        if (t.status === 'in_progress') counts.inProgress++;
        else if (t.status === 'pending') counts.pending++;
        else if (t.status === 'completed') counts.completed++;
      });
      setTaskCounts(counts);

      // Apply client-side search filter
      if (search) {
        const searchLower = search.toLowerCase();
        takensData = takensData.filter(taken =>
          (taken.task?.title && taken.task.title.toLowerCase().includes(searchLower)) ||
          (taken.users && taken.users.some(user => user.name.toLowerCase().includes(searchLower))) ||
          (taken.ticketNumber && taken.ticketNumber.toString().includes(searchLower))
        );
      }

      // Apply client-side user name filter
      if (userId) {
        const userLower = userId.toLowerCase();
        takensData = takensData.filter(taken =>
          taken.users && taken.users.some(user =>
            user.name.toLowerCase().includes(userLower) ||
            (user.email && user.email.toLowerCase().includes(userLower))
          )
        );
      }

      // Apply client-side date filter
      if (date) {
        const filterDate = new Date(date).toLocaleDateString('id-ID');
        takensData = takensData.filter(taken => {
          const takenDate = taken.date ? new Date(taken.date).toLocaleDateString('id-ID') : '';
          return takenDate === filterDate;
        });
      }

      // Apply client-side status filter
      if (status) {
        takensData = takensData.filter(taken => taken.status === status);
      }

      // Define status priority for sorting
      const statusPriority = {
        'in_progress': 1,
        'pending': 2,
        'completed': 3
      };

      // Sort takens by status first, then by ticket_number
      takensData.sort((a, b) => {
        // First sort by status priority
        const statusA = statusPriority[a.status] || 999;
        const statusB = statusPriority[b.status] || 999;

        if (statusA !== statusB) {
          return statusA - statusB;
        }

        // If same status, sort by ticket number
        const aTicket = a.ticketNumber ?? Infinity;
        const bTicket = b.ticketNumber ?? Infinity;
        return aTicket - bTicket;
      });

      setTakens(takensData);
      setCurrentPage(0); // Reset pagination when loading new data
    } catch (err) {
      console.error('Error loading assignments:', err);
      setError('Failed to load assignments. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Load tasks from API
  const loadTasks = async () => {
    try {
      const response = await getTasks();
      setTasks(response.tasks || []);
    } catch (err) {
      console.error('Error loading tasks:', err);
    }
  };

  // Load users from API
  const loadUsers = async () => {
    try {
      const response = await getUsers();
      setUsers(response.users || []);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };

  // Load teams from API
  const loadTeams = async () => {
    try {
      const response = await getTeams();
      setTeams(response.teams || []);
    } catch (err) {
      console.error('Error loading teams:', err);
    }
  };

  const handleOpenModal = () => {
    setEditingTakenId(null);
    setShowModal(true);
    setUserSearch('');
    setTaskSearch('');
    setTeamSearch('');
    setAssignType('user');
    setFormData({
      taskId: '',
      userIds: [],
      teamId: '',
      date: new Date().toISOString().split('T')[0],
      startTime: ''
    });
  };

  // Edit an existing assignment: reuse the assign form, pre-filled
  const handleOpenEditModal = (taken) => {
    setEditingTakenId(taken.takenTaskId);
    setShowModal(true);
    setUserSearch('');
    setTaskSearch('');
    setTeamSearch('');
    setAssignType('user');
    setError('');
    setFormData({
      taskId: taken.task?.taskId || taken.taskId || '',
      userIds: (taken.users || []).map((u) => u.id),
      teamId: '',
      date: toDateInput(taken.date),
      startTime: toDateTimeLocal(taken.startTime)
    });
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingTakenId(null);
    setError('');
  };

  const handleAssignTypeChange = (type) => {
    setAssignType(type);
    // Clear the opposite selection so only one target is submitted
    setFormData(prev => ({
      ...prev,
      userIds: type === 'team' ? [] : prev.userIds,
      teamId: type === 'user' ? '' : prev.teamId
    }));
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleStatusFilterClick = (status) => {
    setFilters(prev => ({
      ...prev,
      status: status
    }));
  };

  const handleClearFilters = () => {
    setFilters({
      search: '',
      taskId: '',
      userId: '',
      status: '',
      date: ''
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate assignment target based on selected type
    if (assignType === 'team') {
      if (!formData.teamId) {
        setError('Please select a team to assign the task.');
        return;
      }
    } else {
      if (formData.userIds.length === 0) {
        setError('Please select at least one user to assign the task.');
        return;
      }
    }

    // Validate start time is selected
    if (!formData.startTime) {
      setError('Please select start time for the assignment.');
      return;
    }

    if (editingTakenId) {
      try {
        const updateData = {
          date: formData.date,
          startTime: formData.startTime
        };
        if (assignType === 'team') {
          updateData.teamId = formData.teamId;
        } else {
          updateData.userIds = formData.userIds;
        }
        await updateAssignment(editingTakenId, updateData);
        showToast('Assignment berhasil diperbarui!', 'success');
        setShowModal(false);
        setEditingTakenId(null);
        loadAssignments(filters);
      } catch (err) {
        console.error('Error updating assignment:', err);
        setError(err.response?.data?.message || 'Gagal memperbarui assignment. Silakan coba lagi.');
      }
      return;
    }

    try {
      // Create new assignment with default status 'pending'
      const assignmentData = {
        taskId: formData.taskId,
        date: formData.date,
        startTime: formData.startTime,
        status: 'pending'
      };
      if (assignType === 'team') {
        // Backend expands team members into assigned users
        assignmentData.teamId = formData.teamId;
      } else {
        assignmentData.userIds = formData.userIds;
      }
      await createAssignment(assignmentData);
      showToast('Assignment created successfully!', 'success');
      setShowModal(false);
      loadAssignments(filters);
    } catch (err) {
      console.error('Error saving assignment:', err);
      setError(err.response?.data?.message || 'Failed to save assignment. Please try again.');
    }
  };

  const handleDelete = async (takenId) => {
    showConfirmModal(
      'Delete Assignment',
      'Are you sure you want to delete this assignment? This action cannot be undone.',
      async () => {
        try {
          await deleteAssignment(takenId);
          clearUnread(takenId);
          showToast('Assignment deleted successfully!', 'success');
          loadAssignments(filters);
        } catch (err) {
          console.error('Error deleting assignment:', err);
          showToast(err.response?.data?.message || 'Failed to delete assignment.', 'error');
        }
      },
      'delete'
    );
  };

  const getStatusBadgeClass = (status) => {
    const statusMap = {
      'pending': 'status-pending',
      'in_progress': 'status-in-progress',
      'completed': 'status-completed'
    };
    return statusMap[status] || '';
  };

  const getStatusLabel = (status) => {
    const labelMap = {
      'pending': 'Pending',
      'in_progress': 'In Progress',
      'completed': 'Completed'
    };
    return labelMap[status] || status;
  };

  const hasActiveFilters = Object.values(filters).some(value => value !== '');

  return (
    <div className="taken-page">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`toast-notification ${toast.type}`}>
          <div className="toast-icon">
            {toast.type === 'success' && '✓'}
            {toast.type === 'error' && '✕'}
            {toast.type === 'warning' && '⚠'}
            {toast.type === 'info' && 'ℹ'}
          </div>
          <div className="toast-message">{toast.message}</div>
          <button
            className="toast-close"
            onClick={() => setToast({ show: false, message: '', type: '' })}
          >
            ✕
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.show && (
        <div className="confirm-overlay" onClick={handleCancelConfirm}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">
              {confirmModal.type === 'delete' && (
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="24" fill="#FEE2E2" />
                  <path d="M16 18H18H32M30 18V32C30 32.5304 29.7893 33.0391 29.4142 33.4142C29.0391 33.7893 28.5304 34 28 34H20C19.4696 34 18.9609 33.7893 18.5858 33.4142C18.2107 33.0391 18 32.5304 18 32V18M21 18V16C21 15.4696 21.2107 14.9609 21.5858 14.5858C21.9609 14.2107 22.4696 14 23 14H25C25.5304 14 26.0391 14.2107 26.4142 14.5858C26.7893 14.9609 27 15.4696 27 16V18" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <h3 className="confirm-title">{confirmModal.title}</h3>
            <p className="confirm-message">{confirmModal.message}</p>
            <div className="confirm-actions">
              <button className="btn-confirm-cancel" onClick={handleCancelConfirm}>
                Cancel
              </button>
              <button
                className={`btn-confirm-ok ${confirmModal.type}`}
                onClick={handleConfirm}
              >
                {confirmModal.type === 'delete' ? 'Delete' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="taken-header">
        <div>
          <h1>Task Assignment Management</h1>
          <p className="taken-subtitle">Manage and distribute tasks to team members</p>
        </div>
        <Can perm="assignments.create">
          <button className="btn-tambah" onClick={handleOpenModal}>
            <span className="btn-icon">+</span> Assign Task
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
          <span className={`badge ${filters.status === '' ? 'badge-white' : 'badge-grey'}`}>{taskCounts.total}</span>
        </div>
        <div
          className={`summary-card clickable-summary ${filters.status === 'in_progress' ? 'active-summary' : ''}`}
          onClick={() => handleStatusFilterClick('in_progress')}
        >
          <div className="card-left">
            <span className={`dot ${filters.status === 'in_progress' ? 'dot-white' : 'dot-blue'}`}></span>
            <span className="label">In Progress</span>
          </div>
          <span className={`badge ${filters.status === 'in_progress' ? 'badge-white' : 'badge-blue'}`}>{taskCounts.inProgress}</span>
        </div>
        <div
          className={`summary-card clickable-summary ${filters.status === 'pending' ? 'active-summary' : ''}`}
          onClick={() => handleStatusFilterClick('pending')}
        >
          <div className="card-left">
            <span className={`dot ${filters.status === 'pending' ? 'dot-white' : 'dot-orange'}`}></span>
            <span className="label">Pending</span>
          </div>
          <span className={`badge ${filters.status === 'pending' ? 'badge-white' : 'badge-orange'}`}>{taskCounts.pending}</span>
        </div>
        <div
          className={`summary-card clickable-summary ${filters.status === 'completed' ? 'active-summary' : ''}`}
          onClick={() => handleStatusFilterClick('completed')}
        >
          <div className="card-left">
            <span className={`dot ${filters.status === 'completed' ? 'dot-white' : 'dot-green'}`}></span>
            <span className="label">Completed</span>
          </div>
          <span className={`badge ${filters.status === 'completed' ? 'badge-white' : 'badge-green'}`}>{taskCounts.completed}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-section">
        <div className="filters-row">
          <div className="input-with-icon flex-grow">
            <svg className="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21.0004 21.0004L16.6504 16.6504" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              type="text"
              name="search"
              placeholder="Search assignments by task name or ticket..."
              value={filters.search}
              onChange={handleFilterChange}
              className="filter-input-icon"
            />
          </div>

          <div className="input-with-icon flex-grow">
            <svg className="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              type="text"
              name="userId"
              placeholder="Search by user name or email..."
              value={filters.userId}
              onChange={handleFilterChange}
              className="filter-input-icon"
            />
          </div>

          <div className="input-with-icon date-wrapper">
            <input
              type="date"
              name="date"
              value={filters.date}
              onChange={handleFilterChange}
              className="filter-input-icon"
              title="Filter by assignment date"
            />
          </div>

          <button onClick={handleClearFilters} className={`btn-clear ${hasActiveFilters ? 'active' : ''}`}>
            Clear Filters
          </button>
        </div>
      </div>

      {error && (
        <div className="error-alert">
          {error}
        </div>
      )}

      <div className="taken-content">
        <ResponsiveTable className="rt-responsive" tableClassName="taken-table" loading={loading} minWidth="900px" maxHeight="100%">
          <thead className="dark-header">
            <tr>
              <th>#</th>
              <th>TICKET</th>
              <th>TASK NAME</th>
              <th>ASSIGNED USERS</th>
              <th>DATE</th>
              <th>START TIME</th>
              <th>STATUS</th>
              <th className="monitor-header">MONITOR</th>
              <th className="actions-header">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {takens.length === 0 ? (
              <tr>
                <td colSpan="9" className="empty-state">
                  <div className="empty-content">
                    <span className="empty-icon">📋</span>
                    <p>No assignments yet</p>
                    <span>Click "Assign Task" button to create new assignment</span>
                  </div>
                </td>
              </tr>
            ) : (
              takens.map((taken, index) => (
                <tr key={taken.takenTaskId}>
                  <td className="row-number">{index + 1}</td>
                  <td className="date-cell">{taken.ticketNumber || '-'}</td>
                  <td className="taken-name">
                    {taken.task?.title || 'N/A'}
                    {taken.task?.createdByRole?.showBadge && (
                      <div className="task-creator-badge-row">
                        <TaskCreatorBadge createdByRole={taken.task.createdByRole} createdBy={taken.task.createdBy} compact />
                      </div>
                    )}
                  </td>
                  <td className="team-cell">
                    {taken.users && taken.users.length > 0 ? (
                      <div className="user-badges">
                        {(() => {
                          const usersList = taken.users;
                          const isExpanded = !!expandedUsers[taken.takenTaskId];
                          const MAX_VISIBLE = 2;
                          const visibleUsers = (usersList.length <= 3 || isExpanded) ? usersList : usersList.slice(0, MAX_VISIBLE);
                          const remainingCount = usersList.length - visibleUsers.length;
                          const remainingNames = usersList.slice(MAX_VISIBLE).map(u => u.name).join(', ');

                          return (
                            <>
                              {visibleUsers.map((user, idx) => {
                                const isCompleted = taken.userStatuses?.[user.id] === 'completed';
                                return (
                                  <span
                                    key={user.id || idx}
                                    className={`team-badge${isCompleted ? ' team-badge-completed' : ''}`}
                                    title={isCompleted ? `${user.name} (${user.email || 'No email'}) • Selesai` : `${user.name} (${user.email || 'No email'}) • Bertugas`}
                                  >
                                    <TakenAvatarChip user={user} size={20} />
                                    <span className="user-name-text">{user.name}</span>
                                    {isCompleted ? (
                                      <span className="badge-check" title="Selesai">✓</span>
                                    ) : (
                                      <span className="badge-dot-progress" title="Bertugas" />
                                    )}
                                  </span>
                                );
                              })}
                              {remainingCount > 0 && (
                                <button
                                  type="button"
                                  className="team-overflow-chip"
                                  onClick={() => toggleExpandUsers(taken.takenTaskId)}
                                  title={`Klik untuk melihat: ${remainingNames}`}
                                >
                                  +{remainingCount} lainnya
                                </button>
                              )}
                              {isExpanded && usersList.length > 3 && (
                                <button
                                  type="button"
                                  className="team-collapse-chip"
                                  onClick={() => toggleExpandUsers(taken.takenTaskId)}
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
                      <span className="assignment-badge unassigned-badge" title="Belum ada teknisi ditugaskan">
                        <span className="unassigned-dot" /> Belum Ditugaskan
                      </span>
                    )}
                  </td>
                  <td className="deadline-cell">
                    {taken.date ? new Date(taken.date).toLocaleDateString() : '-'}
                  </td>
                  <td className="date-cell">
                    {taken.startTime ? new Date(taken.startTime).toLocaleString() : '-'}
                  </td>
                  <td>
                    <span className={`status-badge ${getStatusBadgeClass(taken.status)}`}>
                      {getStatusLabel(taken.status)}
                    </span>
                  </td>
                  <td className="monitor-cell">
                    <Can
                      anyOf={['monitoring.view_reports', 'monitoring.view_locations']}
                      fallback={<span className="no-assignment">-</span>}
                    >
                    <div className="monitor-btn-wrapper">
                      <button
                        className="action-btn monitor-btn"
                        onClick={() => {
                          if (taken.status !== 'pending') {
                            navigate(`/monitoring/${taken.takenTaskId}`);
                          }
                        }}
                        disabled={taken.status === 'pending'}
                        title={taken.status === 'pending' ? 'Monitoring tidak tersedia untuk task pending' : 'View Monitoring'}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 7C12 9.20914 10.2091 11 8 11C5.79086 11 4 9.20914 4 7C4 4.79086 5.79086 3 8 3C10.2091 3 12 4.79086 12 7Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M8 9C8.55228 9 9 8.55228 9 8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8C7 8.55228 7.44772 9 8 9Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M2 7C2.66667 4.33333 4.66667 2 8 2C11.3333 2 13.3333 4.33333 14 7C13.3333 9.66667 11.3333 12 8 12C4.66667 12 2.66667 9.66667 2 7Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      {getUnreadCount(taken.takenTaskId) > 0 && (
                        <span className="monitor-unread-badge">
                          {getUnreadCount(taken.takenTaskId) > 99 ? '99+' : getUnreadCount(taken.takenTaskId)}
                        </span>
                      )}
                    </div>
                    </Can>
                  </td>
                  <td className="actions-cell">
                    <Can perm="assignments.update">
                    <button
                      className="action-btn edit-btn"
                      onClick={() => handleOpenEditModal(taken)}
                      title="Edit"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M11.333 2.00004C11.5081 1.82494 11.716 1.68605 11.9447 1.59129C12.1735 1.49653 12.4187 1.44775 12.6663 1.44775C12.914 1.44775 13.1592 1.49653 13.3879 1.59129C13.6167 1.68605 13.8246 1.82494 13.9997 2.00004C14.1748 2.17513 14.3137 2.383 14.4084 2.61178C14.5032 2.84055 14.552 3.08575 14.552 3.33337C14.552 3.58099 14.5032 3.82619 14.4084 4.05497C14.3137 4.28374 14.1748 4.49161 13.9997 4.66671L5.33301 13.3334L1.99967 14.3334L2.99967 11L11.333 2.00004Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    </Can>
                    <Can perm="assignments.delete">
                    <button
                      className="action-btn delete-btn"
                      onClick={() => handleDelete(taken.takenTaskId)}
                      title="Delete"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 4H3.33333H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M5.33301 4.00004V2.66671C5.33301 2.31309 5.47348 1.97395 5.72353 1.7239C5.97358 1.47385 6.31272 1.33337 6.66634 1.33337H9.33301C9.68663 1.33337 10.0258 1.47385 10.2758 1.7239C10.5259 1.97395 10.6663 2.31309 10.6663 2.66671V4.00004M12.6663 4.00004V13.3334C12.6663 13.687 12.5259 14.0261 12.2758 14.2762C12.0258 14.5262 11.6866 14.6667 11.333 14.6667H4.66634C4.31272 14.6667 3.97358 14.5262 3.72353 14.2762C3.47348 14.0261 3.33301 13.687 3.33301 13.3334V4.00004H12.6663Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    </Can>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ResponsiveTable>

        {/* Table Footer */}
        <div className="table-footer">
          <div className="showing-text">
            Showing <strong>{takens.length}</strong> of <strong>{taskCounts.total}</strong> assignments
          </div>
          <div className="legend">
            <span className="dot dot-blue"></span> {taskCounts.inProgress} In Progress
            <span className="dot dot-orange"></span> {taskCounts.pending} Pending
            <span className="dot dot-green"></span> {taskCounts.completed} Completed
          </div>
        </div>
      </div>

      {/* Modal for adding/editing assignment */}
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTakenId ? 'Edit Assignment' : 'Assign Task'}</h2>
              <button className="modal-close" onClick={handleCloseModal}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {error && (
              <div className="error-alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="taskId">Task <span className="required">*</span></label>

                {/* Selected Task - Reusing user selection styles */}
                {formData.taskId && (
                  <div className="selected-users-container">
                    {(() => {
                      const editingTaken = editingTakenId ? takens.find(t => t.takenTaskId === editingTakenId) : null;
                      const task = tasks.find(t => t.taskId === formData.taskId) || editingTaken?.task;
                      return task ? (
                        <div className="selected-user-badge">
                          <div className="user-info">
                            <span className="user-name">{task.title}</span>
                            {task.location && <span className="user-dept">{task.location}</span>}
                          </div>
                          {!editingTakenId && (
                          <button
                            type="button"
                            className="remove-user-btn"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, taskId: '' }));
                              setTaskSearch('');
                            }}
                            title="Remove task"
                          >
                            ✕
                          </button>
                          )}
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}

                {/* Task Search - Reusing user search styles */}
                {!formData.taskId && (
                  <>
                    <div className="user-search-container">
                      <input
                        type="text"
                        placeholder="Search tasks..."
                        value={taskSearch}
                        onChange={(e) => setTaskSearch(e.target.value)}
                        className="user-search-input"
                      />
                      {taskSearch && (
                        <button
                          type="button"
                          className="clear-search-btn"
                          onClick={() => setTaskSearch('')}
                          title="Clear search"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Available Tasks - Reusing user list styles */}
                    <div className="available-users-container">
                      {tasks
                        .filter(task =>
                          task.status !== 'inactive' &&
                          (task.title.toLowerCase().includes(taskSearch.toLowerCase()) ||
                            (task.location && task.location.toLowerCase().includes(taskSearch.toLowerCase())))
                        )
                        .map(task => (
                          <div
                            key={task.taskId}
                            className="available-user-item"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, taskId: task.taskId }));
                              setTaskSearch('');
                            }}
                          >
                            <div className="user-info">
                              <span className="user-name">{task.title}</span>
                            </div>
                          </div>
                        ))}
                      {tasks.filter(task =>
                        task.status !== 'inactive' &&
                        (task.title.toLowerCase().includes(taskSearch.toLowerCase()) ||
                          (task.location && task.location.toLowerCase().includes(taskSearch.toLowerCase())))
                      ).length === 0 && (
                          <div className="no-users-message">
                            No tasks found
                          </div>
                        )}
                    </div>
                  </>
                )}
              </div>

              <div className="form-group">
                <label>Assign To <span className="required">*</span></label>
                <div className="assign-type-toggle">
                  <button
                    type="button"
                    className={`assign-type-btn ${assignType === 'user' ? 'active' : ''}`}
                    onClick={() => handleAssignTypeChange('user')}
                  >
                    User
                  </button>
                  {canPickTeams && (
                  <button
                    type="button"
                    className={`assign-type-btn ${assignType === 'team' ? 'active' : ''}`}
                    onClick={() => handleAssignTypeChange('team')}
                  >
                    Team
                  </button>
                  )}
                </div>
              </div>

              {assignType === 'user' ? (
              <div className="form-group">
                <label htmlFor="userIds">Assign to Users <span className="required">*</span></label>

                {/* Selected Users - Always shown, looks like input field */}
                <div className="selected-users-container">
                  {formData.userIds.map(userId => {
                    const editingTaken = editingTakenId ? takens.find(t => t.takenTaskId === editingTakenId) : null;
                    const user = users.find(u => u.id === userId) || editingTaken?.users?.find(u => u.id === userId);
                    return user ? (
                      <div key={userId} className="selected-user-badge">
                        <span className="user-name">{user.name}</span>
                        <button
                          type="button"
                          className="remove-user-btn"
                          onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              userIds: prev.userIds.filter(id => id !== userId)
                            }));
                          }}
                          title="Remove user"
                        >
                          ✕
                        </button>
                      </div>
                    ) : null;
                  })}
                </div>

                {/* Search Bar */}
                <div className="user-search-container">
                  <input
                    type="text"
                    placeholder="Search employees..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="user-search-input"
                  />
                  {userSearch && (
                    <button
                      type="button"
                      className="clear-search-btn"
                      onClick={() => setUserSearch('')}
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Available Users */}
                <div className="available-users-container">
                  {users
                    .filter(user =>
                      user.platform === 'mobile' &&
                      !formData.userIds.includes(user.id) &&
                      (user.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                        (user.department && user.department.toLowerCase().includes(userSearch.toLowerCase())))
                    )
                    .map(user => (
                      <div
                        key={user.id}
                        className="available-user-item"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            userIds: [...prev.userIds, user.id]
                          }));
                        }}
                      >
                        <span className="user-name">{user.name}</span>
                        {user.department && <span className="user-dept"> • {user.department}</span>}
                      </div>
                    ))}
                  {users.filter(user =>
                    user.platform === 'mobile' &&
                    !formData.userIds.includes(user.id) &&
                    (user.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                      (user.department && user.department.toLowerCase().includes(userSearch.toLowerCase())))
                  ).length === 0 && (
                      <div className="no-users-message">
                        {userSearch ? 'No employees found' : (formData.userIds.length > 0 ? 'All employees selected' : 'No employees available')}
                      </div>
                    )}
                </div>
                <small className="form-hint">Search and click to add • {formData.userIds.length} selected</small>
              </div>
              ) : (
              <div className="form-group">
                <label htmlFor="teamId">Assign to Team <span className="required">*</span></label>

                {/* Selected Team */}
                {formData.teamId && (
                  <div className="selected-users-container">
                    {(() => {
                      const team = teams.find(t => t.id === formData.teamId);
                      return team ? (
                        <div className="selected-user-badge">
                          <div className="user-info">
                            <span className="user-name">{team.name}</span>
                            {team.members && team.members.length > 0 && (
                              <span className="user-dept">{team.members.length} member(s)</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="remove-user-btn"
                            onClick={() => setFormData(prev => ({ ...prev, teamId: '' }))}
                            title="Remove team"
                          >
                            ✕
                          </button>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}

                {/* Team Search */}
                {!formData.teamId && (
                  <>
                    <div className="user-search-container">
                      <input
                        type="text"
                        placeholder="Search teams..."
                        value={teamSearch}
                        onChange={(e) => setTeamSearch(e.target.value)}
                        className="user-search-input"
                      />
                      {teamSearch && (
                        <button
                          type="button"
                          className="clear-search-btn"
                          onClick={() => setTeamSearch('')}
                          title="Clear search"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Available Teams */}
                    <div className="available-users-container">
                      {teams
                        .filter(team => team.name.toLowerCase().includes(teamSearch.toLowerCase()))
                        .map(team => (
                          <div
                            key={team.id}
                            className="available-user-item"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, teamId: team.id }));
                              setTeamSearch('');
                            }}
                          >
                            <div className="user-info">
                              <span className="user-name">{team.name}</span>
                              {team.members && team.members.length > 0 && (
                                <span className="user-dept"> • {team.members.length} member(s)</span>
                              )}
                            </div>
                          </div>
                        ))}
                      {teams.filter(team => team.name.toLowerCase().includes(teamSearch.toLowerCase())).length === 0 && (
                        <div className="no-users-message">
                          {teamSearch ? 'No teams found' : 'No teams available'}
                        </div>
                      )}
                    </div>
                  </>
                )}
                <small className="form-hint">All members of the selected team will be assigned • {formData.teamId ? '1 team selected' : 'No team selected'}</small>
              </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="date">Date <span className="required">*</span></label>
                  <input
                    type="date"
                    id="date"
                    name="date"
                    value={formData.date}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="startTime">Start Time <span className="required">*</span></label>
                  <input
                    type="datetime-local"
                    id="startTime"
                    name="startTime"
                    value={formData.startTime}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={handleCloseModal}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">
                  {editingTakenId ? 'Simpan Perubahan' : 'Assign Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Taken;
