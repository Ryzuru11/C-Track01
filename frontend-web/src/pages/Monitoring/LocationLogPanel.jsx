import React, { useState, useEffect, forwardRef } from 'react';
import UserAvatar from './UserAvatar';
import './LocationLogPanel.css';

const LocationLogPanel = forwardRef(({ locations, selectedUser, allUsers, userStatuses }, ref) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [detailedLocations, setDetailedLocations] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filter locations for selected user if any
  const filteredLocations = selectedUser 
    ? locations.filter(loc => loc.user_id === selectedUser.id)
    : locations;

  // Get user info for location
  const getUserInfo = (userId) => {
    return allUsers?.find(u => u.id === userId);
  };

  // Calculate duration and distance stats
  const stats = {
    visits: filteredLocations.length,
    duration: '0h',
    distance: '0 KM'
  };

  // Format address from location data
  const formatAddress = (location) => {
    // If we have a formatted address, use it
    if (location.address) return location.address;
    
    // Otherwise show coordinates
    return `${parseFloat(location.latitude).toFixed(6)}, ${parseFloat(location.longitude).toFixed(6)}`;
  };

  // Format timestamp
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div 
      ref={ref}
      className={`location-log-panel ${isExpanded ? 'expanded' : 'collapsed'}`}
    >
      <div className="location-log-header">
        <h2>
          {selectedUser ? `Riwayat Lokasi - ${selectedUser.name}` : 'Riwayat Lokasi'}
          {selectedUser && userStatuses?.[selectedUser.id] === 'completed' && (
            <span className="user-completed-badge">✓ Selesai</span>
          )}
        </h2>
        <span className="location-count">{filteredLocations.length}</span>
        <button 
          className="toggle-button"
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? '▼' : '▲'}
        </button>
      </div>

      {isExpanded && (
        <div className="location-log-content">
          {selectedUser && (
            <div className="location-stats">
              <div className="stat-item">
                <span className="stat-value">{stats.visits}</span>
                <span className="stat-label">Dikunjungi</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{stats.duration}</span>
                <span className="stat-label">Durasi</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{stats.distance}</span>
                <span className="stat-label">KM</span>
              </div>
            </div>
          )}

          {loading ? (
            <div className="location-log-loading">
              <div className="spinner"></div>
              <p>Memuat riwayat lokasi...</p>
            </div>
          ) : filteredLocations.length === 0 ? (
            <div className="location-log-empty">
              <span className="empty-icon">📍</span>
              <p>Belum ada data lokasi</p>
              <span className="empty-subtitle">
                {selectedUser 
                  ? 'User belum mencatat lokasi' 
                  : 'Pilih user untuk melihat riwayat lokasi'}
              </span>
            </div>
          ) : (
            <div className="location-log-list">
              <div className="location-log-info">
                <p>Log dari perangkat ini · Anggota lain memiliki log masing-masing</p>
              </div>

              <div className="location-timeline">
                {filteredLocations.map((location, index) => {
                  const user = getUserInfo(location.user_id);
                  const isFirst = index === 0;
                  
                  return (
                    <div key={location.id || index} className="location-entry">
                      <div className="location-time">
                        {formatTime(location.recorded_at)}
                      </div>
                      
                      <div className="location-marker">
                        <div className={`marker-dot ${isFirst ? 'current' : ''}`}>
                          {isFirst ? '✓' : ''}
                        </div>
                        {index < filteredLocations.length - 1 && (
                          <div className="marker-line"></div>
                        )}
                      </div>

                      <div className="location-details">
                        {!selectedUser && user && (
                          <div className="location-user-info">
                            <UserAvatar 
                              userId={user.id} 
                              userName={user.name} 
                              size="small"
                            />
                            <span className="user-name">{user.name}</span>
                            {userStatuses?.[user.id] === 'completed' && (
                              <span className="user-status-done">✓ Selesai</span>
                            )}
                          </div>
                        )}
                        
                        <div className="location-address">
                          {formatAddress(location)}
                        </div>
                        
                        <div className="location-coords">
                          {parseFloat(location.latitude).toFixed(6)}, {parseFloat(location.longitude).toFixed(6)}
                        </div>
                        
                        <div className="location-meta">
                          <span className="location-source">Dicatat otomatis</span>
                          {location.accuracy && (
                            <span className="location-accuracy">±{location.accuracy}m</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

LocationLogPanel.displayName = 'LocationLogPanel';

export default LocationLogPanel;
