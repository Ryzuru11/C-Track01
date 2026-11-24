import React, { useState, useEffect, useRef } from 'react';
import { getUsers, getUserDetails, createUser, updateUserProfile, updateUserStatus, deleteUser, getDepartments, getUserAvatar, uploadAvatar, clearAvatarCache, getAssignableRoles } from '../../services/api';
import { getCurrentUser } from '../../utils/auth';
import { compressAndCropImage, getImageDimensions } from '../../utils/imageCompressor';
import './UserManagement.css';
import ResponsiveTable from '../../components/ResponsiveTable/ResponsiveTable';
import Can from '../../components/Can';
import useAccess from '../../hooks/useAccess';

const DEFAULT_ROLE_COLOR = '#6b7280';
const HIERARCHY_TOOLTIP = 'Tidak dapat mengelola user dengan role setara/lebih tinggi';

const capitalize = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '');

// Role meta for display, from the fields the server adds to each user (RBAC v2)
const getUserRoleMeta = (user) => ({
  name: user?.role || '',
  displayName: user?.roleDisplayName || capitalize(user?.role) || 'N/A',
  color: user?.roleColor || DEFAULT_ROLE_COLOR,
  level: typeof user?.roleLevel === 'number' ? user.roleLevel : 0,
});

// One summary entry per role that has users, highest level first
const buildRoleSummary = (usersData) => {
  const byRole = new Map();
  usersData.forEach((user) => {
    const meta = getUserRoleMeta(user);
    if (!meta.name) return;
    const entry = byRole.get(meta.name) || { ...meta, count: 0 };
    entry.count += 1;
    byRole.set(meta.name, entry);
  });
  return Array.from(byRole.values()).sort(
    (a, b) => b.level - a.level || a.displayName.localeCompare(b.displayName)
  );
};

function UserManagement() {
  const { can, canAny } = useAccess();
  const isInitialMount = useRef(true);
  const hasInitiatedLoad = useRef(false); // Prevent double loading in StrictMode
  const [showModal, setShowModal] = useState(false);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [toast, setToast] = useState({ show: false, message: '', type: '' });
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null, type: 'delete' });
  const [userCounts, setUserCounts] = useState({ total: 0, active: 0, inactive: 0 });
  const [roleSummary, setRoleSummary] = useState([]); // [{ name, displayName, color, level, count }]
  const [assignableRoles, setAssignableRoles] = useState([]); // roles the current user may assign
  const [editingUserRole, setEditingUserRole] = useState(null); // original role of the user being edited

  const [avatarPreview, setAvatarPreview] = useState(null);
  const [currentAvatar, setCurrentAvatar] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    password_confirmation: '',
    phoneNumber: '',
    department: '',
    position: '',
    address: '',
    status: 'active',
    role: ''
  });

  // ?role=<name> (e.g. from the Role dashboard "Anggota" tab) pre-filters the list
  const [filters, setFilters] = useState(() => ({
    search: '',
    department: '',
    status: '',
    role: new URLSearchParams(window.location.search).get('role') || ''
  }));

  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 6;

  // Roles the current user may assign come from GET /admin/roles/assignable (level-based, server side)
  const allowedRolesToCreate = assignableRoles;

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

  // Load users on component mount
  useEffect(() => {
    if (hasInitiatedLoad.current) return;
    hasInitiatedLoad.current = true;
    loadUsers(filters);
    // Roles the current user may assign (create user / change role)
    if (canAny(['users.create', 'users.update'])) {
      getAssignableRoles()
        .then((response) => setAssignableRoles(response.data || []))
        .catch((err) => {
          console.error('Error loading assignable roles:', err);
          setAssignableRoles([]);
        });
    }
    // TODO: Implement departments endpoint in backend
    // loadDepartments();
    // Mount-only load (initial ?role= filter + assignable roles)
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
      loadUsers(filters);
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [filters]);

  // Load users from API
  const loadUsers = async (filterParams = {}) => {
    try {
      setLoading(true);
      setError('');
      const response = await getUsers();
      let usersData = response.users || [];

      setUserCounts({
        total: usersData.length,
        active: usersData.filter(u => u.status === 'active').length,
        inactive: usersData.filter(u => u.status === 'inactive').length
      });
      setRoleSummary(buildRoleSummary(usersData));

      // Apply client-side filters
      if (filterParams.search) {
        const searchLower = filterParams.search.toLowerCase();
        usersData = usersData.filter(user =>
          user.name.toLowerCase().includes(searchLower) ||
          user.email.toLowerCase().includes(searchLower)
        );
      }

      if (filterParams.department) {
        usersData = usersData.filter(user =>
          user.department === filterParams.department
        );
      }

      if (filterParams.status) {
        usersData = usersData.filter(user =>
          user.status === filterParams.status
        );
      }

      if (filterParams.role) {
        usersData = usersData.filter(user =>
          user.role === filterParams.role
        );
      }

      // Sort users by role level (highest first)
      usersData.sort((a, b) => getUserRoleMeta(b).level - getUserRoleMeta(a).level);

      setUsers(usersData);
      setCurrentPage(0); // Reset pagination when loading new data
    } catch (err) {
      console.error('Error loading users:', err);
      setError('Failed to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Load departments from API
  const loadDepartments = async () => {
    try {
      const response = await getDepartments();
      setDepartments(response.departments || []);
    } catch (err) {
      console.error('Error loading departments:', err);
    }
  };

  const handleOpenModal = () => {
    setShowModal(true);
    setEditMode(false);
    setCurrentUserId(null);
    setAvatarPreview(null);
    setCurrentAvatar(null);
    setEditingUserRole(null);
    // Set default role to first assignable role
    const defaultRole = allowedRolesToCreate.length > 0 ? allowedRolesToCreate[0].name : '';
    setFormData({
      name: '',
      email: '',
      password: '',
      password_confirmation: '',
      phoneNumber: '',
      department: '',
      position: '',
      address: '',
      status: 'active',
      role: defaultRole
    });
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditMode(false);
    setCurrentUserId(null);
    setAvatarPreview(null);
    setCurrentAvatar(null);
    setError('');
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

  const handleCardFilterClick = (type, value) => {
    if (type === 'all') {
      setFilters(prev => ({
        ...prev,
        status: '',
        role: ''
      }));
    } else if (type === 'role') {
      setFilters(prev => ({
        ...prev,
        role: value,
        status: ''
      }));
    } else if (type === 'status') {
      setFilters(prev => ({
        ...prev,
        status: value,
        role: ''
      }));
    }
  };

  const handleClearFilters = () => {
    setFilters({
      search: '',
      department: '',
      status: '',
      role: ''
    });
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // File size validation (max 5MB)
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_FILE_SIZE) {
      showToast(`File too large! Max size is 5MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB`, 'error');
      console.warn(`❌ File size: ${(file.size / 1024 / 1024).toFixed(2)}MB - EXCEEDS 5MB LIMIT`);
      e.target.value = ''; // Reset input
      return;
    }

    console.log(`📸 Avatar file selected: ${file.name}`);
    console.log(`📏 Binary size: ${(file.size / 1024).toFixed(2)}KB`);
    console.log(`📝 File type: ${file.type}`);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const base64String = event.target.result;
        const originalBase64Size = Math.ceil(base64String.length / 1024);

        console.log(`📦 Original base64 size: ${originalBase64Size}KB`);
        console.log(`⏳ Compressing and cropping image...`);

        // Get original dimensions first
        const originalDimensions = await getImageDimensions(base64String);
        console.log(`   Original dimensions: ${originalDimensions.width}x${originalDimensions.height}px`);

        // Compress and crop to square
        const compressedBase64 = await compressAndCropImage(base64String, {
          maxWidth: 500,
          maxHeight: 500,
          quality: 0.8,
          cropToSquare: true // For avatars, crop to square
        });

        const compressedBase64Size = Math.ceil(compressedBase64.length / 1024);
        const savingPercent = ((1 - compressedBase64Size / originalBase64Size) * 100).toFixed(1);

        console.log(`✅ Compression complete! Saving ${savingPercent}% from base64 size`);
        console.log(`   Ready to upload: ${compressedBase64Size}KB`);

        setAvatarPreview(compressedBase64);
        showToast(`✓ Image compressed & cropped to square - Saved ${savingPercent}%`, 'success');
      } catch (error) {
        console.error(`❌ Image compression failed:`, error);
        showToast(`Failed to compress image: ${error.message}`, 'error');
        e.target.value = ''; // Reset input
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = () => {
    setAvatarPreview(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate password confirmation
    if (formData.password && formData.password !== formData.password_confirmation) {
      showToast('Password and confirmation do not match', 'error');
      return;
    }

    // Validate password length if provided
    if (formData.password && formData.password.length < 8) {
      showToast('Password must be at least 8 characters', 'error');
      return;
    }

    if (!editMode && !formData.role) {
      showToast('Pilih role untuk user baru', 'error');
      return;
    }

    try {
      if (editMode && currentUserId) {
        // Update existing user
        // Only include password if it's filled
        const updateData = { ...formData };
        if (!updateData.password) {
          delete updateData.password;
          delete updateData.password_confirmation;
        }
        // Only send a role change when the role actually changed
        if (!updateData.role || updateData.role === editingUserRole) {
          delete updateData.role;
        }
        // Status changes need users.toggle_status
        if (!can('users.toggle_status')) {
          delete updateData.status;
        }
        await updateUserProfile(currentUserId, updateData);
        // Upload new avatar if one was selected
        if (avatarPreview) {
          await uploadAvatar(currentUserId, avatarPreview);
        }
        showToast('User updated successfully!', 'success');
      } else {
        // Create new user
        const response = await createUser(formData);
        // Upload avatar for newly created user if one was selected
        if (avatarPreview && response.user?.id) {
          await uploadAvatar(response.user.id, avatarPreview);
        }
        console.log('User created successfully:', response);
        showToast('User created successfully!', 'success');
      }

      setShowModal(false);
      // Reload tanpa filter untuk memastikan data terbaru muncul
      loadUsers();
    } catch (err) {
      console.error('Error saving user:', err);
      console.error('Error response:', err.response?.data);
      const errorMessage = err.response?.data?.message || err.response?.data?.error || 'Failed to save user. Please try again.';
      showToast(errorMessage, 'error');
    }
  };

  const handleEdit = async (userId) => {
    try {
      setLoading(true);
      // Hierarchy check is computed by the server (user.can) on the list item
      const listUser = users.find(u => u.id === userId);
      if (!listUser?.can?.update) {
        showToast(HIERARCHY_TOOLTIP, 'error');
        setLoading(false);
        return;
      }

      const response = await getUserDetails(userId);
      const user = response.user;

      setFormData({
        name: user.name || '',
        email: user.email || '',
        password: '',
        password_confirmation: '',
        phoneNumber: user.phoneNumber || '',
        department: user.department || '',
        position: user.position || '',
        address: user.address || '',
        status: user.status || 'active',
        role: user.role || listUser.role || ''
      });

      setEditingUserRole(user.role || listUser.role || null);
      setCurrentUserId(userId);
      setEditMode(true);
      setAvatarPreview(null);
      // Normalize raw base64 (no prefix) to data URI to prevent 431 from img src URL request
      const rawAvatar = user.avatar || null;
      setCurrentAvatar(
        rawAvatar
          ? rawAvatar.startsWith('data:') ? rawAvatar : `data:image/jpeg;base64,${rawAvatar}`
          : null
      );
      setShowModal(true);
    } catch (err) {
      console.error('Error loading user details:', err);
      showToast('Failed to load user details', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (userId) => {
    // Find the user to check permissions
    const targetUser = users.find(u => u.id === userId);

    if (!targetUser) {
      showToast('User not found', 'error');
      return;
    }

    // Check if current user can delete this user (computed server-side)
    if (!targetUser.can?.delete) {
      const currentUser = getCurrentUser();
      if (currentUser?.id === targetUser.id) {
        showToast('You cannot delete your own account', 'error');
      } else {
        showToast(HIERARCHY_TOOLTIP, 'error');
      }
      return;
    }

    showConfirmModal(
      'Delete User',
      'Are you sure you want to delete this user? This action cannot be undone.',
      async () => {
        try {
          await deleteUser(userId);
          showToast('User deleted successfully!', 'success');
          // Reload tanpa filter untuk menghindari data hilang
          loadUsers();
        } catch (err) {
          console.error('Error deleting user:', err);
          showToast(err.response?.data?.message || 'Failed to delete user. You may not have permission.', 'error');
        }
      },
      'delete'
    );
  };

  const handleToggleStatus = async (userId, currentStatus) => {
    // Find the user to check permissions
    const targetUser = users.find(u => u.id === userId);

    if (!targetUser) {
      showToast('User not found', 'error');
      return;
    }

    // Check if current user can change this user's status (computed server-side)
    if (!targetUser.can?.toggleStatus) {
      const currentUser = getCurrentUser();
      if (currentUser?.id === targetUser.id) {
        showToast('You cannot change your own status', 'error');
      } else {
        showToast(HIERARCHY_TOOLTIP, 'error');
      }
      return;
    }

    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';

    showConfirmModal(
      `${newStatus === 'active' ? 'Activate' : 'Deactivate'} User`,
      `Are you sure you want to ${newStatus === 'active' ? 'activate' : 'deactivate'} this user?`,
      async () => {
        try {
          await updateUserStatus(userId, newStatus);
          showToast(`User ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully!`, 'success');
          // Reload tanpa filter untuk menghindari data hilang
          loadUsers();
        } catch (err) {
          console.error('Error updating user status:', err);
          showToast('Failed to update user status', 'error');
        }
      },
      newStatus === 'active' ? 'activate' : 'deactivate'
    );
  };

  const getStatusBadgeClass = (status) => {
    return status === 'active' ? 'status-badge status-active' : 'status-badge status-inactive';
  };

  // Role chip colours come from roleColor (light tint background + solid text)
  const getRoleChipStyle = (user) => {
    const { color } = getUserRoleMeta(user);
    return { backgroundColor: `${color}1a`, color };
  };

  // Tooltip + disabled state for a row action, from the server-computed user.can
  const actionState = (allowed, label) => ({
    disabled: !allowed,
    title: allowed ? label : HIERARCHY_TOOLTIP,
    style: { opacity: allowed ? 1 : 0.5, cursor: allowed ? 'pointer' : 'not-allowed' },
  });

  // Role options for the edit form: assignable roles, plus the user's current role
  const getEditRoleOptions = () => {
    const options = [...allowedRolesToCreate];
    if (editingUserRole && !options.some((r) => r.name === editingUserRole)) {
      const target = users.find((u) => u.id === currentUserId);
      options.unshift({
        name: editingUserRole,
        displayName: getUserRoleMeta(target || { role: editingUserRole }).displayName,
        locked: true,
      });
    }
    return options;
  };

  const hasActiveFilters = Object.values(filters).some(value => value !== '');

  return (
    <div className="user-management-page">
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
              {(confirmModal.type === 'activate' || confirmModal.type === 'deactivate') && (
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="24" fill={confirmModal.type === 'activate' ? '#D1FAE5' : '#FEF3C7'} />
                  <path d="M24 16V24M24 24V32M24 24H32M24 24H16" stroke={confirmModal.type === 'activate' ? '#34C759' : '#FF9500'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

      <div className="user-header">
        <div>
          <h1>User Management</h1>
          <p className="user-subtitle">Manage system users and permissions</p>
        </div>
        <Can perm="users.create">
          <button className="btn-tambah" onClick={handleOpenModal}>
            <span className="btn-icon">+</span>
            Add User
          </button>
        </Can>
      </div>

      <div className="summary-cards">
        <div
          className={`summary-card clickable-summary ${filters.role === '' && filters.status === '' ? 'active-summary' : ''}`}
          onClick={() => handleCardFilterClick('all')}
        >
          <span className={`dot ${filters.role === '' && filters.status === '' ? 'dot-white' : 'dot-black'}`}></span>
          <span className="label">Total</span>
          <span className={`badge ${filters.role === '' && filters.status === '' ? 'badge-white' : 'badge-grey'}`}>{userCounts.total}</span>
        </div>
        {roleSummary.map((role) => {
          const isActive = filters.role === role.name;
          return (
            <div
              key={role.name}
              className={`summary-card clickable-summary ${isActive ? 'active-summary' : ''}`}
              onClick={() => handleCardFilterClick('role', role.name)}
            >
              <span className="dot" style={{ backgroundColor: role.color }}></span>
              <span className="label">{role.displayName}</span>
              <span className="badge" style={{ backgroundColor: `${role.color}1a`, color: role.color }}>{role.count}</span>
            </div>
          );
        })}
      </div>

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
              placeholder="Search by name or email..."
              value={filters.search}
              onChange={handleFilterChange}
              className="filter-input-icon"
            />
          </div>

          <div className="input-with-icon select-wrapper">
            <select
              name="department"
              value={filters.department}
              onChange={handleFilterChange}
              className="filter-select-icon"
            >
              <option value="">All Departments</option>
              {departments.map((dept, index) => (
                <option key={index} value={dept.name}>{dept.name}</option>
              ))}
            </select>
          </div>

          <div className="input-with-icon select-wrapper">
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="filter-select-icon"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
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

      <div className="user-content">
        <ResponsiveTable className="rt-responsive" tableClassName="user-table" loading={loading} minWidth="1000px" maxHeight="100%">
          <thead className="dark-header">
            <tr>
              <th className="name-col">NAME</th>
              <th>EMAIL</th>
              <th>PHONE</th>
              <th>DEPARTMENT</th>
              <th>POSITION</th>
              <th className="role-col">ROLE</th>
              <th className="status-col">STATUS</th>
              <th className="actions-header">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-state">
                  <div className="empty-content">
                    <span className="empty-icon">👥</span>
                    <p>No users found</p>
                    <span>Try adjusting your filters or add a new user</span>
                  </div>
                </td>
              </tr>
            ) : (
              users.map((user, index) => {
                const rawAvatar = user.avatar;
                const displayAvatar = rawAvatar ? (rawAvatar.startsWith('data:') ? rawAvatar : `data:image/jpeg;base64,${rawAvatar}`) : null;
                const initials = user.name.substring(0, 2).toUpperCase();

                return (
                  <tr key={user.id}>
                    <td>
                      <div className="user-info-cell">
                        <div className="user-avatar-small" style={getRoleChipStyle(user)}>
                          {displayAvatar ? (
                            <img src={displayAvatar} alt={user.name} />
                          ) : (
                            <span>{initials}</span>
                          )}
                        </div>
                        <div className="user-details">
                          <span className="user-name-text">{user.name}</span>
                          <span className="user-id-text">ID #{user.id.toString().padStart(4, '0')}</span>
                        </div>
                      </div>
                    </td>
                    <td>{user.email}</td>
                    <td>{user.phoneNumber || '-'}</td>
                    <td>
                      {user.department && user.department !== '-' ? (
                        <span className="dept-badge">{user.department}</span>
                      ) : '-'}
                    </td>
                    <td>{user.position || '-'}</td>
                    <td className="role-col">
                      <span className="role-badge" style={getRoleChipStyle(user)}>
                        {getUserRoleMeta(user).displayName}
                      </span>
                    </td>
                    <td className="status-col">
                      <span className={getStatusBadgeClass(user.status)}>
                        <span className="badge-dot"></span>
                        {user.status}
                      </span>
                    </td>
                    <td className="actions-cell">
                      <Can perm="users.update">
                      <button
                        className="action-btn edit-btn"
                        onClick={() => handleEdit(user.id)}
                        {...actionState(!!user.can?.update, 'Edit')}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M11.333 2.00004C11.5081 1.82494 11.716 1.68605 11.9447 1.59129C12.1735 1.49653 12.4187 1.44775 12.6663 1.44775C12.914 1.44775 13.1592 1.49653 13.3879 1.59129C13.6167 1.68605 13.8246 1.82494 13.9997 2.00004C14.1748 2.17513 14.3137 2.383 14.4084 2.61178C14.5032 2.84055 14.552 3.08575 14.552 3.33337C14.552 3.58099 14.5032 3.82619 14.4084 4.05497C14.3137 4.28374 14.1748 4.49161 13.9997 4.66671L5.33301 13.3334L1.99967 14.3334L2.99967 11L11.333 2.00004Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      </Can>
                      <Can perm="users.toggle_status">
                      <button
                        className="action-btn toggle-btn"
                        onClick={() => handleToggleStatus(user.id, user.status)}
                        {...actionState(!!user.can?.toggleStatus, user.status === 'active' ? 'Deactivate' : 'Activate')}
                      >
                        {user.status === 'active' ? (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M13.3337 4L6.00033 11.3333L2.66699 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      </Can>
                      <Can perm="users.delete">
                      <button
                        className="action-btn delete-btn"
                        onClick={() => handleDelete(user.id)}
                        {...actionState(!!user.can?.delete, 'Delete')}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M2 4H3.33333H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M5.33301 4.00004V2.66671C5.33301 2.31309 5.47348 1.97395 5.72353 1.7239C5.97358 1.47385 6.31272 1.33337 6.66634 1.33337H9.33301C9.68663 1.33337 10.0258 1.47385 10.2758 1.7239C10.5259 1.97395 10.6663 2.31309 10.6663 2.66671V4.00004M12.6663 4.00004V13.3334C12.6663 13.687 12.5259 14.0261 12.2758 14.2762C12.0258 14.5262 11.6866 14.6667 11.333 14.6667H4.66634C4.31272 14.6667 3.97358 14.5262 3.72353 14.2762C3.47348 14.0261 3.33301 13.687 3.33301 13.3334V4.00004H12.6663Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      </Can>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </ResponsiveTable>

        {/* Table Footer */}
        <div className="table-footer">
          <div className="showing-text">
            Showing <strong>{users.length}</strong> of <strong>{userCounts.total}</strong> users
          </div>
          <div className="legend">
            {roleSummary.map((role) => (
              <React.Fragment key={role.name}>
                <span className="dot" style={{ backgroundColor: role.color }}></span> {role.count} {role.displayName}
              </React.Fragment>
            ))}
            <span className="dot dot-green"></span> {userCounts.active} Active
            <span className="dot dot-orange"></span> {userCounts.inactive} Inactive
          </div>
        </div>
      </div>
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editMode ? 'Edit User' : 'Add New User'}</h2>
              <button className="modal-close" onClick={handleCloseModal}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {error && (
              <div className="modal-error">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="modal-form">
              {/* Avatar Upload Section */}
              <div className="avatar-section">
                <label className="avatar-label">Profile Picture{!editMode && ' (Optional)'}</label>
                <div className="avatar-upload-container">
                  <div className="avatar-preview-area">
                    {(avatarPreview || currentAvatar) ? (
                      <img
                        src={avatarPreview || currentAvatar}
                        alt="Profile"
                        className="avatar-preview-img"
                      />
                    ) : (
                      <div className="avatar-placeholder">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#86868b" strokeWidth="1.5">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="avatar-controls">
                    <label htmlFor="avatarInput" className="btn-upload-avatar">
                      {editMode && currentAvatar && !avatarPreview ? 'Change Photo' : 'Upload Photo'}
                    </label>
                    <input
                      type="file"
                      id="avatarInput"
                      accept="image/*"
                      onChange={handleAvatarChange}
                      style={{ display: 'none' }}
                    />
                    {avatarPreview && (
                      <button type="button" className="btn-remove-avatar" onClick={handleRemoveAvatar}>
                        Remove
                      </button>
                    )}
                    <p className="avatar-hint">
                      {editMode && currentAvatar && !avatarPreview
                        ? 'Current photo shown. Click to change.'
                        : 'JPG, PNG, GIF up to 5MB • Auto-compressed & cropped to square'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="name">Full Name *</label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                    placeholder="Enter full name"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="email">Email *</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    placeholder="user@example.com"
                  />
                </div>
              </div>

              {!editMode && (
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="password">Password *</label>
                    <input
                      type="password"
                      id="password"
                      name="password"
                      value={formData.password}
                      onChange={handleInputChange}
                      required={!editMode}
                      placeholder="Enter password"
                      minLength="8"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="password_confirmation">Confirm Password *</label>
                    <input
                      type="password"
                      id="password_confirmation"
                      name="password_confirmation"
                      value={formData.password_confirmation}
                      onChange={handleInputChange}
                      required={!editMode}
                      placeholder="Confirm password"
                      minLength="8"
                    />
                  </div>
                </div>
              )}

              {!editMode && (
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="role">Role *</label>
                    <select
                      id="role"
                      name="role"
                      value={formData.role}
                      onChange={handleInputChange}
                      required={!editMode}
                    >
                      {allowedRolesToCreate.length === 0 && (
                        <option value="">Tidak ada role yang dapat diberikan</option>
                      )}
                      {allowedRolesToCreate.map((role) => (
                        <option key={role.id || role.name} value={role.name}>
                          {role.displayName || capitalize(role.name)}
                          {role.platform === 'mobile' ? ' (Mobile)' : ''}
                        </option>
                      ))}
                    </select>
                    <small className="role-hint">
                      Anda hanya dapat memberikan role dengan level di bawah role Anda.
                    </small>
                  </div>

                  <div className="form-group">
                  </div>
                </div>
              )}

              {editMode && editingUserRole && (
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="role">Role</label>
                    <select
                      id="role"
                      name="role"
                      value={formData.role}
                      onChange={handleInputChange}
                    >
                      {getEditRoleOptions().map((role) => (
                        <option key={role.id || role.name} value={role.name} disabled={role.locked && role.name !== formData.role}>
                          {role.displayName || capitalize(role.name)}
                          {role.platform === 'mobile' ? ' (Mobile)' : ''}
                        </option>
                      ))}
                    </select>
                    <small className="role-hint">
                      Perubahan role langsung mengubah hak akses user tersebut.
                    </small>
                  </div>

                  <div className="form-group">
                  </div>
                </div>
              )}

              {editMode && (
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="password">New Password {editMode && '(Optional)'}</label>
                    <input
                      type="password"
                      id="password"
                      name="password"
                      value={formData.password}
                      onChange={handleInputChange}
                      placeholder="Leave blank to keep current password"
                      minLength="8"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="password_confirmation">Confirm New Password</label>
                    <input
                      type="password"
                      id="password_confirmation"
                      name="password_confirmation"
                      value={formData.password_confirmation}
                      onChange={handleInputChange}
                      placeholder="Confirm new password"
                      minLength="8"
                    />
                  </div>
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="phoneNumber">Phone Number</label>
                  <input
                    type="tel"
                    id="phoneNumber"
                    name="phoneNumber"
                    value={formData.phoneNumber}
                    onChange={handleInputChange}
                    placeholder="+62 812-3456-7890"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="department">Department</label>
                  <select
                    id="department"
                    name="department"
                    value={formData.department}
                    onChange={handleInputChange}
                  >
                    <option value="">Select Department</option>
                    {departments.map((dept, index) => (
                      <option key={index} value={dept.name}>{dept.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="position">Position</label>
                  <input
                    type="text"
                    id="position"
                    name="position"
                    value={formData.position}
                    onChange={handleInputChange}
                    placeholder="e.g., Field Technician"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="status">Status</label>
                  <select
                    id="status"
                    name="status"
                    value={formData.status}
                    onChange={handleInputChange}
                    disabled={editMode && !can('users.toggle_status')}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="address">Address</label>
                <textarea
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  rows="3"
                  placeholder="Enter full address"
                ></textarea>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={handleCloseModal}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">
                  {editMode ? 'Update User' : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;
