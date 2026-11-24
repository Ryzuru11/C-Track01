import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '@/config/api.config';
import {
  AuthResponse,
  CurrentUserResponse,
  AuthMessageResponse,
  RefreshTokenResponse,
  LoginRequest,
  RegisterRequest,
  GetMyTasksResponse,
  StartTaskResponse,
  CompleteTaskResponse,
  RecordLocationResponse,
  RecordBatchLocationsResponse,
  BatchLocationRequest,
  GetMyLocationsResponse,
  GetTaskLocationsResponse,
  GetRouteResponse,
  LocationStatisticsResponse,
  UserProfile,
} from '@/types';

/**
 * API Service for TrackingApp Mobile
 * 
 * This service connects to the Express.js backend (backend-express)
 * Default Port: 5000
 * 
 * API Structure:
 * - /api/auth/*              - Authentication endpoints
 * - /api/my-tasks/*          - Employee task management
 * - /api/locations/*         - Location tracking
 * - /api/reports/*           - Reports management
 * - /api/profile/*           - User profile
 * - /api/admin/*            - Admin endpoints (not used by mobile app)
 * 
 * Note: All field names use camelCase (Express convention)
 */

// Log the API base URL for debugging
console.log('API_BASE_URL:', API_BASE_URL);
console.log('Backend: Express.js on port 5000');

export interface CapturedReportPhoto {
  image: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
  mocked: boolean;
}

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Client-Type': 'mobile',
  },
  timeout: 30000,
});

// Add token to requests
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (token) {
        console.log(`📤 Attaching token to request: ${config.url}`);
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        console.warn(`⚠️ No token found for request: ${config.url}`);
      }
    } catch (error) {
      console.error('Error getting token from storage:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle responses
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    // Log detailed error information
    console.log('=== API Error ===');
    console.log('Error message:', error.message);
    console.log('Error code:', error.code);
    console.log('Response status:', error.response?.status);
    console.log('Response data:', error.response?.data);
    console.log('Request URL:', error.config?.url);
    console.log('Request baseURL:', error.config?.baseURL);
    console.log('=================');

    if (error.response?.status === 401) {
      // Token expired or invalid
      // IMPORTANT: Only clear auth credentials — do NOT remove 'user', 'pushToken',
      // or any session/tracking keys. The background location task uses 'user.id'
      // (via getActiveSessionKey) to find the active tracking session. Removing 'user'
      // would permanently break background tracking until the user logs in again.
      console.error('🔐 Got 401 Unauthorized - clearing token only (user data preserved for background task)');
      try {
        await AsyncStorage.removeItem('userToken');
        await AsyncStorage.removeItem('userEmail');
      } catch (e) {
        console.error('Error clearing storage:', e);
      }
      const customError = new Error('Invalid token');
      (customError as any).code = 'INVALID_TOKEN';
      // Keep the server response so callers can show its message
      // (e.g. login: "Invalid credentials" instead of a generic "Login failed").
      (customError as any).response = error.response;
      return Promise.reject(customError);
    }
    return Promise.reject(error);
  }
);

// Auth API calls (Express Backend)
export const authAPI = {
  // Login with email and password
  login: async (email: string, password: string, timeout?: number): Promise<AuthResponse> => {
    try {
      const response = await api.post<AuthResponse>('/auth/login', {
        email,
        password,
      }, timeout ? { timeout } : undefined);

      // Save token and user data
      if (response.data.token) {
        console.log('✅ Login successful - saving token to storage');
        await AsyncStorage.setItem('userToken', response.data.token);
        await AsyncStorage.setItem('userEmail', email);
        if (response.data.user) {
          await AsyncStorage.setItem('user', JSON.stringify(response.data.user));
        }
        console.log('✅ Token and user data saved to AsyncStorage');
      } else {
        console.error('❌ Login response missing token:', response.data);
        throw new Error('Login failed: no token in response');
      }

      return response.data;
    } catch (error: any) {
      console.log('=== Login Error Details ===');
      console.log('Error type:', error.constructor.name);
      console.log('Error message:', error.message);
      console.log('Error code:', error.code); // ECONNREFUSED, ECONNABORTED, etc
      console.log('Response:', error.response);
      console.log('Request:', error.request);
      console.log('===========================');

      // Provide more detailed error messages
      let errorMessage = 'Login failed. Please try again.';

      if (error.code === 'ECONNREFUSED') {
        errorMessage = `Cannot connect to server at ${API_BASE_URL}. Make sure backend Express is running (npm run dev on port 5000).`;
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Connection timeout. Server is not responding (check if backend Express is running on port 5000).';
      } else if (error.message === 'Network Error') {
        errorMessage = `Network Error: Cannot reach ${API_BASE_URL}. Check:\n1. Backend Express is running (npm run dev)\n2. IP address is correct\n3. Device and server are on same network\n4. Server is running on port 5000`;
      } else if (error.response?.status === 422 || error.response?.status === 400) {
        errorMessage = error.response?.data?.message || 'Validation error';
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }

      throw new Error(errorMessage);
    }
  },

  // Get current user
  getCurrentUser: async (): Promise<CurrentUserResponse> => {
    try {
      const response = await api.get<CurrentUserResponse>('/auth/me');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch user');
    }
  },

  // Logout
  logout: async (): Promise<AuthMessageResponse> => {
    try {
      const response = await api.post<AuthMessageResponse>('/auth/logout');
      await AsyncStorage.removeItem('userToken');
      await AsyncStorage.removeItem('userEmail');
      await AsyncStorage.removeItem('user');
      return response.data;
    } catch (error: any) {
      // Clear local storage even if API call fails
      await AsyncStorage.removeItem('userToken');
      await AsyncStorage.removeItem('userEmail');
      await AsyncStorage.removeItem('user');
      throw new Error(error.response?.data?.message || 'Logout failed');
    }
  },

  // Refresh token
  refreshToken: async (): Promise<RefreshTokenResponse> => {
    try {
      const response = await api.post<RefreshTokenResponse>('/auth/refresh-token');
      if (response.data.token) {
        await AsyncStorage.setItem('userToken', response.data.token);
      }
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to refresh token');
    }
  },


  // Register push notification token
  registerPushToken: async (pushToken: string): Promise<any> => {
    try {
      const response = await api.post('/auth/register-push-token', {
        pushToken,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to register push token');
    }
  },
};

// Employee Tasks API calls (Express Backend - /my-tasks endpoints)
export const tasksAPI = {
  // Get my tasks
  getMyTasks: async (
    status?: string,
    date?: string
  ): Promise<GetMyTasksResponse> => {
    try {
      const params: any = {};
      if (status) params.status = status;
      if (date) params.date = date;

      const response = await api.get<GetMyTasksResponse>('/my-tasks', { params });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch tasks');
    }
  },

  // Start task - Update status to 'in_progress'
  startTask: async (assignmentId: string): Promise<StartTaskResponse> => {
    try {
      const response = await api.patch<StartTaskResponse>(
        `/my-tasks/${assignmentId}/status`,
        { status: 'in_progress' }
      );
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to start task');
    }
  },

  // Start tracking - triggered when swipeable button is activated
  // Updates user status to in_progress and starts location tracking
  startTracking: async (takenTaskId: string): Promise<StartTaskResponse> => {
    try {
      const response = await api.patch<StartTaskResponse>(
        `/my-tasks/${takenTaskId}/start`,
        {} // No body needed, userId taken from JWT token
      );
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to start tracking');
    }
  },

  // Complete task - Update status to 'completed'
  completeTask: async (assignmentId: string): Promise<CompleteTaskResponse> => {
    try {
      const response = await api.patch<CompleteTaskResponse>(
        `/my-tasks/${assignmentId}/status`,
        { status: 'completed' }
      );
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to complete task');
    }
  },

  // Get my task statistics
  getMyStatistics: async (): Promise<any> => {
    try {
      const response = await api.get('/my-tasks/statistics');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch task statistics');
    }
  },

  // Get task assignment details with team members
  getTakenTaskDetail: async (takenTaskId: string): Promise<any> => {
    try {
      const response = await api.get(`/my-tasks/${takenTaskId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch task assignment');
    }
  },
};

// Location Tracking API calls (Express Backend - /locations endpoints)
export const locationsAPI = {
  // Record single location — address resolved on device via reverseGeocodeAsync
  // Supports both GPS locations and heartbeat records (activity signals when GPS unavailable)
  recordLocation: async (
    takenTaskId: string,
    latitude: number | null | undefined,
    longitude: number | null | undefined,
    accuracy?: number,
    address?: string,
    recordedAt?: number, // device timestamp (ms) — preserves actual capture time after queue/kill
    locationId?: string, // client-generated UUID — enables server-side idempotency
    recordType?: 'location' | 'heartbeat', // 'location' for GPS data, 'heartbeat' for activity signal
  ): Promise<RecordLocationResponse> => {
    try {
      // Token is injected automatically by the request interceptor; no need to read it here.
      const response = await api.post<RecordLocationResponse>('/locations', {
        id: locationId, // server uses this UUID for upsert — same ID = no duplicate row
        takenTaskId,
        latitude: latitude ?? null, // explicit null for heartbeat records
        longitude: longitude ?? null, // explicit null for heartbeat records
        accuracy: accuracy || 0,
        address,
        trackingStatus: 'auto',
        recordedAt, // let server use actual capture time (backend: recordedAt ? new Date(recordedAt) : new Date())
        recordType: recordType || 'location', // marker field: 'location' or 'heartbeat'
      });
      return response.data;
    } catch (error: any) {
      console.error('recordLocation error:', {
        message: error.message,
        response: error.response?.data
      });
      // Keep the HTTP response on the thrown error: the upload worker reads
      // error.response.status to tell permanent (4xx) from transient failures.
      const wrapped: any = new Error(error.response?.data?.message || error.message || 'Failed to record location');
      wrapped.response = error.response;
      wrapped.code = error.code;
      throw wrapped;
    }
  },

  // Record multiple locations in batch (idempotent - uses UUID)
  recordBatchLocations: async (
    locations: BatchLocationRequest[]
  ): Promise<RecordBatchLocationsResponse> => {
    try {
      // Minimal payload - no transformation needed, send as-is
      // Backend expects: id, takenTaskId, userId, latitude, longitude, accuracy, recordedAt
      const response = await api.post<RecordBatchLocationsResponse>(
        '/locations/bulk',
        locations // Send raw array
      );
      return response.data;
    } catch (error: any) {
      console.error('Batch location error:', {
        message: error.message,
        response: error.response?.data
      });
      throw new Error(error.response?.data?.message || error.message || 'Failed to record batch locations');
    }
  },

  // Get my locations (TODO: implement on backend)
  getMyLocations: async (page = 1, perPage = 50): Promise<GetMyLocationsResponse> => {
    try {
      const response = await api.get<GetMyLocationsResponse>('/locations/my', {
        params: {
          page,
          perPage, // Express uses camelCase
        },
      });
      return response.data;
    } catch (error: any) {
      console.warn('My locations endpoint not implemented:', error.message);
      return {
        data: [],
        current_page: page,
        per_page: perPage,
        total: 0,
        last_page: 1,
      };
    }
  },

  // Get locations for a task
  getTaskLocations: async (
    takenTaskId: string,
    userId?: string
  ): Promise<GetTaskLocationsResponse> => {
    try {
      const params: any = {};
      if (userId) params.userId = userId; // Express uses camelCase

      const response = await api.get<GetTaskLocationsResponse>(
        `/locations/tasks/${takenTaskId}`,
        { params }
      );
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || 'Failed to fetch task locations'
      );
    }
  },

  // Get route for a task (TODO: implement on backend)
  getTaskRoute: async (takenTaskId: string, userId?: string): Promise<GetRouteResponse> => {
    try {
      const params: any = {};
      if (userId) params.userId = userId; // Express uses camelCase

      const response = await api.get<GetRouteResponse>(
        `/locations/tasks/${takenTaskId}/route`,
        { params }
      );
      return response.data;
    } catch (error: any) {
      console.warn('Route endpoint not implemented:', error.message);
      // Return empty route if not implemented - matching GetRouteResponse structure
      return {
        route: [],
        statistics: {
          total_points: 0,
          duration_hours: 0,
          start_time: new Date().toISOString(),
          end_time: new Date().toISOString(),
          distance_km: 0,
        },
      };
    }
  },

  // Get location statistics (TODO: implement on backend)
  getLocationStatistics: async (
    startDate?: string,
    endDate?: string
  ): Promise<LocationStatisticsResponse> => {
    try {
      const params: any = {};
      if (startDate) params.startDate = startDate; // Express uses camelCase
      if (endDate) params.endDate = endDate; // Express uses camelCase

      const response = await api.get<LocationStatisticsResponse>(
        '/locations/my/statistics',
        { params }
      );
      return response.data;
    } catch (error: any) {
      console.warn('Statistics endpoint not implemented:', error.message);
      return {
        statistics: {
          total_locations: 0,
          total_tasks: 0,
          auto_tracked: 0,
          manual_tracked: 0,
          average_accuracy: 0,
        },
      };
    }
  },
};

// User Profile API calls (Express Backend - /profile endpoints)
export const profileAPI = {
  // Get current user profile
  getProfile: async (): Promise<CurrentUserResponse> => {
    try {
      const response = await api.get<CurrentUserResponse>('/auth/me');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch profile');
    }
  },

  // Update profile
  updateProfile: async (
    userId: string,
    name?: string,
    phoneNumber?: string,
    department?: string,
    position?: string,
    address?: string
  ): Promise<CurrentUserResponse> => {
    try {
      const data: any = {};
      if (name) data.name = name;
      if (phoneNumber) data.phoneNumber = phoneNumber; // Express uses camelCase
      if (department) data.department = department;
      if (position) data.position = position;
      if (address) data.address = address;

      const response = await api.put<CurrentUserResponse>(`/profile/${userId}`, data);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to update profile');
    }
  },

  // Change password
  changePassword: async (
    currentPassword: string,
    newPassword: string
  ): Promise<{ message: string }> => {
    try {
      const response = await api.post<{ message: string }>('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Gagal mengganti password');
    }
  },

  // Upload profile avatar
  uploadAvatar: async (
    userId: string,
    avatarBase64: string
  ): Promise<CurrentUserResponse> => {
    try {
      const response = await api.post<CurrentUserResponse>(
        `/profile/${userId}/avatar`,
        { avatar: avatarBase64 }
      );
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to upload avatar');
    }
  },
};

// Report API calls (Express Backend - /reports endpoints)
export const reportsAPI = {
  // Create a new report
  createReport: async (
    takenTaskId: string,
    report: string,
    photos: CapturedReportPhoto[]
  ): Promise<any> => {
    try {
      const response = await api.post('/reports', {
        takenTaskId, // Express uses camelCase
        report: report,
        photos: photos, // Array of base64 encoded images
      });
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || 'Failed to create report'
      );
    }
  },

  // Get my reports
  getMyReports: async (
    startDate?: string,
    endDate?: string,
    page: number = 1,
    perPage: number = 15
  ): Promise<any> => {
    try {
      const params: any = { page, perPage }; // Express uses camelCase
      if (startDate) params.startDate = startDate; // Express uses camelCase
      if (endDate) params.endDate = endDate; // Express uses camelCase

      const response = await api.get('/reports/my', { params });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch reports');
    }
  },

  // Get reports for a specific task
  getTaskReports: async (takenTaskId: string): Promise<any> => {
    try {
      const response = await api.get('/reports/my', {
        params: { takenTaskId }
      });
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || 'Failed to fetch task reports'
      );
    }
  },

  // Get report details
  getReportDetails: async (reportId: string): Promise<any> => {
    try {
      const response = await api.get(`/reports/${reportId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || 'Failed to fetch report details'
      );
    }
  },

  // Update report with text and photos
  updateReport: async (
    reportId: string,
    report: string,
    photos?: CapturedReportPhoto[],
    removePhotos?: string[]
  ): Promise<any> => {
    try {
      const data: any = { report };
      if (photos && photos.length > 0) {
        data.photos = photos;
      }
      if (removePhotos && removePhotos.length > 0) {
        data.removePhotos = removePhotos;
      }

      const response = await api.put(`/reports/${reportId}`, data);
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || 'Failed to update report'
      );
    }
  },

  // Get my report statistics
  getMyStatistics: async (): Promise<any> => {
    try {
      const response = await api.get('/reports/statistics/my');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch report statistics');
    }
  },

  // Get my tasks with reports (grouped by taken task)
  getMyTasksWithReports: async (): Promise<any> => {
    try {
      const response = await api.get('/reports/my-tasks');
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch tasks with reports');
    }
  },

  // Get reports for a specific taken task
  getReportsForTakenTask: async (takenTaskId: string): Promise<any> => {
    try {
      const response = await api.get(`/reports/tasks/${takenTaskId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch task reports');
    }
  },
};

// ============================================
// USER AVATAR SERVICES (with caching)
// ============================================

const avatarCache = new Map<string, string | null>();

const toDataUri = (raw: string | null): string | null => {
  if (!raw) return null;
  if (raw.startsWith('data:')) return raw;
  return `data:image/jpeg;base64,${raw}`;
};

export const getUserAvatar = async (userId: string, forceRefresh = false): Promise<string | null> => {
  if (!forceRefresh && avatarCache.has(userId)) {
    return avatarCache.get(userId) || null;
  }

  try {
    // Assuming backend endpoint is /admin/users/:userId/avatar (like web) 
    // or we can use the same path if the role allows it
    const response = await api.get(`/admin/users/${userId}/avatar`);
    const avatar = toDataUri(response.data.avatar);
    avatarCache.set(userId, avatar);
    return avatar;
  } catch (error) {
    console.warn(`Failed to load avatar for user ${userId}:`, error);
    avatarCache.set(userId, null);
    return null;
  }
};

export default api;
