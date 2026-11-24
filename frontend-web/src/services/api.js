import axios from 'axios';
import { toast } from 'react-toastify';
import { clearAuth, setStoredUser } from '../utils/auth';

// API Configuration
// Use environment variable with fallback to production
// const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://c-track-green.vercel.app/api';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://202.169.232.241:8017/api';

// Storage base URL for images (remove /api suffix)
export const STORAGE_BASE_URL = API_BASE_URL.replace('/api', '');

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    // RBAC v2: the backend applies the platform rule (web vs mobile) from this header
    'x-client-type': 'web',
  },
  withCredentials: false, // Don't send cookies, we use Bearer tokens
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ============================================
// ACCESS RESYNC (RBAC v2)
// ============================================

let refreshUserPromise = null;

/**
 * Fetch GET /auth/me and store the fresh user (permissions, role meta) in
 * localStorage. Dispatches the `rbac:changed` window event so menus, routes
 * and <Can> re-render. Concurrent calls share one request.
 * @returns {Promise<Object|null>} Fresh user
 */
export const refreshCurrentUser = () => {
  if (!refreshUserPromise) {
    refreshUserPromise = api
      .get('/auth/me')
      .then((response) => {
        const user = response.data?.user || null;
        if (user) setStoredUser(user);
        return user;
      })
      .finally(() => {
        refreshUserPromise = null;
      });
  }
  return refreshUserPromise;
};

// A 403 from an /admin endpoint usually means our cached permissions are stale.
// Resync at most once per window to avoid request loops.
const FORBIDDEN_RESYNC_WINDOW_MS = 5000;
let lastForbiddenResyncAt = 0;

const handleForbidden = (error) => {
  const url = error.config?.url || '';
  if (!url.includes('/admin/')) return;

  toast.error('Akses ditolak', { toastId: 'rbac-access-denied' });

  const now = Date.now();
  if (now - lastForbiddenResyncAt < FORBIDDEN_RESYNC_WINDOW_MS) return;
  lastForbiddenResyncAt = now;
  refreshCurrentUser().catch(() => { });
};

// Handle response errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Unauthorized - clear auth and redirect to login if not already on login page
      clearAuth();
      if (
        typeof window !== 'undefined' &&
        !window.location.pathname.includes('/login') &&
        !error.config?.url?.includes('/auth/login')
      ) {
        window.location.href = '/login';
      }
    } else if (error.response?.status === 403) {
      handleForbidden(error);
    }
    return Promise.reject(error);
  }
);

// ============================================
// AUTHENTICATION SERVICES
// ============================================

/**
 * Login user
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise} Login response with token and user data
 */
export const login = async (email, password) => {
  const response = await api.post('/auth/login', { email, password });
  if (response.data.token) {
    localStorage.setItem('token', response.data.token);
    // Strip avatar (large base64) from localStorage to avoid bloating headers/storage
    setStoredUser(response.data.user || {});
  }
  return response.data;
};

/**
 * Logout user (current device)
 * @returns {Promise} Logout response
 */
export const logout = async () => {
  try {
    await api.post('/auth/logout');
  } finally {
    clearAuth();
  }
};

/**
 * Logout from all devices
 * @returns {Promise} Logout response
 */
export const logoutAll = async () => {
  try {
    await api.post('/auth/logout-all');
  } finally {
    clearAuth();
  }
};

/**
 * Get current user
 * @returns {Promise} Current user data
 */
export const getCurrentUser = async () => {
  const response = await api.get('/auth/me');
  return response.data;
};

/**
 * Refresh authentication token
 * @returns {Promise} New token
 */
export const refreshToken = async () => {
  const response = await api.post('/auth/refresh-token');
  if (response.data.token) {
    localStorage.setItem('token', response.data.token);
  }
  return response.data;
};

// ============================================
// USER MANAGEMENT SERVICES (Admin)
// ============================================

/** * Create new user (Admin only)
 * @param {Object} userData - New user data (name, email, password, role)
 * @returns {Promise} Created user
 */
export const createUser = async (userData) => {
  const response = await api.post('/admin/users', userData);
  return response.data;
};

/** * Get all users (Admin)
 * @param {Object} filters - Query parameters
 * @returns {Promise} Users list
 */
export const getUsers = async (filters = {}) => {
  const response = await api.get('/admin/users', { params: filters });
  return response.data;
};

/**
 * Get user details
 * @param {string} userId - User ID
 * @returns {Promise} User details
 */
export const getUserDetails = async (userId) => {
  const response = await api.get(`/admin/users/${userId}`);
  return response.data;
};

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {Object} userData - Updated user data
 * @returns {Promise} Updated user
 */
export const updateUserProfile = async (userId, userData) => {
  const response = await api.put(`/profile/${userId}`, userData);
  return response.data;
};

/**
 * Update user status
 * @param {string} userId - User ID
 * @param {string} status - New status (active/inactive)
 * @returns {Promise} Updated user
 */
export const updateUserStatus = async (userId, status) => {
  const response = await api.put(`/admin/users/${userId}/status`, { status });
  return response.data;
};

/**
 * Delete user (Superadmin only)
 * @param {string} userId - User ID
 * @returns {Promise} Delete response
 */
export const deleteUser = async (userId) => {
  const response = await api.delete(`/admin/users/${userId}`);
  return response.data;
};

/**
 * Get departments list
 * @returns {Promise} Departments
 */
export const getDepartments = async () => {
  const response = await api.get('/admin/departments');
  return response.data;
};

// ============================================
// TASK MANAGEMENT SERVICES (Admin)
// ============================================

/**
 * Get all tasks
 * @param {Object} filters - Query parameters
 * @returns {Promise} Tasks list
 */
export const getTasks = async (filters = {}) => {
  const response = await api.get('/admin/tasks', { params: filters });
  return response.data;
};

/**
 * Create new task
 * @param {Object} taskData - Task data
 * @returns {Promise} Created task
 */
export const createTask = async (taskData) => {
  const response = await api.post('/admin/tasks', taskData);
  return response.data;
};

/**
 * Get task details
 * @param {string} taskId - Task ID
 * @returns {Promise} Task details
 */
export const getTaskDetails = async (taskId) => {
  const response = await api.get(`/admin/tasks/${taskId}`);
  return response.data;
};

/**
 * Update task
 * @param {string} taskId - Task ID
 * @param {Object} taskData - Updated task data
 * @returns {Promise} Updated task
 */
export const updateTask = async (taskId, taskData) => {
  const response = await api.put(`/admin/tasks/${taskId}`, taskData);
  return response.data;
};

/**
 * Delete task
 * @param {string} taskId - Task ID
 * @returns {Promise} Delete response
 */
export const deleteTask = async (taskId) => {
  const response = await api.delete(`/admin/tasks/${taskId}`);
  return response.data;
};

/**
 * Assign task to users
 * @param {string} taskId - Task ID
 * @param {Array} userIds - Array of user IDs
 * @param {string} startTime - Start time (ISO format)
 * @param {string} date - Date (Y-m-d)
 * @returns {Promise} Assignment data
 */
export const assignTask = async (taskId, userIds, startTime, date) => {
  const response = await api.post(`/admin/tasks/${taskId}/assign`, {
    userIds: userIds,
    startTime: startTime,
    date: date
  });
  return response.data;
};

/**
 * Get task statistics
 * @returns {Promise} Task statistics
 */
export const getTaskStatistics = async () => {
  const response = await api.get('/admin/tasks/statistics');
  return response.data;
};

/**
 * Get tasks by location
 * @returns {Promise} Tasks grouped by location
 */
export const getTasksByLocation = async () => {
  const response = await api.get('/admin/tasks/by-location');
  return response.data;
};

/**
 * Mark task as completed (admin action after report submitted)
 * @param {string} taskId - Task ID
 * @returns {Promise} Updated task
 */
export const markTaskAsCompleted = async (taskId) => {
  const response = await api.post(`/admin/tasks/${taskId}/mark-completed`);
  return response.data;
};

// ============================================
// BULK UPLOAD TASK SERVICES (Admin)
// ============================================

/**
 * Download task Excel template
 * @returns {Promise} Blob response (Excel file)
 */
export const downloadTaskTemplate = async () => {
  const response = await api.get('/admin/tasks/template', {
    responseType: 'blob',
  });
  return response.data;
};

/**
 * Preview bulk upload - parse & validate Excel without saving
 * @param {File} file - Excel file (.xlsx)
 * @returns {Promise} Preview result with validRows and errors
 */
export const previewBulkUpload = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/admin/tasks/bulk-preview', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

/**
 * Import bulk upload - save validated data to database
 * @param {File} file - Excel file (.xlsx)
 * @returns {Promise} Import result with success/failed counts
 */
export const importBulkUpload = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/admin/tasks/bulk-import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

// ============================================
// TASK ASSIGNMENT SERVICES (Admin)
// ============================================

/**
 * Get all assignments
 * @param {Object} filters - Query parameters
 * @returns {Promise} Assignments list
 */
export const getAssignments = async (filters = {}) => {
  const response = await api.get('/admin/assignments', { params: filters });
  return response.data;
};

/**
 * Create assignment
 * @param {Object} assignmentData - Assignment data
 * @returns {Promise} Created assignment
 */
export const createAssignment = async (assignmentData) => {
  const response = await api.post('/admin/assignments', assignmentData);
  return response.data;
};

/**
 * Get assignment details
 * @param {string} assignmentId - Assignment ID
 * @returns {Promise} Assignment details
 */
export const getAssignmentDetails = async (assignmentId) => {
  const response = await api.get(`/admin/assignments/${assignmentId}`);
  return response.data;
};

/**
 * Update assignment (PUT /admin/assignments/:takenTaskId, needs assignments.update)
 * @param {string} assignmentId - Taken task ID
 * @param {Object} assignmentData - Any of { userIds, teamId, date, startTime }
 * @returns {Promise} { message, takenTask }
 */
export const updateAssignment = async (assignmentId, assignmentData) => {
  const response = await api.put(`/admin/assignments/${assignmentId}`, assignmentData);
  return response.data;
};

/**
 * Cancel assignment
 * @param {string} assignmentId - Assignment ID
 * @returns {Promise} Updated assignment
 */
export const cancelAssignment = async (assignmentId) => {
  const response = await api.put(`/admin/assignments/${assignmentId}/cancel`);
  return response.data;
};

/**
 * Delete assignment
 * @param {string} assignmentId - Assignment ID
 * @returns {Promise} Delete response
 */
export const deleteAssignment = async (assignmentId) => {
  const response = await api.delete(`/admin/assignments/${assignmentId}`);
  return response.data;
};

/**
 * Get user statistics
 * @param {string} userId - User ID
 * @returns {Promise} User statistics
 */
export const getUserStatistics = async (userId) => {
  const response = await api.get(`/admin/users/${userId}/statistics`);
  return response.data;
};

// ============================================
// EMPLOYEE TASK SERVICES
// ============================================

/**
 * Get my tasks (Employee)
 * @param {Object} filters - Query parameters
 * @returns {Promise} My tasks list
 */
export const getMyTasks = async (filters = {}) => {
  const response = await api.get('/my-tasks', { params: filters });
  return response.data;
};

/**
 * Start task (Employee)
 * @param {string} assignmentId - Assignment ID
 * @returns {Promise} Updated assignment
 */
export const startTask = async (assignmentId) => {
  const response = await api.put(`/my-tasks/${assignmentId}/start`);
  return response.data;
};

/**
 * Complete task (Employee)
 * @param {string} assignmentId - Assignment ID
 * @returns {Promise} Updated assignment
 */
export const completeTask = async (assignmentId) => {
  const response = await api.put(`/my-tasks/${assignmentId}/complete`);
  return response.data;
};

// ============================================
// LOCATION TRACKING SERVICES
// ============================================

/**
 * Record single location (Employee)
 * @param {Object} locationData - Location data
 * @returns {Promise} Created location
 */
export const recordLocation = async (locationData) => {
  const response = await api.post('/locations', locationData);
  return response.data;
};

/**
 * Record multiple locations (Employee)
 * @param {Array} locations - Array of location data
 * @returns {Promise} Created locations
 */
export const recordBatchLocations = async (locations) => {
  const response = await api.post('/locations/batch', { locations });
  return response.data;
};

/**
 * Get my location history (Employee)
 * @param {Object} filters - Query parameters
 * @returns {Promise} My locations
 */
export const getMyLocations = async (filters = {}) => {
  const response = await api.get('/locations/my', { params: filters });
  return response.data;
};

/**
 * Get my location statistics (Employee)
 * @param {Object} dateRange - Date range filters
 * @returns {Promise} Location statistics
 */
export const getMyLocationStatistics = async (dateRange = {}) => {
  const response = await api.get('/locations/my/statistics', { params: dateRange });
  return response.data;
};

/**
 * Get task locations (Employee)
 * @param {string} takenTaskId - Taken task ID
 * @returns {Promise} Task locations
 */
export const getTaskLocations = async (takenTaskId) => {
  const response = await api.get(`/locations/tasks/${takenTaskId}`);
  return response.data;
};

/**
 * Get task route (Employee)
 * @param {string} takenTaskId - Taken task ID
 * @returns {Promise} Task route with statistics
 */
export const getTaskRoute = async (takenTaskId) => {
  const response = await api.get(`/locations/tasks/${takenTaskId}/route`);
  return response.data;
};

// ============================================
// ADMIN LOCATION MANAGEMENT SERVICES
// ============================================

/**
 * Get current locations for task (Admin)
 * @param {string} takenTaskId - Taken task ID
 * @returns {Promise} Current locations
 */
export const getCurrentTaskLocations = async (takenTaskId) => {
  const response = await api.get(`/admin/locations/tasks/${takenTaskId}/current`);
  return response.data;
};

/**
 * Get task location statistics (Admin)
 * @param {string} takenTaskId - Taken task ID
 * @returns {Promise} Location statistics
 */
export const getTaskLocationStatistics = async (takenTaskId) => {
  const response = await api.get(`/admin/locations/tasks/${takenTaskId}/statistics`);
  return response.data;
};

/**
 * Get user location statistics (Admin)
 * @param {string} userId - User ID
 * @param {Object} dateRange - Date range filters
 * @returns {Promise} User location statistics
 */
export const getUserLocationStatistics = async (userId, dateRange = {}) => {
  const response = await api.get(`/admin/locations/users/${userId}/statistics`, { params: dateRange });
  return response.data;
};

/**
 * Find nearby locations (Admin)
 * @param {Object} params - Search parameters (latitude, longitude, radius, etc.)
 * @returns {Promise} Nearby locations
 */
export const findNearbyLocations = async (params) => {
  const response = await api.get('/admin/locations/nearby', { params });
  return response.data;
};

/**
 * Get latest locations for all active users (Admin)
 * @returns {Promise} Latest locations with user and task data
 */
export const getLatestLocations = async () => {
  const response = await api.get('/admin/locations/latest');
  return response.data;
};

/**
 * Get all locations (Admin)
 * @param {Object} filters - Filter parameters (limit, userId, takenTaskId, startDate, endDate)
 * @returns {Promise} All locations
 */
export const getAllLocations = async (filters = {}) => {
  const response = await api.get('/admin/locations/all', { params: filters });
  return response.data;
};

/**
 * Get all locations grouped by task+user — paginated, used by Analytics
 * Falls back to /admin/locations/all with a high limit.
 * @param {number} limit - Max records to retrieve (default 5000)
 * @returns {Promise} Locations list
 */
export const getLocationsForAnalytics = async (limit = 5000) => {
  const response = await api.get('/admin/locations/all', { params: { limit } });
  return response.data;
};

/**
 * Delete location record (Admin)
 * @param {string} locationId - Location ID
 * @returns {Promise} Delete response
 */
export const deleteLocation = async (locationId) => {
  const response = await api.delete(`/admin/locations/${locationId}`);
  return response.data;
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Test API connection
 * @returns {Promise} Connection test response
 */
export const testConnection = async () => {
  const response = await api.get('/test');
  return response.data;
};

/**
 * Ask backend AI copilot (Admin/Superadmin)
 * @param {Object} payload - { question, userId?, month?, date?, startDate?, endDate?, conversation? }
 * @returns {Promise} AI response with answer + source + ragContext
 */
export const askAIAgent = async (payload) => {
  const response = await api.post('/ai/agent', payload);
  return response.data;
};

/**
 * Get AI model limits and daily usage snapshot (Admin/Superadmin)
 * @returns {Promise} Model limits response
 */
export const getAIModelLimits = async () => {
  const response = await api.get('/ai/model-limits');
  return response.data;
};

/**
 * Get AI usage stats (Admin/Superadmin)
 * @returns {Promise} Usage stats response
 */
export const getAIUsageStats = async () => {
  const response = await api.get('/ai/usage-stats');
  return response.data;
};

/**
 * Get stored token
 * @returns {string|null} Stored token
 */
export const getToken = () => {
  return localStorage.getItem('token');
};

/**
 * Get stored user
 * @returns {Object|null} Stored user object
 */
export const getStoredUser = () => {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
};

/**
 * Check if user is authenticated
 * @returns {boolean} Authentication status
 */
export const isAuthenticated = () => {
  return !!getToken();
};

// ============================================
// REPORT SERVICES
// ============================================

/**
 * Get all reports (Admin only)
 * @param {Object} filters - Query parameters (userId, takenTaskId, date, etc.)
 * @returns {Promise} Reports list
 */
export const getReports = async (filters = {}) => {
  const response = await api.get('/admin/reports', { params: filters });
  return response.data;
};

/**
 * Get reports for a specific task
 * @param {string|number} taskId - Task ID
 * @returns {Promise} Reports for the task
 */
export const getReportsByTask = async (taskId) => {
  const response = await api.get(`/admin/reports/tasks/${taskId}`);
  return response.data;
};

/**
 * Get reports for a specific taken task (assignment)
 * @param {string|number} takenTaskId - Taken Task ID
 * @returns {Promise} Reports for the taken task
 */
export const getReportsByTakenTask = async (takenTaskId) => {
  const response = await api.get(`/admin/reports/tasks/${takenTaskId}`);
  return response.data;
};

/**
 * Get my reports (Employee)
 * @returns {Promise} User's own reports
 */
export const getMyReports = async () => {
  const response = await api.get('/reports/my');
  return response.data;
};

// ============================================
// LOCATION SERVICES
// ============================================

/**
 * Get current locations for a specific taken task (latest location per user - for map)
 * @param {string|number} takenTaskId - Taken Task ID
 * @returns {Promise} Current locations for the taken task
 */
export const getCurrentLocationsByTakenTask = async (takenTaskId) => { 
  const response = await api.get(`/admin/locations/tasks/${takenTaskId}/current`);
  return response.data;
};

/**
 * Get all locations for a specific taken task (with optional userId filter - for history)
 * @param {string|number} takenTaskId - Taken Task ID
 * @param {string} userId - Optional User ID to filter locations
 * @param {number} limit - Optional limit for number of results
 * @returns {Promise} All locations for the taken task
 */
export const getLocationsByTakenTask = async (takenTaskId, userId = null, limit = null) => {
  const params = {};
  if (userId) params.userId = userId;
  if (limit) params.limit = limit;
  
  const response = await api.get(`/admin/locations/tasks/${takenTaskId}`, { params });
  return response.data;
};

// ============================================
// USER AVATAR SERVICES (with caching)
// ============================================

// In-memory cache for avatars (to avoid repeated API calls)
const avatarCache = new Map();

/**
 * Get user avatar with caching
 * @param {string} userId - User ID
 * @param {boolean} forceRefresh - Force refresh from server
 * @returns {Promise<string|null>} Avatar base64 data or null
 */
// Normalize raw base64 (no prefix) to a proper data URI so it's safe as <img src>
const toDataUri = (raw) => {
  if (!raw) return null;
  if (raw.startsWith('data:')) return raw;
  return `data:image/jpeg;base64,${raw}`;
};

export const getUserAvatar = async (userId, forceRefresh = false) => {
  // Check cache first
  if (!forceRefresh && avatarCache.has(userId)) {
    return avatarCache.get(userId);
  }

  try {
    const response = await api.get(`/admin/users/${userId}/avatar`);
    const avatar = toDataUri(response.data.avatar);
    
    // Cache the avatar
    avatarCache.set(userId, avatar);
    
    return avatar;
  } catch (error) {
    console.warn(`Failed to load avatar for user ${userId}:`, error);
    return null;
  }
};

/**
 * Upload or update user avatar (base64 data URI)
 * @param {string} userId - User ID
 * @param {string} avatarBase64 - Base64 data URI string
 * @returns {Promise} Updated user data
 */
export const uploadAvatar = async (userId, avatarBase64) => {
  const avatarSizeKB = Math.ceil(avatarBase64.length / 1024);
  console.log(`🚀 Uploading avatar for user ${userId}`);
  console.log(`📤 Payload size: ${avatarSizeKB}KB`);
  console.log(`🔗 Endpoint: POST /api/admin/users/${userId}/avatar`);
  
  try {
    const response = await api.post(`/admin/users/${userId}/avatar`, { avatar: avatarBase64 });
    console.log(`✅ Avatar uploaded successfully - server returned:`, response.data);
    // Invalidate cached entry so next fetch gets fresh data
    avatarCache.delete(userId);
    return response.data;
  } catch (error) {
    console.error(`❌ Avatar upload failed!`);
    console.error(`   Status: ${error.response?.status}`);
    console.error(`   Error: ${error.response?.statusText}`);
    console.error(`   Message: ${error.response?.data?.message || error.message}`);
    console.error(`   Payload size was: ${avatarSizeKB}KB`);
    if (error.response?.status === 413) {
      console.error(`   💡 Hint: 413 Request Entity Too Large - check nginx client_max_body_size config!`);
    }
    throw error;
  }
};

/**
 * Preload avatars for multiple users (batch loading)
 * @param {Array<string>} userIds - Array of user IDs
 * @returns {Promise<Map<string, string>>} Map of userId to avatar
 */
export const preloadAvatars = async (userIds) => {
  const promises = userIds.map(userId => 
    getUserAvatar(userId).catch(() => null)
  );
  
  await Promise.all(promises);
  return avatarCache;
};

// ============================================
// TEAM MANAGEMENT SERVICES (Admin)
// ============================================

/**
 * Get all teams (leader info + members preview + counts)
 * @param {Object} filters - Query parameters (unused server-side; filtering is client-side)
 * @returns {Promise} Teams list
 */
export const getTeams = async (filters = {}) => {
  const response = await api.get('/admin/teams', { params: filters });
  return response.data;
};

/**
 * Get a single team with full member list
 * @param {string} teamId - Team ID
 * @returns {Promise} Team details
 */
export const getTeam = async (teamId) => {
  const response = await api.get(`/admin/teams/${teamId}`);
  return response.data;
};

/**
 * Create a team
 * @param {Object} data - { name, description, leaderId, memberIds, status }
 * @returns {Promise} Created team
 */
export const createTeam = async (data) => {
  const response = await api.post('/admin/teams', data);
  return response.data;
};

/**
 * Update team metadata (name, description, leaderId, status)
 * @param {string} teamId - Team ID
 * @param {Object} data - { name, description, leaderId, status }
 * @returns {Promise} Updated team
 */
export const updateTeam = async (teamId, data) => {
  const response = await api.put(`/admin/teams/${teamId}`, data);
  return response.data;
};

/**
 * Delete a team (members' teamId reset to null)
 * @param {string} teamId - Team ID
 * @returns {Promise} Delete response
 */
export const deleteTeam = async (teamId) => {
  const response = await api.delete(`/admin/teams/${teamId}`);
  return response.data;
};

/**
 * Get team members
 * @param {string} teamId - Team ID
 * @returns {Promise} Members list
 */
export const getTeamMembers = async (teamId) => {
  const response = await api.get(`/admin/teams/${teamId}/members`);
  return response.data;
};

/**
 * Add members to a team
 * @param {string} teamId - Team ID
 * @param {Array<string>} userIds - User IDs to add
 * @returns {Promise} Updated members
 */
export const addTeamMembers = async (teamId, userIds) => {
  const response = await api.post(`/admin/teams/${teamId}/members`, { userIds });
  return response.data;
};

/**
 * Remove a member from a team (does NOT touch leaderId)
 * @param {string} teamId - Team ID
 * @param {string} userId - User ID to remove
 * @returns {Promise} Remove response
 */
export const removeTeamMember = async (teamId, userId) => {
  const response = await api.delete(`/admin/teams/${teamId}/members/${userId}`);
  return response.data;
};

// ============================================
// ROLES & PERMISSIONS SERVICES (RBAC v2)
// ============================================

/**
 * Permission catalog grouped by module (roles.manage)
 * @returns {Promise} { modules: [{ module, label, permissions: [...] }] }
 */
export const getPermissionCatalog = async () => {
  const response = await api.get('/admin/permissions');
  return response.data;
};

/**
 * List roles (roles.manage)
 * @param {Object} params - { includeMobile?: boolean }
 * @returns {Promise} { data: Role[] }
 */
export const getRoles = async (params = {}) => {
  const response = await api.get('/admin/roles', { params });
  return response.data;
};

/**
 * Role detail including members (roles.manage)
 * @param {string} roleId - Role ID
 * @returns {Promise} { data: Role & { users } }
 */
export const getRole = async (roleId) => {
  const response = await api.get(`/admin/roles/${roleId}`);
  return response.data;
};

/**
 * Create role (roles.manage)
 * @param {Object} data - { name, displayName, description, level, color, showTaskBadge, permissions, copyFromRoleId }
 * @returns {Promise} { data: Role, meta: { autoAdded } }
 */
export const createRole = async (data) => {
  const response = await api.post('/admin/roles', data);
  return response.data;
};

/**
 * Update role details (roles.manage)
 * @param {string} roleId - Role ID
 * @param {Object} data - Partial { displayName, description, level, color, showTaskBadge, name }
 * @returns {Promise} { data: Role }
 */
export const updateRole = async (roleId, data) => {
  const response = await api.put(`/admin/roles/${roleId}`, data);
  return response.data;
};

/**
 * Replace the permission set of a role (roles.manage)
 * @param {string} roleId - Role ID
 * @param {string[]} permissions - Full set of permission keys
 * @returns {Promise} { data: Role, meta: { added, removed, autoAdded } }
 */
export const updateRolePermissions = async (roleId, permissions) => {
  const response = await api.put(`/admin/roles/${roleId}/permissions`, { permissions });
  return response.data;
};

/**
 * Delete role (roles.manage). 409 { message, userCount } when users are still assigned.
 * @param {string} roleId - Role ID
 * @returns {Promise}
 */
export const deleteRole = async (roleId) => {
  const response = await api.delete(`/admin/roles/${roleId}`);
  return response.data;
};

/**
 * Move every member of a role to another role (roles.manage)
 * @param {string} roleId - Source role ID
 * @param {string} toRoleId - Target role ID
 * @returns {Promise} { moved }
 */
export const reassignRole = async (roleId, toRoleId) => {
  const response = await api.post(`/admin/roles/${roleId}/reassign`, { toRoleId });
  return response.data;
};

/**
 * Roles the current user may assign (users.create or users.update)
 * @returns {Promise} { data: [{ id, name, displayName, platform, color, level }] }
 */
export const getAssignableRoles = async () => {
  const response = await api.get('/admin/roles/assignable');
  return response.data;
};

/**
 * RBAC audit log (roles.manage)
 * @param {string} roleId - Optional role ID filter
 * @returns {Promise} { data: AuditEntry[] }
 */
export const getRoleAudit = async (roleId) => {
  const response = await api.get('/admin/roles/audit', { params: roleId ? { roleId } : {} });
  return response.data;
};

/**
 * Clear avatar cache
 */
export const clearAvatarCache = () => {
  avatarCache.clear();
};

// ============================================
// GEOCODING SERVICES
// ============================================

/**
 * Reverse geocode coordinates to get address
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {Promise} Address data
 */
export const reverseGeocode = async (latitude, longitude) => {
  try {
    const response = await api.get('/geocoding/reverse', {
      params: { lat: latitude, lon: longitude }
    });
    return response.data;
  } catch (error) {
    console.error('Error reverse geocoding:', error);
    throw new Error(error.response?.data?.message || 'Failed to reverse geocode');
  }
};

/**
 * Extract coordinates from Google Maps link
 * @param {string} mapsLink - Google Maps URL
 * @returns {Promise} Coordinates data
 */
export const extractCoordinatesFromMapsLink = async (mapsLink) => {
  try {
    const response = await api.post('/geocoding/extract-coordinates', {
      mapsLink: mapsLink
    });
    return response.data;
  } catch (error) {
    console.error('Error extracting coordinates:', error);
    throw new Error(error.response?.data?.message || 'Failed to extract coordinates');
  }
};

export default api;
