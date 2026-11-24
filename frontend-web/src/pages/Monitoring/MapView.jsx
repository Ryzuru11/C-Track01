import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import UserAvatar from './UserAvatar';
import { getUserAvatar } from '../../services/api';
import './MapView.css';

// Component to handle map center changes
function MapController({ center, zoom }) {
  const map = useMap();

  useEffect(() => {
    if (center && center.lat && center.lng) {
      map.setView([center.lat, center.lng], zoom || 15, {
        animate: true,
        duration: 1
      });
    }
  }, [center, zoom, map]);

  return null;
}

// Custom marker icons based on user avatar
const createAvatarIcon = (status, initials, avatarSrc = null) => {
  // Always use black border for all markers
  const borderColor = '#000000';

  const avatarHTML = avatarSrc
    ? `<img src="${avatarSrc}" alt="${initials}" class="marker-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`
    : '';

  const initialsHTML = `<div class="marker-avatar-initials" style="display: ${avatarSrc ? 'none' : 'flex'};">${initials}</div>`;

  return L.divIcon({
    className: 'custom-avatar-marker',
    html: `
      <div class="avatar-marker-container" style="border-color: ${borderColor}">
        ${avatarHTML}
        ${initialsHTML}
      </div>
    `,
    iconSize: [50, 50],
    iconAnchor: [25, 25],
    popupAnchor: [0, -25],
  });
};

// Task location marker icon
const createTaskIcon = () => {
  return L.divIcon({
    className: 'custom-task-marker',
    html: `
      <div class="task-marker-container">
        <div class="task-marker-pin">
          <svg width="40" height="50" viewBox="0 0 40 50" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 0C9.5 0 1 8.5 1 19C1 32 20 50 20 50C20 50 39 32 39 19C39 8.5 30.5 0 20 0Z" fill="#FF4444" stroke="#FFFFFF" stroke-width="2"/>
            <circle cx="20" cy="19" r="8" fill="#FFFFFF"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [40, 50],
    iconAnchor: [20, 50],
    popupAnchor: [0, -50],
  });
};


// Historical location marker icon (for clicked location from timeline)
const createHistoricalLocationIcon = () => {
  return L.divIcon({
    className: 'custom-historical-marker',
    html: `
      <div class="historical-marker-container">
        <div class="historical-marker-pin">
          <svg width="36" height="45" viewBox="0 0 36 45" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 0C8.6 0 1 7.6 1 17C1 28.8 18 45 18 45C18 45 35 28.8 35 17C35 7.6 27.4 0 18 0Z" fill="#8B5CF6" stroke="#FFFFFF" stroke-width="2"/>
            <circle cx="18" cy="17" r="6" fill="#FFFFFF"/>
            <path d="M18 11L18 17L21 20" stroke="#8B5CF6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [36, 45],
    iconAnchor: [18, 45],
    popupAnchor: [0, -45],
  });
};

// Get initials from name
const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

const MapView = forwardRef(({ members, taskLocation, clickedLocation, onMemberClick, mapCenter }, ref) => {
  const [hoveredMember, setHoveredMember] = useState(null);
  const [memberAvatars, setMemberAvatars] = useState({});
  const mapRef = useRef(null);

  useImperativeHandle(ref, () => ({
    zoomToLocation: (lat, lng, zoom = 15) => {
      if (mapRef.current) {
        mapRef.current.setView([lat, lng], zoom, { animate: true });
      }
    }
  }));

  // Validate and filter members with valid coordinates
  const validMembers = members.filter(member => {
    const lat = parseFloat(member.lat);
    const lng = parseFloat(member.lng);
    const isValid = !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    return isValid;
  });

  // Validate task location
  const validTaskLocation = taskLocation && taskLocation.latitude && taskLocation.longitude
    ? {
      lat: parseFloat(taskLocation.latitude),
      lng: parseFloat(taskLocation.longitude),
      address: taskLocation.address,
      title: taskLocation.title
    }
    : null;


  // Validate clicked historical location
  const validClickedLocation = clickedLocation && clickedLocation.latitude && clickedLocation.longitude
    ? {
      lat: parseFloat(clickedLocation.latitude),
      lng: parseFloat(clickedLocation.longitude),
      recordedAt: clickedLocation.recordedAt,
      accuracy: clickedLocation.accuracy,
      address: clickedLocation.address
    }
    : null;

  // Fetch avatars for all members
  useEffect(() => {
    const loadAvatars = async () => {
      const avatars = {};
      for (const member of validMembers) {
        try {
          const avatarData = await getUserAvatar(member.id);

          if (avatarData) {
            // Format avatar with proper data URI prefix
            if (!avatarData.startsWith('data:image')) {
              avatars[member.id] = `data:image/jpeg;base64,${avatarData}`;
            } else {
              avatars[member.id] = avatarData;
            }
          }
        } catch (err) {
          // Silent fail - fallback to initials
        }
      }
      setMemberAvatars(avatars);
    };

    if (validMembers.length > 0) {
      loadAvatars();
    }
  }, [validMembers.length]);

  // Default center (Jakarta, Indonesia)
  const defaultCenter = [-6.2088, 106.8456];
  const defaultZoom = 11;

  // Calculate map center from member locations
  const getMapCenter = () => {
    // If there's a task location, prioritize it
    if (validTaskLocation) {
      return [validTaskLocation.lat, validTaskLocation.lng];
    }

    if (validMembers.length === 0) return defaultCenter;

    const avgLat = validMembers.reduce((sum, m) => sum + parseFloat(m.lat), 0) / validMembers.length;
    const avgLng = validMembers.reduce((sum, m) => sum + parseFloat(m.lng), 0) / validMembers.length;

    return [avgLat, avgLng];
  };

  // Fit map bounds to show all markers when members change
  useEffect(() => {
    if (mapRef.current) {
      const allPoints = [];

      // Add task location
      if (validTaskLocation) {
        allPoints.push([validTaskLocation.lat, validTaskLocation.lng]);
      }

      // Add clicked historical location
      if (validClickedLocation) {
        allPoints.push([validClickedLocation.lat, validClickedLocation.lng]);
      }

      // Add member locations
      if (validMembers.length > 0) {
        allPoints.push(...validMembers.map(m => [parseFloat(m.lat), parseFloat(m.lng)]));
      }

      // Fit bounds if we have points
      if (allPoints.length > 0) {
        const bounds = L.latLngBounds(allPoints);
        mapRef.current.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [validMembers, validTaskLocation, validClickedLocation]);

  return (
    <div className="map-view">
      <div className="map-container">
        {validMembers.length === 0 && !validTaskLocation ? (
          <div className="map-placeholder">
            <div className="map-info">
              <p>No Members Found</p>
              <span>Try adjusting your filters</span>
            </div>
          </div>
        ) : (
          <MapContainer
            center={getMapCenter()}
            zoom={defaultZoom}
            className="leaflet-map"
            scrollWheelZoom={true}
            ref={mapRef}
          >
            {/* OpenStreetMap Tiles */}
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />

            {/* Map Controller for programmatic center changes */}
            {mapCenter && <MapController center={mapCenter} zoom={mapCenter.zoom} />}

            {/* Task Location Marker */}
            {validTaskLocation && (
              <Marker
                position={[validTaskLocation.lat, validTaskLocation.lng]}
                icon={createTaskIcon()}
              >
                <Popup>
                  <div className="marker-popup">
                    <div className="popup-header">
                      <div className="popup-header-text">
                        <h3>📍 {validTaskLocation.title || 'Task Location'}</h3>
                      </div>
                    </div>
                    <div className="popup-info">
                      {validTaskLocation.address && (
                        <div className="info-row">
                          <span className="info-label">Address:</span>
                          <span className="info-value">{validTaskLocation.address}</span>
                        </div>
                      )}
                      <div className="info-row">
                        <span className="info-label">Coordinates:</span>
                        <span className="info-value coordinates">
                          {validTaskLocation.lat.toFixed(6)}, {validTaskLocation.lng.toFixed(6)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}


            {/* Historical Location Marker (clicked from timeline) */}
            {validClickedLocation && (
              <Marker
                position={[validClickedLocation.lat, validClickedLocation.lng]}
                icon={createHistoricalLocationIcon()}
              >
                <Popup>
                  <div className="marker-popup">
                    <div className="popup-header">
                      <div className="popup-header-text">
                        <h3>🕐 Lokasi Historis</h3>
                      </div>
                    </div>
                    <div className="popup-info">
                      {validClickedLocation.recordedAt && (
                        <div className="info-row">
                          <span className="info-label">Waktu:</span>
                          <span className="info-value">
                            {new Date(validClickedLocation.recordedAt).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                      )}
                      {validClickedLocation.address && (
                        <div className="info-row">
                          <span className="info-label">Alamat:</span>
                          <span className="info-value">{validClickedLocation.address}</span>
                        </div>
                      )}
                      <div className="info-row">
                        <span className="info-label">Koordinat:</span>
                        <span className="info-value coordinates">
                          {validClickedLocation.lat.toFixed(6)}, {validClickedLocation.lng.toFixed(6)}
                        </span>
                      </div>
                      {validClickedLocation.accuracy && (
                        <div className="info-row">
                          <span className="info-label">Akurasi:</span>
                          <span className="info-value">±{validClickedLocation.accuracy}m</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Render markers from member data */}
            {validMembers.map((member) => (
              <Marker
                key={member.id}
                position={[parseFloat(member.lat), parseFloat(member.lng)]}
                icon={createAvatarIcon(
                  member.status,
                  getInitials(member.name),
                  memberAvatars[member.id]
                )}
                eventHandlers={{
                  mouseover: () => setHoveredMember(member.id),
                  mouseout: () => setHoveredMember(null),
                  click: () => {
                    if (onMemberClick) {
                      onMemberClick(member);
                    }
                  }
                }}
              >
                <Popup>
                  <div className="marker-popup">
                    <div className="popup-header">
                      <UserAvatar
                        userId={member.id}
                        userName={member.name}
                        size="medium"
                      />
                      <div className="popup-header-text">
                        <h3>{member.name}</h3>
                      </div>
                    </div>
                    <div className="popup-info">
                      <div className="info-row">
                        <span className="info-label">Email:</span>
                        <span className="info-value">{member.email}</span>
                      </div>
                      {member.lastUpdate && (
                        <div className="info-row">
                          <span className="info-label">Last Update:</span>
                          <span className="info-value">
                            {new Date(member.lastUpdate).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                      )}
                      <div className="info-row">
                        <span className="info-label">Location:</span>
                        <span className="info-value coordinates">
                          {parseFloat(member.lat).toFixed(4)}, {parseFloat(member.lng).toFixed(4)}
                        </span>
                      </div>
                      {member.accuracy && (
                        <div className="info-row">
                          <span className="info-label">Accuracy:</span>
                          <span className="info-value">±{member.accuracy}m</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}

        {/* Member count info */}
        {validMembers.length > 0 && (
          <div className="map-info-small">
            <span>Showing {validMembers.length} member{validMembers.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
});

MapView.displayName = 'MapView';

export default MapView;
