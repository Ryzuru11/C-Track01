import React, { useState } from 'react';
import UserAvatar from './UserAvatar';
import { STORAGE_BASE_URL } from '../../services/api';
import ReportForum from './ReportForum';
import './ReportsPanel.css';

function ReportsPanel({ reports, loading }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);

  const handleImageClick = (imagePath) => {
    setSelectedImage(imagePath);
  };

  const closeImageModal = () => {
    setSelectedImage(null);
  };

  const handleReportClick = (report) => {
    setSelectedReport(report);
  };

  const handleBackToList = () => {
    setSelectedReport(null);
  };

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

  return (
    <>
      <div className={`reports-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>

        {/* HEADER */}
        <div className="reports-header">
          {selectedReport && (
            <button className="back-button-report" onClick={handleBackToList}>
              ←
            </button>
          )}
          <h2>{selectedReport ? 'Detail Laporan' : 'Laporan'}</h2>
          <span className="reports-count">{reports.length}</span>

          <button
            className="toggle-button"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '▼' : '▲'}
          </button>
        </div>

        {isExpanded && (
          <div className="reports-content">

            {loading ? (
              <p>Loading...</p>
            ) : reports.length === 0 ? (
              <p>Belum ada laporan</p>
            ) : selectedReport ? (

              // ================= DETAIL =================
              <div className="report-detail-view">

                {/* TANGGAL */}
                <div className="report-detail-section">
                  <b>Tanggal:</b>{" "}
                  {formatDate(selectedReport.createdAt)} • {formatTime(selectedReport.createdAt)}
                </div>

                {/* USER */}
                <div className="report-detail-section">
                  <h3>Pelapor</h3>
                  <UserAvatar
                    userId={selectedReport.user?.id}
                    userName={selectedReport.user?.name}
                  />
                  <p>{selectedReport.user?.name}</p>
                </div>

                {/* DESKRIPSI */}
                <div className="report-detail-section">
                  <h3>Deskripsi</h3>
                  <p>{selectedReport.report}</p>
                </div>

                {/* 🔥 FORUM */}
                <div
                  className="report-detail-section"
                  style={{ border: "2px solid red", padding: 10 }}
                >
                  <h3>Forum Diskusi</h3>

                  {/* DEBUG */}
                  <p style={{ color: "red" }}>
                    DEBUG ID: {selectedReport?.report_id}
                  </p>

                  <ReportForum
                    reportId={selectedReport?.report_id || "test"}
                  />
                </div>

                {/* FOTO */}
                {selectedReport.photos?.length > 0 && (
                  <div className="report-detail-section">
                    <h3>Foto</h3>
                    {selectedReport.photos.map((img, i) => (
                      <img
                        key={i}
                        src={`${STORAGE_BASE_URL}/uploads/reports/${img}`}
                        width="100"
                        style={{ cursor: "pointer", marginRight: 8 }}
                        onClick={() => handleImageClick(img)}
                      />
                    ))}
                  </div>
                )}

                <button onClick={handleBackToList}>
                  ← Kembali
                </button>

              </div>

            ) : (

              // ================= LIST =================
              <div>
                {reports.map((report) => (
                  <div
                    key={report.report_id || report.id}
                    onClick={() => handleReportClick(report)}
                    style={{
                      border: "1px solid #ccc",
                      padding: 10,
                      marginBottom: 10,
                      cursor: "pointer"
                    }}
                  >
                    <b>{report.user?.name}</b>
                    <p>{report.report?.slice(0, 50)}</p>
                    <small>{formatDate(report.createdAt)}</small>
                  </div>
                ))}
              </div>

            )}

          </div>
        )}
      </div>

      {/* MODAL FOTO */}
      {selectedImage && (
        <div
          onClick={closeImageModal}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)"
          }}
        >
          <img
            src={`${STORAGE_BASE_URL}/uploads/reports/${selectedImage}`}
            style={{ maxWidth: "90%", margin: "50px auto", display: "block" }}
          />
        </div>
      )}
    </>
  );
}

export default ReportsPanel;