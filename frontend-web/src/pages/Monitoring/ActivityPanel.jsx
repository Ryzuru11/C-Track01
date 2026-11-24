import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import UserAvatar from './UserAvatar';
import { getLocationsByTakenTask, STORAGE_BASE_URL } from '../../services/api';
import ReportForum from './ReportForum';
import './ActivityPanel.css';

function ActivityPanel({ takenTaskId, reports, locations, allUsers, loading, onUserLocationSelect, onLocationFilterChange, onLocationClick, userStatuses, totalMembers, canViewReports = true, canViewLocations = true }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryReportId = searchParams.get('reportId');

  const [activeTab, setActiveTab] = useState(canViewReports ? 'reports' : 'logs'); // 'reports' or 'logs'
  // Tabs follow permissions: Laporan → monitoring.view_reports, Riwayat Lokasi → monitoring.view_locations
  const currentTab = !canViewReports ? 'logs' : (!canViewLocations ? 'reports' : activeTab);
  const [selectedReport, setSelectedReport] = useState(null);
  const [openForum, setOpenForum] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState(null);

  // 🟢 UNREAD DOT — Set of reportIds yang punya notifikasi belum dibaca
  const [unreadReportIds, setUnreadReportIds] = useState(() => {
    try {
      const stored = localStorage.getItem(`ctrack:unread_reports:${takenTaskId}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const markReportRead = (reportId) => {
    setUnreadReportIds(prev => {
      const next = new Set(prev);
      next.delete(reportId);
      try {
        localStorage.setItem(`ctrack:unread_reports:${takenTaskId}`, JSON.stringify([...next]));
      } catch { }
      return next;
    });
  };

  const addUnreadReport = (reportId) => {
    if (!reportId) return;
    // Jangan tambah jika forum untuk laporan ini sedang dibuka
    if (window.__ctrackActiveReportForumId === reportId) return;
    setUnreadReportIds(prev => {
      const next = new Set(prev);
      next.add(reportId);
      try {
        localStorage.setItem(`ctrack:unread_reports:${takenTaskId}`, JSON.stringify([...next]));
      } catch { }
      return next;
    });
  };

  // 🔥 DETECT MOBILE
  const isMobile = window.innerWidth < 768;
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userLocations, setUserLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [imageErrors, setImageErrors] = useState(new Set()); // Track failed images
  const imageObserver = useRef(null); // Intersection Observer for lazy loading

  // Setup Intersection Observer for lazy loading images
  useEffect(() => {
    imageObserver.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = entry.target;
            const src = img.dataset.src;
            if (src && !img.src) {
              img.src = src;
              imageObserver.current.unobserve(img);
            }
          }
        });
      },
      { rootMargin: '50px' } // Start loading 50px before image enters viewport
    );

    return () => {
      if (imageObserver.current) {
        imageObserver.current.disconnect();
      }
    };
  }, []);

  // Handle image error with proper tracking to prevent infinite loops
  const handleImageError = (e, imagePath) => {
    const imgElement = e.target;

    // Prevent infinite loop - only set placeholder once
    if (imageErrors.has(imagePath)) {
      return; // Already handled
    }

    // Mark this image as failed
    setImageErrors(prev => new Set(prev).add(imagePath));

    // Set to placeholder and prevent further error events
    imgElement.onerror = null; // Remove error handler
    imgElement.src = '/icon/image-placeholder.png';

    if (import.meta.env.DEV) {
      console.warn('Failed to load image:', imagePath);
    }
  };

  // Attach lazy loading observer to image when it mounts
  const attachLazyLoad = (imgElement) => {
    if (imgElement && imageObserver.current) {
      imageObserver.current.observe(imgElement);
    }
  };

  // Format date for display
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatAddress = (location) => {
    if (location.address) return location.address;
    return `${parseFloat(location.latitude).toFixed(6)}, ${parseFloat(location.longitude).toFixed(6)}`;
  };

  const handleReportClick = (report) => {
    setSelectedReport(report);
  };

  const handleBackToList = () => {
    setSelectedReport(null);
  };

  const handleImageClick = (imagePath) => {
    setSelectedImage(imagePath);
  };

  const closeImageModal = () => {
    setSelectedImage(null);
  };

  const getUserInfo = (userId) => {
    return allUsers?.find(u => u.id === userId);
  };

  // Parse photos from image JSON field
  const getPhotos = (report) => {
    if (!report.image) return [];

    try {
      const photos = JSON.parse(report.image);
      return Array.isArray(photos) ? photos : [];
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('Failed to parse report images:', e);
      }
      return [];
    }
  };

  // Fetch user locations when user is selected
  useEffect(() => {
    const fetchUserLocations = async () => {
      if (!selectedUserId || !takenTaskId || !canViewLocations) {
        setUserLocations([]);
        return;
      }

      try {
        setLocationsLoading(true);
        const response = await getLocationsByTakenTask(takenTaskId, selectedUserId, 100);
        setUserLocations(response.locations || []);

        // Notify parent to zoom map to user's latest location AND pass location data for filtering
        if (response.locations && response.locations.length > 0) {
          const user = allUsers.find(u => u.id == selectedUserId);
          if (user && onUserLocationSelect) {
            onUserLocationSelect(user, response.locations);
          }
          // Also notify filter change with location data
          if (onLocationFilterChange) {
            onLocationFilterChange(selectedUserId, response.locations);
          }
        } else if (onLocationFilterChange) {
          // User selected but no location data
          onLocationFilterChange(selectedUserId, []);
        }
      } catch (error) {
        console.error('❌ Error fetching user locations:', error);
        setUserLocations([]);
      } finally {
        setLocationsLoading(false);
      }
    };

    fetchUserLocations();
  }, [selectedUserId, takenTaskId, canViewLocations]);

  // Auto-open forum popup if reportId query parameter exists in URL
  useEffect(() => {
    if (canViewReports && queryReportId && reports && reports.length > 0) {
      const foundReport = reports.find(r => r.reportId === queryReportId);
      if (foundReport) {
        setSelectedReport(foundReport);
        setSelectedReportId(queryReportId);
        setOpenForum(true);

        // Clear query parameter
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('reportId');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [queryReportId, reports, searchParams, setSearchParams, canViewReports]);

  // 🔥 Listen custom event ketika user sudah di halaman monitoring yang sama
  // dan klik 'Lihat Laporan' dari toast notifikasi
  useEffect(() => {
    const handleOpenReportForum = (event) => {
      const { reportId } = event.detail || {};
      if (!reportId || !canViewReports) return;

      // Cari laporan di state jika ada (untuk menampilkan detail di selectedReport)
      const foundReport = reports && reports.length > 0
        ? reports.find(r => r.reportId === reportId)
        : null;

      // Langsung buka forum — selectedReport bisa null, forum hanya butuh reportId
      setSelectedReport(foundReport || null);
      setSelectedReportId(reportId);
      setOpenForum(true);
      // Hapus unread dot untuk laporan ini
      markReportRead(reportId);
    };

    window.addEventListener('ctrack:open_report_forum', handleOpenReportForum);
    return () => {
      window.removeEventListener('ctrack:open_report_forum', handleOpenReportForum);
    };
  }, [reports, canViewReports]);

  // 🟢 Listen event dari ReportForum.jsx jika laporan sudah dibaca
  useEffect(() => {
    const handleClearDot = (event) => {
      const { reportId } = event.detail || {};
      if (reportId) {
        markReportRead(reportId);
      }
    };
    window.addEventListener('ctrack:clear_report_dot', handleClearDot);
    return () => window.removeEventListener('ctrack:clear_report_dot', handleClearDot);
  }, []);

  // 🟢 Listen notifikasi laporan baru & pesan baru — tambah unread dot
  useEffect(() => {
    const handleNewReport = (e) => {
      const d = e.detail || {};
      if (d.takenTaskId === takenTaskId && d.reportId) {
        addUnreadReport(d.reportId);
      }
    };
    const handleNewMessage = (e) => {
      const d = e.detail || {};
      if (d.takenTaskId === takenTaskId && d.reportId) {
        addUnreadReport(d.reportId);
      }
    };

    window.addEventListener('ctrack:new_report', handleNewReport);
    window.addEventListener('ctrack:new_message', handleNewMessage);
    return () => {
      window.removeEventListener('ctrack:new_report', handleNewReport);
      window.removeEventListener('ctrack:new_message', handleNewMessage);
    };
  }, [takenTaskId]);

  const handleUserSelect = (userId) => {
    setSelectedUserId(userId);
    // When clearing filter (empty userId), immediately notify with no locations
    if (!userId && onLocationFilterChange) {
      onLocationFilterChange(null, []);
    }
  };

  return (
    <>
      <div className="activity-panel">
        {/* Summary Stats Bar */}
        <div className="activity-summary-bar">
          <div className="summary-stat">
            <span className="summary-value">{totalMembers ?? (allUsers?.length ?? 0)}</span>
            <span className="summary-label">Anggota</span>
          </div>
          <div className="summary-divider"></div>
          <div className="summary-stat">
            <span className="summary-value">{reports.length}</span>
            <span className="summary-label">Laporan</span>
          </div>
          <div className="summary-divider"></div>
          <div className="summary-stat">
            <span className="summary-value">{locations.length}</span>
            <span className="summary-label">Lokasi</span>
          </div>
        </div>

        {/* Header with Tabs */}
        <div className="activity-header">
          <div className="activity-tabs">
            {canViewReports && (
            <button
              className={`tab-button ${currentTab === 'reports' ? 'active' : ''}`}
              onClick={() => setActiveTab('reports')}
            >
              <img src="/icon/Brief.png" alt="Laporan" className="tab-icon" />
              <span className="tab-label">Laporan</span>
              <span className="tab-badge">{reports.length}</span>
            </button>
            )}
            {canViewLocations && (
            <button
              className={`tab-button ${currentTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <img src="/icon/Address.png" alt="Riwayat Lokasi" className="tab-icon" />
              <span className="tab-label">Riwayat Lokasi</span>
              <span className="tab-badge">{locations.length}</span>
            </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="activity-content">
          {loading ? (
            <div className="activity-loading">
              <div className="spinner"></div>
              <p>Memuat data...</p>
            </div>
          ) : !canViewReports && !canViewLocations ? (
            <div className="activity-loading">
              <p>Anda tidak memiliki akses untuk melihat laporan atau lokasi.</p>
            </div>
          ) : currentTab === 'reports' ? (
            // REPORTS TAB
            selectedReport ? (
              // Report Detail View
              <div className="report-detail-view">
                <button className="back-button-detail" onClick={handleBackToList}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ marginRight: '4px' }}>
                    <path d="M15 10H5M5 10L10 15M5 10L10 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span style={{ fontWeight: 600 }}>Kembali</span>
                </button>

                <div className="report-detail-id-block">
                  <span className="id-text">{selectedReport.ticketNumber || 'RPT-' + selectedReport.reportId}</span>
                </div>

                <div className="report-detail-date-block">
                  <div className="date-icon-wrapper">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                  </div>
                  <div className="date-content">
                    <span className="date-label">Tanggal</span>
                    <span className="date-value">{formatDate(selectedReport.createdAt)} • {formatTime(selectedReport.createdAt)}</span>
                  </div>
                </div>

                <div className="report-forum-block">
                  <div className="forum-title-group">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    <span className="forum-title">Forum Diskusi</span>
                  </div>
                  <button
                    className="btn-buka-forum"
                    onClick={() => {
                      setSelectedReportId(selectedReport.reportId);
                      setOpenForum(true);
                      // Hapus unread dot saat forum dibuka
                      markReportRead(selectedReport.reportId);
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    Buka Forum Diskusi
                    {unreadReportIds.has(selectedReport?.reportId) && (
                      <span className="forum-btn-unread-dot" />
                    )}
                  </button>
                </div>

                <div className="report-detail-cards-container">
                  <div className="report-detail-card">
                    <div className="card-header">Pelapor</div>
                    <div className="card-body">
                      <div className="team-member-item">
                        <UserAvatar
                          userId={selectedReport.user?.id}
                          userName={selectedReport.user?.name || 'Unknown'}
                          size="medium"
                        />
                        <div className="member-info">
                          <span className="member-name">{selectedReport.user?.name || 'Unknown'}</span>
                          <span className="member-role">{selectedReport.user?.email || ''}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="report-detail-card">
                    <div className="card-header">Deskripsi Laporan</div>
                    <div className="card-body">
                      <p className="description-text">{selectedReport.report || 'Tidak ada deskripsi'}</p>
                    </div>
                  </div>

                  {(() => {
                    const photos = getPhotos(selectedReport);
                    return photos.length > 0 && (
                      <div className="report-detail-card">
                        <div className="card-header">Foto Dokumentasi</div>
                        <div className="card-body photo-body">
                          {photos.map((imagePath, idx) => {
                            const fullImageUrl = `${STORAGE_BASE_URL}/uploads/reports/${imagePath}`;
                            const isErrored = imageErrors.has(imagePath);

                            return (
                              <div
                                key={idx}
                                className="photo-full-item"
                                onClick={() => !isErrored && handleImageClick(imagePath)}
                              >
                                <img
                                  ref={attachLazyLoad}
                                  data-src={fullImageUrl}
                                  src={isErrored ? '/icon/image-placeholder.png' : undefined}
                                  alt={`Report ${idx + 1}`}
                                  className="photo-full"
                                  loading="lazy"
                                  onError={(e) => handleImageError(e, imagePath)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : reports.length === 0 ? (
              <div className="activity-empty">
                <span className="empty-icon">📋</span>
                <p>Belum ada laporan</p>
                <span className="empty-subtitle">Laporan akan muncul ketika anggota tim mengirimkan</span>
              </div>
            ) : (
              // Reports List
              <div className="reports-list">
                {reports.map((report) => (
                  <div
                    key={report.reportId}
                    className={`report-card${unreadReportIds.has(report.reportId) ? ' report-card-unread' : ''}`}
                    onClick={() => handleReportClick(report)}
                  >
                    <div className="report-card-header">
                      <UserAvatar
                        userId={report.user?.id}
                        userName={report.user?.name || 'Unknown'}
                        size="medium"
                      />
                      <div className="report-card-info">
                        <span className="report-card-id">
                          {report.ticketNumber || 'RPT-' + report.reportId}
                        </span>
                        <span className="report-card-user">{report.user?.name || 'Unknown'}</span>
                        <span className="report-card-time">{formatDate(report.createdAt)} · {formatTime(report.createdAt)}</span>
                      </div>
                      {/* 🟢 UNREAD DOT */}
                      {unreadReportIds.has(report.reportId) && (
                        <span className="report-card-unread-dot" title="Ada notifikasi baru" />
                      )}
                      <svg className="chevron-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>

                    <div className="report-card-preview">
                      <p>{report.report ? report.report.substring(0, 80) + (report.report.length > 80 ? '...' : '') : 'Tidak ada deskripsi'}</p>
                    </div>

                    {(() => {
                      const photos = getPhotos(report);
                      return photos.length > 0 && (
                        <div className="report-card-footer">
                          <span className="photo-indicator">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
                              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                              <circle cx="12" cy="13" r="4"></circle>
                            </svg>
                            {photos.length} Foto
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )
          ) : (
            // LOCATION LOGS TAB
            <div className="location-logs-container">
              {/* User Filter */}
              <div className="location-user-filter">
                <label htmlFor="location-user-select">Pilih User:</label>
                <select
                  id="location-user-select"
                  value={selectedUserId}
                  onChange={(e) => handleUserSelect(e.target.value)}
                  className="location-user-select"
                >
                  <option value="">Semua User</option>
                  {allUsers?.map(user => (
                    <option key={user.id} value={user.id}>
                      {userStatuses?.[user.id] === 'completed' ? `✓ ${user.name} (Selesai)` : user.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Selected user completion status badge */}
              {selectedUserId && userStatuses?.[selectedUserId] === 'completed' && (
                <div className="location-user-status-bar">
                  <span className="location-status-done">✓ User ini telah menyelesaikan tugasnya</span>
                </div>
              )}

              {!selectedUserId ? (
                <div className="activity-empty">
                  {/* <span className="">📍</span> */}
                  <img src="/icon/Worldwide.png" alt="Laporan" className="empty-icon" />
                  <p>Menampilkan semua user di peta</p>
                  <span className="empty-subtitle">Pilih user dari dropdown untuk melihat riwayat lokasi</span>
                </div>
              ) : locationsLoading ? (
                <div className="activity-loading">
                  <div className="spinner"></div>
                  <p>Memuat riwayat lokasi...</p>
                </div>
              ) : userLocations.length === 0 ? (
                <div className="activity-empty">
                  <span className="empty-icon">📍</span>
                  <p>Belum ada riwayat lokasi</p>
                  <span className="empty-subtitle">User belum mencatat lokasi</span>
                </div>
              ) : (
                <div className="location-timeline">
                  {userLocations.map((location, index) => {
                    const user = getUserInfo(location.userId);
                    const isLatest = index === 0;



                    return (
                      <div
                        key={location.locationId || index}
                        className="location-entry clickable"
                        onClick={() => onLocationClick && onLocationClick(location)}
                        title="Klik untuk lihat di peta"
                      >
                        <div className="location-time">
                          {formatTime(location.recordedAt)}
                        </div>

                        <div className="location-marker">
                          <div className={`marker-dot ${isLatest ? 'latest' : ''}`}>
                            {isLatest && '✓'}
                          </div>
                          {index < userLocations.length - 1 && (
                            <div className="marker-line"></div>
                          )}
                        </div>

                        <div className="location-details">
                          <div className="location-address">{formatAddress(location)}</div>
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
              )}
            </div>
          )}
        </div>
        {openForum && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              justifyContent: "center",
              alignItems: isMobile ? "flex-end" : "center", // 🔥 RESPONSIVE
              zIndex: 9999
            }}
            onClick={() => setOpenForum(false)}
          >
            <div
              style={{
                background: "white",
                width: isMobile ? "100%" : "700px",
                height: "90vh",
                maxHeight: "90vh",
                display: "flex",
                flexDirection: "column",
                borderRadius: isMobile ? "16px 16px 0 0" : "12px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
                overflow: "hidden"
              }}
              onClick={(e) => e.stopPropagation()}
            >

              {/* 🔥 HEADER */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "16px 24px",
                  borderBottom: "1px solid #e5e7eb",
                  background: "#ffffff"
                }}
              >
                <h3 style={{ fontSize: "20px", fontWeight: "500", display: "flex", alignItems: "center", gap: "10px", margin: 0, color: "#111827", maxWidth: "85%" }} title={selectedReport?.report || "Forum Diskusi"}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedReport?.report || "Forum Diskusi"}
                  </span>
                </h3>
                <button
                  onClick={() => setOpenForum(false)}
                  style={{ cursor: "pointer", background: "none", border: "none", color: "#111827", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              {/* 🔥 ISI FORUM */}
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <ReportForum reportId={selectedReportId} takenTaskId={takenTaskId} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <div className="image-modal-overlay" onClick={closeImageModal}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={closeImageModal}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <img
              src={imageErrors.has(selectedImage) ? '/icon/image-placeholder.png' : `${STORAGE_BASE_URL}/uploads/reports/${selectedImage}`}
              alt="Full size report"
              className="modal-image"
              onError={(e) => handleImageError(e, selectedImage)}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default ActivityPanel;
