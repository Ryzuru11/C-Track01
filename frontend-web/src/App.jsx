import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import Login from './pages/Login/Login'
import Dashboard from './pages/Dashboard/Dashboard'
import Monitoring from './pages/Monitoring/Monitoring'
import Task from './pages/Task/Task'
import Taken from './pages/Taken/Taken'
import UserManagement from './pages/UserManagement/UserManagement'
import Analytics from './pages/Analytics/Analytics'
import Chatbot from './pages/Chatbot/Chatbot'
import TeamManagement from './pages/TeamManagement/TeamManagement'
import RoleManagement from './pages/RoleManagement/RoleManagement'
import ProtectedRoute from './components/ProtectedRoute'
import { RBAC_CHANGED_EVENT, checkSession, firstAllowedPath } from './utils/auth'
import './App.css'

// =========================================================
// 🔥 IMPORT SOCKET.IO, TOAST NOTIFICATION & API (COMBINED)
// =========================================================
import { io } from 'socket.io-client'
import { ToastContainer, toast } from 'react-toastify'
import { getUserAvatar, refreshCurrentUser } from './services/api'
import 'react-toastify/dist/ReactToastify.css'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://202.169.232.241:8017";

// ── CUSTOM TOAST COMPONENT FOR NEW MESSAGES & REPORTS ──────────
const shownReportToasts = new Set();

const CustomToast = ({ type, data, closeToast, onNavigate }) => {
  const [avatar, setAvatar] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const sId = data.senderId || data.userId;
    if (sId) {
      getUserAvatar(sId)
        .then((avatarData) => {
          if (isMounted) setAvatar(avatarData);
        })
        .catch(() => { });
    }
    return () => {
      isMounted = false;
    };
  }, [data.senderId, data.userId]);

  const formatToastDate = (dateStr) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    return date.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).replace(/\./g, ':');
  };

  const getInitials = (name) => {
    if (!name) return "?";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
  };

  const formatAvatarSrc = (avatarData) => {
    if (!avatarData) return null;
    if (avatarData.startsWith('data:image')) return avatarData;
    return `data:image/jpeg;base64,${avatarData}`;
  };

  const handleClickLihat = (e) => {
    e.stopPropagation();
    if (data.takenTaskId && data.reportId) {
      onNavigate(`/monitoring/${data.takenTaskId}?reportId=${data.reportId}`);
    } else if (data.takenTaskId) {
      onNavigate(`/monitoring/${data.takenTaskId}`);
    }
    if (closeToast) closeToast();
  };

  const isReport = type === 'report';
  const titleText = isReport ? 'Laporan Baru' : 'Pesan Baru';
  const senderName = data.senderName || data.userName;
  const messageContent = data.message || data.reportContent;

  return (
    <div className="toast-new-msg-container">
      {/* Header */}
      <div className="toast-new-msg-header">
        <div className="toast-new-msg-title-wrap">
          {isReport ? (
            <svg className="toast-new-msg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          ) : (
            <svg className="toast-new-msg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 10.742h.008v.008h-.008v-.008zM12 10.742h.008v.008H12v-.008zM15.316 10.742h.008v.008h-.008v-.008zM21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          )}
          <span className="toast-new-msg-title">{titleText}</span>
        </div>
        <button className="toast-new-msg-close" onClick={(e) => { e.stopPropagation(); closeToast(); }}>
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="toast-new-msg-body">
        <div className="toast-new-msg-sender-info">
          <div className="toast-new-msg-sender-name">{senderName}</div>
          <div className="toast-new-msg-date">{formatToastDate(data.createdAt)}</div>
        </div>

        <div className="toast-new-msg-avatar-wrap">
          {avatar ? (
            <img src={formatAvatarSrc(avatar)} alt={senderName} className="toast-new-msg-avatar" />
          ) : (
            <div className="toast-new-msg-avatar-placeholder">
              {getInitials(senderName)}
            </div>
          )}
        </div>
      </div>

      {/* Message box */}
      <div className="toast-new-msg-content-box">
        {messageContent}
      </div>

      {/* Footer Link */}
      <div className="toast-new-msg-footer">
        <button className="toast-new-msg-link-btn" onClick={handleClickLihat}>
          {isReport ? 'Lihat Laporan' : 'Lihat Pesan'}
        </button>
      </div>
    </div>
  );
};

// ── CUSTOM TOAST: Tugas Selesai ─────────────────────────────────
const TaskCompletedToast = ({ data, closeToast, onNavigate }) => {
  const formatToastDate = (dateStr) => {
    const date = dateStr ? new Date(dateStr) : new Date();
    return date.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).replace(/\./g, ':');
  };

  const handleClickLihatTaken = (e) => {
    e.stopPropagation();
    const takenTaskId = data.takenTaskId || data.takenId;
    if (takenTaskId) {
      onNavigate(`/monitoring/${takenTaskId}`);
    }
    if (closeToast) closeToast();
  };

  const taskTitle = data.taskName || data.message || 'Tugas Selesai';
  const taskDescription = data.description || data.ticketNumber ? `Tiket: ${data.ticketNumber}` : '';

  return (
    <div className="toast-new-msg-container">
      {/* Header */}
      <div className="toast-new-msg-header">
        <div className="toast-new-msg-title-wrap">
          <svg className="toast-task-done-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 11l3 3L22 4" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <span className="toast-new-msg-title">Tugas Selesai</span>
        </div>
        <button className="toast-new-msg-close" onClick={(e) => { e.stopPropagation(); closeToast(); }}>
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="toast-new-msg-body">
        <div className="toast-new-msg-sender-info">
          <div className="toast-new-msg-sender-name">{taskTitle}</div>
          <div className="toast-new-msg-date">{formatToastDate(data.completedAt || data.createdAt)}</div>
        </div>
        <div className="toast-task-done-avatar-wrap">
          <div className="toast-task-done-check-circle">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Description box */}
      {taskDescription && (
        <div className="toast-new-msg-content-box">
          {taskDescription}
        </div>
      )}

      {/* Footer Link */}
      <div className="toast-new-msg-footer">
        <button className="toast-new-msg-link-btn" onClick={handleClickLihatTaken}>
          Lihat Taken
        </button>
      </div>
    </div>
  );
};

// ── HELPER: Simpan reportId ke localStorage agar dot hijau muncul saat ActivityPanel mount ──
const persistUnreadReport = (takenTaskId, reportId) => {
  if (!takenTaskId || !reportId) return;
  // Jangan tambah jika forum untuk laporan ini sedang aktif dilihat user
  if (window.__ctrackActiveReportForumId === reportId) return;
  try {
    const key = `ctrack:unread_reports:${takenTaskId}`;
    const stored = localStorage.getItem(key);
    const ids = stored ? JSON.parse(stored) : [];
    if (!ids.includes(reportId)) {
      ids.push(reportId);
      localStorage.setItem(key, JSON.stringify(ids));
    }
  } catch (e) { }
};

// ── SOCKET LISTENER COMPONENT UNDER ROUTER CONTEXT ─────────────
function SocketListener() {
  const navigate = useNavigate();
  // Reconnect the socket when the session token changes (e.g. right after login)
  const [token, setToken] = useState(() => localStorage.getItem("token"));

  useEffect(() => {
    const syncToken = () => setToken(localStorage.getItem("token"));
    window.addEventListener(RBAC_CHANGED_EVENT, syncToken);
    return () => window.removeEventListener(RBAC_CHANGED_EVENT, syncToken);
  }, []);

  useEffect(() => {
    const authDataString = localStorage.getItem('auth_data') || localStorage.getItem('user');
    let userId = localStorage.getItem('userId');

    // Parsing userId jika belum tersedia langsung di localStorage
    if (authDataString && !userId) {
      try {
        const user = JSON.parse(authDataString);
        userId = user.id || user.userId;
      } catch (e) {
        console.log("Error parsing user data", e);
      }
    }

    // Cek apakah lagi koding di laptop (development) atau sudah rilis (production)
    const isProduction = import.meta.env.MODE === 'production';

    // Inisialisasi Socket (Konfigurasi Dinamis)
    const socket = io(SOCKET_URL, {
      auth: token ? { token } : undefined,
      transports: isProduction ? ["websocket"] : ["polling", "websocket"],
    });

    socket.on("connect", () => {
      console.log("🌐 Global socket connected:", socket.id);

      // Jika user terverifikasi memiliki ID, masukkan ke room privat demi sinkronisasi data
      if (userId) {
        socket.emit('join', `user:${userId}`);
        console.log(`🔑 Bergabung ke room privat: user:${userId}`);
      }
    });

    socket.on("disconnect", () => {
      console.log("🌐 Global socket disconnected");
    });

    // RADAR MONITORING: Memantau pergerakan lalu lintas data socket di F12 Console
    socket.onAny((eventName, data) => {
      console.log(`🔍 [SOCKET RADAR] Sinyal masuk: "${eventName}"`, data);
    });

    // 🎧 LINTASAN 1A: Tangkap Notifikasi Pesan / Komentar Baru (Dari Controller Lama)
    socket.on('chat:new_message', (data) => {
      console.log('Pesan baru masuk (chat:new_message):', data);

      // Dispatch custom event for Taken.jsx badge tracking
      window.dispatchEvent(new CustomEvent('ctrack:new_message', { detail: data }));
      // 🟢 Simpan ke localStorage agar ActivityPanel bisa tampilkan dot saat mount
      if (data?.takenTaskId && data?.reportId) {
        persistUnreadReport(data.takenTaskId, data.reportId);
      }

      // Custom styled toast for new message
      toast(({ closeToast }) => (
        <CustomToast type="chat" data={data} closeToast={closeToast} onNavigate={navigate} />
      ), {
        position: "top-right",
        autoClose: 8000,
        hideProgressBar: true,
        closeOnClick: false,
        closeButton: false,
        className: "custom-toast-message-card",
      });
    });

    // 🎧 LINTASAN 1B: Tangkap Notifikasi Baru (Dari Controller Baru)
    socket.on('notification:new', (data) => {
      console.log('Notifikasi baru masuk (notification:new):', data);

      // Jangan tampilkan toast info jika notifikasi tersebut adalah tentang Pesan Baru / Komentar Baru
      // karena sudah ditangani oleh LINTASAN 1A (chat:new_message) dengan custom toast.
      if (data && data.title && data.title.includes("Pesan Baru")) {
        return;
      }

      if (data && data.title) {
        toast.info(data.title, {
          position: "top-right",
          autoClose: 5000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
        });
      }
    });

    // 🎧 LINTASAN 1C: Tangkap Notifikasi (Admins)
    socket.on('report:new', (data) => {
      console.log('Laporan baru masuk (report:new):', data);
      if (shownReportToasts.has(data.reportId)) return;
      shownReportToasts.add(data.reportId);
      setTimeout(() => shownReportToasts.delete(data.reportId), 5000);

      // Dispatch custom event for Taken.jsx badge tracking
      window.dispatchEvent(new CustomEvent('ctrack:new_report', { detail: data }));
      // 🟢 Simpan ke localStorage agar ActivityPanel bisa tampilkan dot saat mount
      persistUnreadReport(data?.takenTaskId, data?.reportId);

      toast(({ closeToast }) => (
        <CustomToast type="report" data={data} closeToast={closeToast} onNavigate={navigate} />
      ), {
        position: "top-right",
        autoClose: 8000,
        hideProgressBar: true,
        closeOnClick: false,
        closeButton: false,
        className: "custom-toast-message-card",
      });
    });

    // 🎧 LINTASAN 1D: Tangkap Notifikasi Laporan Baru (Employees)
    socket.on('report:created', (data) => {
      console.log('Laporan baru dibuat (report:created):', data);
      if (shownReportToasts.has(data.reportId)) return;
      shownReportToasts.add(data.reportId);
      setTimeout(() => shownReportToasts.delete(data.reportId), 5000);

      // Dispatch custom event for Taken.jsx badge tracking
      window.dispatchEvent(new CustomEvent('ctrack:new_report', { detail: data }));

      toast(({ closeToast }) => (
        <CustomToast type="report" data={data} closeToast={closeToast} onNavigate={navigate} />
      ), {
        position: "top-right",
        autoClose: 8000,
        hideProgressBar: true,
        closeOnClick: false,
        closeButton: false,
        className: "custom-toast-message-card",
      });
    });

    // 🎧 LINTASAN 2: Tangkap Notifikasi Tugas Selesai dari Karyawan
    socket.on('admin:task_completed', (data) => {
      console.log('Tugas selesai:', data);
      toast(({ closeToast }) => (
        <TaskCompletedToast data={data} closeToast={closeToast} onNavigate={navigate} />
      ), {
        position: "top-right",
        autoClose: 8000,
        hideProgressBar: true,
        closeOnClick: false,
        closeButton: false,
        className: "custom-toast-message-card",
      });
    });

    // 🎧 LINTASAN 3: Tangkap Notifikasi Tugas Baru Berhasil Didelegasikan
    socket.on('admin:task_assigned', (data) => {
      console.log('Tugas baru didelegasikan:', data);
      toast.success(`📋 Tugas Baru Ditugaskan ke ${data.employeeName}! (Tiket: ${data.ticketNumber})`, {
        position: "top-right",
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        style: { backgroundColor: '#1E1E24', color: '#FFFFFF' }
      });
    });

    // 🔐 RBAC: role permissions / role assignment changed → resync access live
    socket.on('rbac:updated', async (data) => {
      console.log('RBAC diperbarui (rbac:updated):', data);
      try {
        await refreshCurrentUser();
      } catch (error) {
        console.error('Gagal memuat ulang hak akses:', error);
      } finally {
        // Ask the server to rebuild this socket's perm:* rooms
        socket.emit('rbac:refresh');
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [navigate, token]);

  return null;
}

// "/" → first page the user may open (sidebar order)
function RootRedirect() {
  if (!checkSession()) return <Navigate to="/login" replace />;
  return <Navigate to={firstAllowedPath() || '/dashboard'} replace />;
}

function App() {
  return (
    <>
      <Router>
        <SocketListener />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RootRedirect />} />

          {/* Pages are gated by permission keys (utils/auth PAGE_PERMISSIONS) */}
          {/* Dashboard - dashboard.view */}
          <Route path="/dashboard" element={
            <ProtectedRoute permission="DASHBOARD">
              <Dashboard />
            </ProtectedRoute>
          } />

          {/* Task Management - tasks.view */}
          <Route path="/task" element={
            <ProtectedRoute permission="TASK">
              <Task />
            </ProtectedRoute>
          } />

          {/* Taken Tasks - assignments.view */}
          <Route path="/taken" element={
            <ProtectedRoute permission="TAKEN">
              <Taken />
            </ProtectedRoute>
          } />

          {/* Monitoring - Melacak lokasi driver & buka forum (lihat laporan / lihat lokasi) */}
          <Route path="/monitoring/:takenTaskId" element={
            <ProtectedRoute permission="MONITORING">
              <Monitoring />
            </ProtectedRoute>
          } />

          {/* User Management - users.view */}
          <Route path="/users" element={
            <ProtectedRoute permission="USER_MANAGEMENT">
              <UserManagement />
            </ProtectedRoute>
          } />

          {/* Analytics - analytics.view */}
          <Route path="/analytics" element={
            <ProtectedRoute permission="ANALYTICS">
              <Analytics />
            </ProtectedRoute>
          } />

          {/* Team Management - teams.view */}
          <Route path="/teams" element={
            <ProtectedRoute permission="TEAM_MANAGEMENT">
              <TeamManagement />
            </ProtectedRoute>
          } />

          {/* Chatbot AI Assistant - ai.use */}
          <Route path="/chatbot" element={
            <ProtectedRoute permission="CHATBOT">
              <Chatbot />
            </ProtectedRoute>
          } />

          {/* Roles & Hak Akses - roles.manage (superadmin) */}
          <Route path="/roles" element={
            <ProtectedRoute permission="ROLES">
              <RoleManagement />
            </ProtectedRoute>
          } />
        </Routes>
      </Router>

      {/* RENDER TOAST CONTAINER GLOBAL */}
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={true}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="colored"
        style={{ zIndex: 999999 }}
      />
    </>
  )
}

export default App