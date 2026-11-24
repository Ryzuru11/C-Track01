import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './Monitoring.css';
import MapView from './MapView';
import ActivityPanel from './ActivityPanel';
import { getAssignmentDetails, getReportsByTakenTask, getCurrentLocationsByTakenTask, preloadAvatars } from '../../services/api';
import useAccess from '../../hooks/useAccess';

function Monitoring() {
  const { takenTaskId } = useParams();
  const navigate = useNavigate();
  const mapViewRef = useRef(null);
  const { can } = useAccess();
  // Map + location history → monitoring.view_locations; reports + forum → monitoring.view_reports
  const canViewReports = can('monitoring.view_reports');
  const canViewLocations = can('monitoring.view_locations');

  const [assignment, setAssignment] = useState(null);
  const [reports, setReports] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [mapCenter, setMapCenter] = useState(null);
  const [locationFilterUserId, setLocationFilterUserId] = useState(null);
  const [filteredUserLocations, setFilteredUserLocations] = useState([]);
  const [clickedLocation, setClickedLocation] = useState(null);

  // Set currently active monitoring ID
  useEffect(() => {
    if (takenTaskId) {
      window.__ctrackActiveMonitoringId = takenTaskId;
    }
    return () => {
      window.__ctrackActiveMonitoringId = null;
    };
  }, [takenTaskId]);

  // Fetch assignment details and reports
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setReportsLoading(true);
        setError('');

        // Fetch assignment details
        const assignmentData = await getAssignmentDetails(takenTaskId);

        // Handle both possible response structures
        const taskData = assignmentData.assignment || assignmentData.takenTask;
        setAssignment(taskData);

        // Fetch reports for this taken task
        if (canViewReports) {
          const reportsData = await getReportsByTakenTask(takenTaskId);
          setReports(reportsData.reports || []);
        } else {
          setReports([]);
        }

        // Fetch locations for this taken task
        if (canViewLocations) {
          try {
            const locationsData = await getCurrentLocationsByTakenTask(takenTaskId);
            setLocations(locationsData.current_locations || []);
          } catch (locErr) {
            setLocations([]);
          }
        } else {
          setLocations([]);
        }

        // Preload avatars for all assigned users (lazy loading with cache)
        if (assignmentData.assignment?.users) {
          const userIds = assignmentData.assignment.users.map(u => u.id);
          preloadAvatars(userIds).catch(() => { });
        }

      } catch (err) {
        console.error('Error fetching monitoring data:', err);
        setError(err.response?.data?.message || 'Failed to load monitoring data');
      } finally {
        setLoading(false);
        setReportsLoading(false);
      }
    };

    if (takenTaskId) {
      fetchData();
    }
  }, [takenTaskId, canViewReports, canViewLocations]);

  // 🔥 Listen event laporan baru dari socket global — refresh reports secara real-time
  useEffect(() => {
    const handleNewReport = async (event) => {
      const reportData = event.detail;
      // Hanya refresh jika laporan ini milik takenTask yang sedang dibuka
      if (canViewReports && reportData?.takenTaskId === takenTaskId) {
        console.log('🔄 [Monitoring] Laporan baru masuk, refresh reports...');
        try {
          const reportsData = await getReportsByTakenTask(takenTaskId);
          setReports(reportsData.reports || []);
        } catch (err) {
          console.error('Error refreshing reports:', err);
        }
      }
    };

    window.addEventListener('ctrack:new_report', handleNewReport);
    return () => {
      window.removeEventListener('ctrack:new_report', handleNewReport);
    };
  }, [takenTaskId, canViewReports]);

  // Calculate member locations from location tracking data
  const memberLocations = assignment?.users?.map((user) => {
    // Find location data for this user from location tracking
    const userLocation = locations.find(loc => loc.user_id === user.id);

    // Check if user has submitted a report
    const hasReport = reports.some(r => r.user_id === user.id);

    // Parse coordinates properly (handle string or number)
    const lat = userLocation?.latitude
      ? (typeof userLocation.latitude === 'string' ? parseFloat(userLocation.latitude) : userLocation.latitude)
      : -6.2088;

    const lng = userLocation?.longitude
      ? (typeof userLocation.longitude === 'string' ? parseFloat(userLocation.longitude) : userLocation.longitude)
      : 106.8456;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: hasReport ? 'active' : 'offline',
      // Use actual tracked location from database
      lat: lat,
      lng: lng,
      hasReport: hasReport,
      lastUpdate: userLocation?.recorded_at || null,
      accuracy: userLocation?.accuracy || null
    };
  }) || [];

  // Handle user location select from ActivityPanel - zoom map to user
  const handleUserLocationSelect = (user, userLocations) => {
    setSelectedUser(user);

    if (userLocations && userLocations.length > 0) {
      const latestLocation = userLocations[0];
      const lat = parseFloat(latestLocation.latitude);
      const lng = parseFloat(latestLocation.longitude);

      if (!isNaN(lat) && !isNaN(lng)) {
        setMapCenter({ lat, lng, zoom: 15 });
      }
    }
  };

  // Handle member marker click to select user
  const handleMemberClick = (member) => {
    console.log('📍 Member clicked on map:', member);
    setSelectedUser(member);
  };

  // Handle location filter change from ActivityPanel
  const handleLocationFilterChange = (userId, userLocationHistory) => {
    console.log('🔍 Location filter changed:', userId, 'with', userLocationHistory?.length, 'locations');
    // Keep userId as string (it's a UUID), empty string becomes null
    setLocationFilterUserId(userId || null);
    setFilteredUserLocations(userLocationHistory || []);
  };

  // Handle location click from ActivityPanel
  const handleLocationClick = (location) => {
    console.log('📍 Location clicked:', location);
    setClickedLocation(location);
    // Only update clicked location, don't change map zoom/center
  };

  // Calculate stats
  const stats = {
    total: memberLocations.length,
    reports: reports.length,
    pending: memberLocations.filter(m => !m.hasReport).length
  };

  if (loading) {
    return (
      <div className="monitoring-container">
        <div className="monitoring-loading">
          <div className="spinner"></div>
          <p>Loading monitoring data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="monitoring-container">
        <div className="monitoring-error">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
          <button onClick={() => navigate('/taken')} className="back-btn">
            Back to Assignments
          </button>
        </div>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="monitoring-container">
        <div className="monitoring-loading">
          <div className="spinner"></div>
          <p>Loading assignment data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="monitoring-container">
      <div className="monitoring-header-compact">
        <div className="header-top">

          <button onClick={() => navigate('/taken')} className="back-button">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="header-info">
            <h1>{assignment?.task?.title || 'Task Monitoring'}</h1>
            {assignment?.task?.location && (
              <div className="header-meta">
                <span className="assignment-location">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                    <path d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6C3.5 9.5 8 14.5 8 14.5C8 14.5 12.5 9.5 12.5 6C12.5 3.51 10.49 1.5 8 1.5ZM8 7.75C7.03 7.75 6.25 6.97 6.25 6C6.25 5.03 7.03 4.25 8 4.25C8.97 4.25 9.75 5.03 9.75 6C9.75 6.97 8.97 7.75 8 7.75Z" fill="currentColor" />
                  </svg>
                  {assignment.task.location}
                </span>
              </div>
            )}
          </div>
          {assignment?.date && (
            <span className="assignment-date">
              {new Date(assignment.date).toLocaleDateString('id-ID', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
              })}
            </span>
          )}
        </div>
      </div>

      <div className="monitoring-content">
        <div className="monitoring-map-section">
          {!canViewLocations ? (
            <div className="monitoring-loading monitoring-no-location-access">
              <span className="error-icon">🔒</span>
              <p>Anda tidak memiliki akses untuk melihat lokasi karyawan.</p>
            </div>
          ) : (
          <MapView
            members={(() => {
              if (!locationFilterUserId) {
                // Show all users
                return memberLocations;
              }

              // Try to find user in memberLocations first (use == for loose equality)
              const existingMember = memberLocations.find(m => m.id == locationFilterUserId);
              if (existingMember) {
                return [existingMember];
              }

              // If not found but we have location history, create member from history
              if (filteredUserLocations.length > 0) {
                const user = assignment?.users?.find(u => u.id == locationFilterUserId);
                if (user) {
                  const latestLocation = filteredUserLocations[0];
                  const hasReport = reports.some(r => r.user_id == user.id);

                  const lat = parseFloat(latestLocation.latitude);
                  const lng = parseFloat(latestLocation.longitude);

                  const memberObj = {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    status: hasReport ? 'active' : 'offline',
                    lat: lat,
                    lng: lng,
                    hasReport: hasReport,
                    lastUpdate: latestLocation.recordedAt || latestLocation.recorded_at,
                    accuracy: latestLocation.accuracy
                  };

                  return [memberObj];
                }
              }

              // No data available
              return [];
            })()}
            taskLocation={assignment?.task}
            clickedLocation={clickedLocation}
            onMemberClick={handleMemberClick}
            mapCenter={mapCenter}
            ref={mapViewRef}
          />
          )}
        </div>

        <ActivityPanel
          takenTaskId={takenTaskId}
          reports={reports}
          locations={locations}
          allUsers={assignment?.users}
          loading={reportsLoading}
          onUserLocationSelect={handleUserLocationSelect}
          onLocationFilterChange={handleLocationFilterChange}
          onLocationClick={handleLocationClick}
          userStatuses={assignment?.userStatuses}
          totalMembers={stats.total}
          canViewReports={canViewReports}
          canViewLocations={canViewLocations}
        />
      </div>

    </div>
  );
}

export default Monitoring;
