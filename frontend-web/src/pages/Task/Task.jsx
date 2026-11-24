import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import './Task.css';
import { getTasks, createTask, updateTask, deleteTask, getTaskDetails, extractCoordinatesFromMapsLink, reverseGeocode, downloadTaskTemplate } from '../../services/api';
import ResponsiveTable from '../../components/ResponsiveTable/ResponsiveTable';
import BulkUploadModal from '../../components/BulkUploadModal/BulkUploadModal';
import Can from '../../components/Can';
import TaskCreatorBadge from '../../components/TaskCreatorBadge';
import useAccess from '../../hooks/useAccess';

// Fix default Leaflet marker icons (Vite bundler issue)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Red circular pin icon - simple round marker matching cursor
const taskPinIcon = L.divIcon({
  className: 'custom-map-marker',
  html: `
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
      <!-- Outer white border -->
      <circle cx="12" cy="12" r="11" fill="#fff"/>
      <!-- Red fill -->
      <circle cx="12" cy="12" r="9" fill="#EA4335"/>
      <!-- Center white dot -->
      <circle cx="12" cy="12" r="3" fill="#fff"/>
    </svg>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],  // Center of circle
  popupAnchor: [0, -12],
});

// Inner component that captures map click events
function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng) });
  return null;
}

// Inner component that flies the map to a target coordinate
function MapFlyToController({ target, mapRef }) {
  useEffect(() => {
    if (!target || !mapRef || !mapRef.current) {
      console.warn('FlyTo skipped - missing conditions:', {
        hasTarget: !!target,
        hasMapRef: !!mapRef,
        hasMapRefCurrent: !!(mapRef && mapRef.current)
      });
      return;
    }

    try {
      const map = mapRef.current;
      console.log('FlyTo triggered:', target);
      console.log('Map instance available:', !!map);
      console.log('Map _leaflet_id:', map._leaflet_id);

      // Ensure coordinates are numbers
      const lat = parseFloat(target.lat);
      const lng = parseFloat(target.lng);

      if (isNaN(lat) || isNaN(lng)) {
        console.error('Invalid coordinates for flyTo:', { lat, lng });
        return;
      }

      console.log('Executing flyTo with:', [lat, lng], 'zoom: 16');
      map.flyTo([lat, lng], 16, {
        duration: 1.2,
        animate: true,
        noMoveStart: false
      });
      console.log('FlyTo animation started');
    } catch (error) {
      console.error('Map flyTo error:', error.message);
      console.error('Error stack:', error.stack);
    }
  }, [target, mapRef]);

  return null;
}

// Unique creator roles (with the task badge switched on) found in a task list
const collectCreatorRoles = (taskList, previous = []) => {
  const byName = new Map(previous.map((role) => [role.name, role]));
  taskList.forEach((task) => {
    const role = task.createdByRole;
    if (role?.showBadge && role.name) byName.set(role.name, role);
  });
  return Array.from(byName.values()).sort((a, b) =>
    (a.displayName || a.name).localeCompare(b.displayName || b.name)
  );
};

function Task() {
  const { can } = useAccess();
  const [showModal, setShowModal] = useState(false);
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTask, setEditingTask] = useState(null); // detail of the task being edited
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    location: '',
    createdByRole: ''
  });
  const [creatorRoleOptions, setCreatorRoleOptions] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 6;
  const [toast, setToast] = useState({ show: false, message: '', type: '' });
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null, type: 'delete' });
  const [taskCounts, setTaskCounts] = useState({ total: 0, active: 0, inactive: 0 });

  // Map picker state
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapPickerOpenLoading, setMapPickerOpenLoading] = useState(false); // loading on pin button
  const [mapsLinkLoading, setMapsLinkLoading] = useState(false); // loading on extract from maps link button
  const [pinnedPosition, setPinnedPosition] = useState(null); // { lat, lng }
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const mapRef = useRef(null); // Reference to map instance
  const isInitialMount = useRef(true);
  const [mapFlyTarget, setMapFlyTarget] = useState(null);
  const hasInitiatedLoad = useRef(false); // Prevent double loading in StrictMode

  // Separate state for Google Maps link (not saved to DB)
  const [mapsLink, setMapsLink] = useState('');

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    latitude: '',
    longitude: '',
    start_time: '08:00',
    end_time: '17:00',
    status: 'active'
  });

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

  // Bulk Upload handlers
  const handleOpenBulkUpload = () => {
    setShowBulkUploadModal(true);
  };

  const handleBulkUploadComplete = () => {
    loadTasks(); // Refresh task list after import
  };

  const handleDownloadTemplateClick = async () => {
    try {
      const blob = await downloadTaskTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'task_template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast('Template berhasil diunduh!', 'success');
    } catch (error) {
      console.error('Error downloading template:', error);
      showToast('Gagal mengunduh template.', 'error');
    }
  };

  // Load tasks on component mount
  useEffect(() => {
    if (hasInitiatedLoad.current) return;
    hasInitiatedLoad.current = true;
    loadTasks();
  }, []);

  // Auto-filter when filters change
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const delayDebounce = setTimeout(() => {
      setCurrentPage(0); // Reset to first page when filters change
      loadTasks();
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [filters]);

  const loadTasks = async () => {
    try {
      setLoading(true);

      // Check if user is authenticated
      const token = localStorage.getItem('token');
      console.log('Current token:', token ? 'Token exists' : 'No token');

      if (!token) {
        console.error('No authentication token found');
        alert('Anda belum login. Silakan login terlebih dahulu.');
        window.location.href = '/login';
        return;
      }

      // Fetch all tasks for counts ("Dibuat oleh" filter is applied server-side)
      const response = await getTasks(filters.createdByRole ? { createdByRole: filters.createdByRole } : {});
      let allTasks = response.tasks || [];

      // Options for the "Dibuat oleh" filter: roles that appear as creators with the badge on
      setCreatorRoleOptions((prev) =>
        filters.createdByRole ? collectCreatorRoles(allTasks, prev) : collectCreatorRoles(allTasks)
      );

      const activeCount = allTasks.filter(t => t.status === 'active').length;
      const inactiveCount = allTasks.filter(t => t.status === 'inactive').length;
      setTaskCounts({ total: allTasks.length, active: activeCount, inactive: inactiveCount });

      // Apply client-side filters
      let filteredTasks = allTasks;

      if (filters.status) {
        filteredTasks = filteredTasks.filter(task => task.status === filters.status);
      }

      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        filteredTasks = filteredTasks.filter(task =>
          task.title.toLowerCase().includes(searchLower) ||
          task.description.toLowerCase().includes(searchLower) ||
          task.location.toLowerCase().includes(searchLower)
        );
      }

      if (filters.location) {
        const locationLower = filters.location.toLowerCase();
        filteredTasks = filteredTasks.filter(task =>
          task.location.toLowerCase().includes(locationLower)
        );
      }

      // Sort tasks by ticketNumber (ascending, null at bottom)
      filteredTasks.sort((a, b) => {
        const aTicket = a.ticketNumber ?? Infinity;
        const bTicket = b.ticketNumber ?? Infinity;
        return aTicket - bTicket;
      });

      setTasks(filteredTasks);
      setCurrentPage(0); // Reset pagination when loading new data
    } catch (error) {
      console.error('Error loading tasks:', error);
      console.error('Error response:', error.response);
      console.error('Error request:', error.request);

      if (error.response?.status === 401) {
        alert('Sesi Anda telah berakhir. Silakan login kembali.');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('isAuthenticated');
        window.location.href = '/login';
      } else {
        showToast('Gagal memuat data task. Silakan coba lagi.', 'error');
      }
    } finally {
      setLoading(false);
    }
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
      status: '',
      location: '',
      createdByRole: ''
    });
  };

  const handleOpenModal = () => {
    setShowModal(true);
    setIsEditMode(false);
    setEditingTaskId(null);
    setEditingTask(null);
    setPinnedPosition(null);
    setMapsLink(''); // Clear maps link
    setFormData({
      title: '',
      description: '',
      location: '',
      latitude: '',
      longitude: '',
      start_time: '08:00',
      end_time: '17:00',
      status: 'active'
    });
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setIsEditMode(false);
    setEditingTaskId(null);
    setEditingTask(null);
    setShowMapPicker(false);
    setPinnedPosition(null);
    setMapsLink(''); // Clear maps link
    setMapFlyTarget(null);
    mapRef.current = null; // Clear map reference
  };

  // Called when user clicks a point on the map
  const handleMapClick = useCallback(async (latlng) => {
    const { lat, lng } = latlng;
    console.log('handleMapClick called with:', { lat, lng });

    if (isNaN(lat) || isNaN(lng)) {
      console.error('Invalid latlng:', latlng);
      return;
    }

    setPinnedPosition({ lat, lng });
    setGeocodingLoading(true);

    try {
      // Use centralized API for reverse geocoding
      console.log('🌍 Reverse geocoding coordinates:', { lat, lng });

      const data = await reverseGeocode(lat, lng);
      console.log('✅ Reverse geocode data:', data);

      const address = data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      setFormData(prev => ({
        ...prev,
        location: address,
        latitude: lat.toFixed(7),
        longitude: lng.toFixed(7),
      }));
      console.log('📍 Form data updated with address:', address);
    } catch (error) {
      console.error('❌ Reverse geocoding error:', error);
      // Fallback: set coordinate even if reverse geocoding fails
      setFormData(prev => ({
        ...prev,
        location: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        latitude: lat.toFixed(7),
        longitude: lng.toFixed(7),
      }));
    } finally {
      setGeocodingLoading(false);
    }
  }, []);

  const handleConfirmPin = () => {
    setShowMapPicker(false);
    setMapFlyTarget(null);
  };

  // Open the map picker — geocode address FIRST so MapContainer renders with correct center
  const handleOpenMapPicker = async () => {
    setMapFlyTarget(null);

    // If coords already exist from Google Maps link extraction, use them directly
    if (formData.latitude && formData.longitude) {
      const lat = parseFloat(formData.latitude);
      const lng = parseFloat(formData.longitude);
      if (!isNaN(lat) && !isNaN(lng)) {
        setPinnedPosition({ lat, lng });
        setMapFlyTarget({ lat, lng });
        setShowMapPicker(true);
        return;
      }
    }

    // If pinnedPosition already exists (from previous pin), open directly
    if (pinnedPosition) {
      setShowMapPicker(true);
      return;
    }

    // If a text address exists, geocode it before opening so the map starts at the right spot
    const address = formData.location?.trim();
    if (address) {
      setMapPickerOpenLoading(true);
      try {
        // Use backend proxy instead of direct Nominatim
        const res = await fetch(
          `/api/geocoding/search?q=${encodeURIComponent(address)}`,
          {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
          }
        );
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          const latF = parseFloat(data[0].lat);
          const lngF = parseFloat(data[0].lon);
          const displayName = data[0].display_name || address;
          setPinnedPosition({ lat: latF, lng: lngF });
          setFormData((prev) => ({
            ...prev,
            location: displayName,
            latitude: latF.toFixed(7),
            longitude: lngF.toFixed(7),
          }));
        }
      } catch (error) {
        console.error('Error geocoding address on picker open:', error);
        // Open anyway without pre-pinning
      } finally {
        setMapPickerOpenLoading(false);
      }
    }

    setShowMapPicker(true);
  };

  // Extract coordinates from Google Maps link
  const handleExtractFromMapsLink = async () => {
    const linkValue = mapsLink.trim();

    if (!linkValue) {
      showToast('Silakan masukkan link Google Maps', 'warning');
      return;
    }

    setMapsLinkLoading(true);
    try {
      console.log('🔗 Extracting coordinates from Maps link:', linkValue);

      // Call backend to extract coordinates using centralized API
      const data = await extractCoordinatesFromMapsLink(linkValue);

      if (!data.latitude || !data.longitude) {
        throw new Error('Gagal mengekstrak koordinat dari link tersebut');
      }

      const lat = parseFloat(data.latitude);
      const lng = parseFloat(data.longitude);

      console.log('✅ Raw extracted coordinates:', { latitude: data.latitude, longitude: data.longitude });
      console.log('   Type check - lat type:', typeof lat, 'lng type:', typeof lng);
      console.log('   Value check - lat:', lat, 'lng:', lng);

      // Validate coordinates are in reasonable bounds for Indonesia
      // Indonesia roughly: lat -11 to 6, lon 95 to 141
      if (lat < -12 || lat > 7 || lng < 94 || lng > 142) {
        console.warn('⚠️ Coordinates appear outside Indonesia bounds:', { lat, lng });
        console.log('   This might still be valid - check manually in map');
      }

      // Update pinned position for map
      setPinnedPosition({ lat, lng });

      // If map is open, fly to the location
      if (showMapPicker) {
        setMapFlyTarget({ lat, lng });
      }

      // Perform reverse geocoding to get address
      console.log('🌍 Performing reverse geocoding for extracted coordinates...');
      try {
        const geocodeData = await reverseGeocode(lat, lng);
        const address = geocodeData.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

        // Update form data with coordinates AND address
        setFormData(prev => ({
          ...prev,
          location: address,
          latitude: lat.toFixed(7),
          longitude: lng.toFixed(7)
        }));

        console.log('✅ Address obtained:', address);
        showToast('Koordinat dan alamat berhasil diekstrak! 📍', 'success');
      } catch (geocodeError) {
        console.warn('⚠️ Reverse geocoding failed:', geocodeError);
        // Fallback: just use coordinates
        setFormData(prev => ({
          ...prev,
          location: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
          latitude: lat.toFixed(7),
          longitude: lng.toFixed(7)
        }));
        showToast('Koordinat berhasil diekstrak (alamat tidak tersedia)', 'success');
      }
    } catch (error) {
      console.error('Error extracting coordinates:', error);
      showToast(`Error: ${error.message}`, 'error');
    } finally {
      setMapsLinkLoading(false);
    }
  };

  // Search address via Nominatim with debounce


  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      if (isEditMode && editingTaskId) {
        // Update existing task. A status change also needs tasks.toggle_status,
        // so only send status when it changed and the user may toggle it.
        const { status, ...rest } = formData;
        const statusChanged = editingTask && status !== editingTask.status;
        const updateData = statusChanged && can('tasks.toggle_status') ? { ...rest, status } : rest;
        await updateTask(editingTaskId, updateData);
        showToast('Task berhasil diperbarui!', 'success');
      } else {
        // Create new task (remove status as backend always sets to 'active')
        const createData = {
          title: formData.title,
          description: formData.description,
          location: formData.location,
          ...(formData.latitude && { latitude: formData.latitude }),
          ...(formData.longitude && { longitude: formData.longitude }),
          start_time: formData.start_time || '08:00',
          end_time: formData.end_time || '17:00',
        };
        await createTask(createData);
        showToast('Task berhasil dibuat!', 'success');
      }

      setShowModal(false);
      setPinnedPosition(null);
      loadTasks(); // Reload tasks

      // Reset form
      setFormData({
        title: '',
        description: '',
        location: '',
        latitude: '',
        longitude: '',
        start_time: '08:00',
        end_time: '17:00',
        status: 'active'
      });
    } catch (error) {
      console.error('Error saving task:', error);
      console.error('Error response:', error.response?.data);
      const errorMessage = error.response?.data?.message || error.message || 'Gagal menyimpan task. Silakan coba lagi.';
      showToast(errorMessage, 'error');
    }
  };

  const handleEdit = async (taskId) => {
    try {
      const response = await getTaskDetails(taskId);
      const task = response.task;

      setIsEditMode(true);
      setEditingTaskId(taskId);
      setEditingTask(task);
      const lat = task.latitude != null ? String(task.latitude) : '';
      const lng = task.longitude != null ? String(task.longitude) : '';
      setPinnedPosition(lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null);
      setMapsLink(''); // Clear maps link on edit
      setFormData({
        title: task.title,
        description: task.description,
        location: task.location,
        latitude: lat,
        longitude: lng,
        start_time: task.start_time || '',
        end_time: task.end_time || '',
        status: task.status
      });
      setShowModal(true);
    } catch (error) {
      console.error('Error loading task details:', error);
      showToast('Gagal memuat detail task.', 'error');
    }
  };

  const handleDelete = async (taskId) => {
    showConfirmModal(
      'Hapus Task',
      'Apakah Anda yakin ingin menghapus task ini? Tindakan ini tidak dapat dibatalkan.',
      async () => {
        try {
          await deleteTask(taskId);
          showToast('Task berhasil dihapus!', 'success');
          loadTasks(); // Reload tasks
        } catch (error) {
          console.error('Error deleting task:', error);

          // Show specific error message from backend
          if (error.response?.status === 422) {
            const errorMessage = error.response?.data?.message ||
              'Task tidak dapat dihapus karena masih memiliki assignment. Hapus assignment terlebih dahulu.';
            showToast(errorMessage, 'warning');
          } else {
            showToast('Gagal menghapus task. Silakan coba lagi.', 'error');
          }
        }
      },
      'delete'
    );
  };

  const handleToggleStatus = async (taskId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';

    showConfirmModal(
      `${newStatus === 'active' ? 'Aktifkan' : 'Nonaktifkan'} Task`,
      `Apakah Anda yakin ingin ${newStatus === 'active' ? 'mengaktifkan' : 'menonaktifkan'} task ini?`,
      async () => {
        try {
          await updateTask(taskId, { status: newStatus });
          showToast(`Task berhasil ${newStatus === 'active' ? 'diaktifkan' : 'dinonaktifkan'}!`, 'success');
          loadTasks(); // Reload tasks
        } catch (error) {
          console.error('Error updating task status:', error);
          const errorMessage = error.response?.data?.message || 'Gagal mengupdate status task. Silakan coba lagi.';
          showToast(errorMessage, 'error');
        }
      },
      newStatus === 'active' ? 'activate' : 'deactivate'
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusBadgeClass = (status) => {
    const statusMap = {
      'active': 'status-active',
      'inactive': 'status-inactive'
    };
    return statusMap[status] || '';
  };

  const getStatusLabel = (status) => {
    const labelMap = {
      'active': 'Active',
      'inactive': 'Inactive'
    };
    return labelMap[status] || status;
  };

  const hasActiveFilters = Object.values(filters).some(value => value !== '');

  return (
    <div className="task-page">
      {/* Bulk Upload Modal */}
      {showBulkUploadModal && (
        <BulkUploadModal
          onClose={() => setShowBulkUploadModal(false)}
          onImportComplete={handleBulkUploadComplete}
        />
      )}

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
                Batal
              </button>
              <button
                className={`btn-confirm-ok ${confirmModal.type}`}
                onClick={handleConfirm}
              >
                {confirmModal.type === 'delete' ? 'Hapus' : 'Konfirmasi'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="task-header">
        <div>
          <h1>Task Management</h1>
          <p className="task-subtitle">Manage and distribute task for the team</p>
        </div>
        <div className="task-header-actions">
          <Can perm="tasks.export">
          <button className="btn-download-template" onClick={handleDownloadTemplateClick}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download Template
          </button>
          </Can>
          <Can perm="tasks.import">
          <button className="btn-bulk-upload" onClick={handleOpenBulkUpload}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload Task
          </button>
          </Can>
          <Can perm="tasks.create">
          <button className="btn-tambah" onClick={handleOpenModal}>
            <span className="btn-icon">+</span> Create Task
          </button>
          </Can>
        </div>
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
          className={`summary-card clickable-summary ${filters.status === 'active' ? 'active-summary' : ''}`}
          onClick={() => handleStatusFilterClick('active')}
        >
          <div className="card-left">
            <span className={`dot ${filters.status === 'active' ? 'dot-white' : 'dot-blue'}`}></span>
            <span className="label">Active</span>
          </div>
          <span className={`badge ${filters.status === 'active' ? 'badge-white' : 'badge-blue'}`}>{taskCounts.active}</span>
        </div>
        <div
          className={`summary-card clickable-summary ${filters.status === 'inactive' ? 'active-summary' : ''}`}
          onClick={() => handleStatusFilterClick('inactive')}
        >
          <div className="card-left">
            <span className={`dot ${filters.status === 'inactive' ? 'dot-white' : 'dot-orange'}`}></span>
            <span className="label">Inactive</span>
          </div>
          <span className={`badge ${filters.status === 'inactive' ? 'badge-white' : 'badge-orange'}`}>{taskCounts.inactive}</span>
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
              placeholder="Search Task or Location..."
              value={filters.search}
              onChange={handleFilterChange}
              className="filter-input-icon"
            />
          </div>

          <div className="input-with-icon flex-grow">
            <svg className="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 10C21 17 12 23 12 23C12 23 3 17 3 10C3 7.61305 3.94821 5.32387 5.63604 3.63604C7.32387 1.94821 9.61305 1 12 1C14.3869 1 16.6761 1.94821 18.364 3.63604C20.0518 5.32387 21 7.61305 21 10Z" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="10" r="3" stroke="#86868b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              type="text"
              name="location"
              placeholder="Specific Location Filters..."
              value={filters.location}
              onChange={handleFilterChange}
              className="filter-input-icon"
            />
          </div>

          <select
            name="createdByRole"
            value={filters.createdByRole}
            onChange={handleFilterChange}
            className="filter-select filter-select-creator"
            aria-label="Dibuat oleh"
          >
            <option value="">Dibuat oleh: Semua</option>
            {creatorRoleOptions.map((role) => (
              <option key={role.name} value={role.name}>
                Dibuat oleh: {role.displayName || role.name}
              </option>
            ))}
          </select>

          <button onClick={handleClearFilters} className={`btn-clear ${hasActiveFilters ? 'active' : ''}`}>
            Clear Filters
          </button>
        </div>
      </div>

      <div className="task-content">
        <ResponsiveTable className="rt-responsive" tableClassName="task-table" loading={loading} minWidth="820px" maxHeight="100%">
          <thead className="dark-header">
            <tr>
              <th>#</th>
              <th>TICKET</th>
              <th>TITLE</th>
              <th>DESCRIPTION</th>
              <th>LOCATION</th>
              <th>STATUS</th>
              <th>ASSIGNMENTS</th>
              <th className="actions-header">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-state">
                  <div className="empty-content">
                    <span className="empty-icon">📋</span>
                    <p>Belum ada task</p>
                    <span>Klik tombol "Tambah Task" untuk membuat task baru</span>
                  </div>
                </td>
              </tr>
            ) : (
              tasks.map((task, index) => (
                <tr key={task.taskId}>
                  <td className="row-number">{index + 1}</td>
                  <td className="date-cell">{task.ticketNumber || '-'}</td>
                  <td className="task-name">
                    {task.title}
                    {task.createdByRole?.showBadge && (
                      <div className="task-creator-badge-row">
                        <TaskCreatorBadge createdByRole={task.createdByRole} createdBy={task.createdBy} compact />
                      </div>
                    )}
                  </td>
                  <td className="task-description">{task.description}</td>
                  <td className="location-cell">{task.location}</td>
                  <td>
                    <span className={`status-badge ${getStatusBadgeClass(task.status)}`}>
                      {getStatusLabel(task.status)}
                    </span>
                  </td>
                  <td className="assignment-count">
                    {task.takenTasks?.length > 0 ? (
                      <span className="assignment-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '4px' }}>
                          <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {task.takenTasks.length}
                      </span>
                    ) : (
                      <span className="no-assignment">-</span>
                    )}
                  </td>
                  <td className="actions-cell">
                    <Can perm="tasks.toggle_status">
                    <button
                      className="action-btn toggle-btn"
                      onClick={() => handleToggleStatus(task.taskId, task.status)}
                      title={task.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    >
                      {task.status === 'active' ? (
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
                    <Can perm="tasks.update">
                    <button
                      className="action-btn edit-btn"
                      onClick={() => handleEdit(task.taskId)}
                      title="Edit"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M11.333 2.00004C11.5081 1.82494 11.716 1.68605 11.9447 1.59129C12.1735 1.49653 12.4187 1.44775 12.6663 1.44775C12.914 1.44775 13.1592 1.49653 13.3879 1.59129C13.6167 1.68605 13.8246 1.82494 13.9997 2.00004C14.1748 2.17513 14.3137 2.383 14.4084 2.61178C14.5032 2.84055 14.552 3.08575 14.552 3.33337C14.552 3.58099 14.5032 3.82619 14.4084 4.05497C14.3137 4.28374 14.1748 4.49161 13.9997 4.66671L5.33301 13.3334L1.99967 14.3334L2.99967 11L11.333 2.00004Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    </Can>
                    <Can perm="tasks.delete">
                    <button
                      className="action-btn delete-btn"
                      onClick={() => handleDelete(task.taskId)}
                      disabled={task.takenTasks?.length > 0}
                      title={task.takenTasks?.length > 0
                        ? "⚠️ Task ini memiliki assignment. Hapus assignment terlebih dahulu!"
                        : "Delete"}
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
            Showing <strong>{tasks.length}</strong> of <strong>{taskCounts.total}</strong> tasks
          </div>
          <div className="table-legend">
            <div className="legend-item">
              <span className="dot dot-blue"></span> {taskCounts.active} Active
            </div>
            <div className="legend-item">
              <span className="dot dot-orange"></span> {taskCounts.inactive} Inactive
            </div>
          </div>
        </div>
      </div>

      {/* Modal for adding/editing task */}
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <h2>{isEditMode ? 'Edit Task' : 'Tambah Task Baru'}</h2>
                {isEditMode && editingTask?.createdByRole?.showBadge && (
                  <TaskCreatorBadge createdByRole={editingTask.createdByRole} createdBy={editingTask.createdBy} />
                )}
              </div>
              <button className="modal-close" onClick={handleCloseModal}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="title">Title <span className="required">*</span></label>
                <input
                  type="text"
                  id="title"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  placeholder="Masukkan judul task"
                  maxLength="255"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="description">Description <span className="required">*</span></label>
                <textarea
                  id="description"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Deskripsi task"
                  rows="4"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="location">Lokasi <span className="required">*</span></label>
                <input
                  type="text"
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={handleInputChange}
                  placeholder="Masukkan alamat lokasi (teks)"
                  maxLength="255"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="mapsLink">Link Google Map</label>
                <div className="location-input-wrap">
                  <input
                    type="text"
                    id="mapsLink"
                    name="mapsLink"
                    value={mapsLink}
                    onChange={(e) => setMapsLink(e.target.value)}
                    placeholder="Paste link Google Maps untuk ekstrak koordinat"
                    maxLength="500"
                  />
                  <button
                    type="button"
                    className="btn-import-link"
                    onClick={handleExtractFromMapsLink}
                    disabled={mapsLinkLoading || !mapsLink.trim()}
                    title="Extract koordinat dari Google Maps link"
                  >
                    {mapsLinkLoading ? (
                      <span className="map-search-spinner" style={{ width: 14, height: 14 }} />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.3-1.54c-.3-.35-.9-.35-1.2 0-.35.3-.35.85 0 1.2l1.9 2.15c.2.25.6.4.95.4.35 0 .75-.15.95-.4l3.35-4.2c.35-.3.35-.85.05-1.2-.3-.35-.85-.35-1.2-.05z" fill="currentColor" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn-pin-map"
                    onClick={handleOpenMapPicker}
                    disabled={mapPickerOpenLoading}
                    title="Pin lokasi di peta"
                  >
                    {mapPickerOpenLoading ? (
                      <span className="map-search-spinner" style={{ width: 14, height: 14 }} />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor" />
                      </svg>
                    )}
                    {mapPickerOpenLoading ? 'Mencari...' : 'Pin Lokasi'}
                  </button>
                </div>
              </div>

              {/* Latitude / Longitude — auto-filled by map pin */}
              <div className="form-row-coords">
                <div className="form-group">
                  <label htmlFor="latitude">Latitude</label>
                  <input
                    type="text"
                    id="latitude"
                    name="latitude"
                    value={formData.latitude}
                    readOnly
                    placeholder={geocodingLoading ? 'Mengambil koordinat...' : 'Didapat dari pin peta'}
                    className="input-coords"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="longitude">Longitude</label>
                  <input
                    type="text"
                    id="longitude"
                    name="longitude"
                    value={formData.longitude}
                    readOnly
                    placeholder={geocodingLoading ? 'Mengambil koordinat...' : 'Didapat dari pin peta'}
                    className="input-coords"
                  />
                </div>
              </div>

              <div className="form-row-coords">
                <div className="form-group">
                  <label htmlFor="start_time">Start Time</label>
                  <input
                    type="time"
                    id="start_time"
                    name="start_time"
                    value={formData.start_time}
                    onChange={handleInputChange}
                    placeholder="Pilih waktu mulai"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="end_time">End Time</label>
                  <input
                    type="time"
                    id="end_time"
                    name="end_time"
                    value={formData.end_time}
                    onChange={handleInputChange}
                    placeholder="Pilih waktu selesai"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="status">Status <span className="required">*</span></label>
                <select
                  id="status"
                  name="status"
                  value={formData.status}
                  onChange={handleInputChange}
                  disabled={isEditMode && !can('tasks.toggle_status')}
                  title={isEditMode && !can('tasks.toggle_status') ? 'Anda tidak memiliki akses untuk mengubah status task' : undefined}
                  required
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={handleCloseModal}>
                  Batal
                </button>
                <button type="submit" className="btn-submit">
                  {isEditMode ? 'Update Task' : 'Simpan Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Map Picker Modal */}
      {showMapPicker && (
        <div className="map-picker-overlay" onClick={() => { setShowMapPicker(false); setMapFlyTarget(null); }}>
          <div className="map-picker-container" onClick={(e) => e.stopPropagation()}>
            <div className="map-picker-header">
              <h3>Pin Lokasi di Peta</h3>
              <span className="map-picker-hint">Klik pada peta untuk memilih lokasi</span>
              <button className="modal-close" onClick={() => { setShowMapPicker(false); setMapFlyTarget(null); }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            <div className="map-picker-body">
              <MapContainer
                ref={(m) => {
                  console.log('🗺️ MapContainer ref callback, map instance:', m ? 'Available' : 'null');
                  mapRef.current = m;
                }}
                center={pinnedPosition ? [pinnedPosition.lat, pinnedPosition.lng] : [-7.7956, 110.3695]}
                zoom={pinnedPosition ? 16 : 11}
                style={{ width: '100%', height: '420px' }}
                scrollWheelZoom={true}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickHandler onMapClick={handleMapClick} />
                <MapFlyToController target={mapFlyTarget} mapRef={mapRef} />
                {(() => {
                  console.log('📍 Rendering marker, pinnedPosition:', pinnedPosition);
                  return pinnedPosition && (
                    <Marker position={[pinnedPosition.lat, pinnedPosition.lng]} icon={taskPinIcon} />
                  );
                })()}
              </MapContainer>
            </div>

            {/* Coordinate preview */}
            <div className="map-picker-footer">
              {geocodingLoading && (
                <span className="coords-loading">Mengambil alamat...</span>
              )}
              {pinnedPosition && !geocodingLoading && (
                <div className="coords-preview">
                  <span>📍 {formData.location || `${pinnedPosition.lat.toFixed(6)}, ${pinnedPosition.lng.toFixed(6)}`}</span>
                  <span className="coords-small">{formData.latitude}, {formData.longitude}</span>
                </div>
              )}
              {!pinnedPosition && !geocodingLoading && (
                <span className="coords-placeholder">Belum ada lokasi dipilih</span>
              )}
              <button
                type="button"
                className="btn-confirm-pin"
                disabled={!pinnedPosition || geocodingLoading}
                onClick={handleConfirmPin}
              >
                Konfirmasi Lokasi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Task;
