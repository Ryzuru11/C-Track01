import { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import "./ReportForum.css";
import UserAvatar from "./UserAvatar";

const API = import.meta.env.VITE_API_BASE_URL || 'http://202.169.232.241:8017/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://202.169.232.241:8017';
const IMAGE_BASE = `${API.replace('/api', '')}/uploads/reports`;

const parseReportImage = (raw) => {
  if (!raw) return null;
  if (raw.startsWith("data:image") || raw.startsWith("/9j")) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return `${IMAGE_BASE}/${parsed[0]}`;
  } catch (_) { }
  if (!raw.startsWith("[")) return `${IMAGE_BASE}/${raw}`;
  return null;
};

const parseReportImages = (raw) => {
  if (!raw) return [];
  if (raw.startsWith("data:image") || raw.startsWith("/9j")) return [raw];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((img) => {
        if (img.startsWith("data:image") || img.startsWith("/9j")) return img;
        return `${IMAGE_BASE}/${img}`;
      });
    }
  } catch (_) { }
  if (!raw.startsWith("[")) return [`${IMAGE_BASE}/${raw}`];
  return [];
};

// Role badge for forum comments. Every non-employee (web) role is "staff";
// the label and colour come from the role itself (RBAC v2), falling back to "Staff".
// "employee" is the only mobile role, so it is the one name checked here.
const getRoleInfo = (user) => {
  const roles = user?.modelHasRoles || [];
  const role = roles.length > 0 ? roles[0]?.role : null;
  const roleName = role?.name?.toLowerCase() || "";
  const isStaff = !!roleName && roleName !== "employee";
  return {
    isStaff,
    label: isStaff ? (role?.displayName || "Staff") : "",
    color: isStaff ? (role?.color || null) : null,
  };
};

// ── Delete Confirmation Dialog ────────────────────────────────
const DeleteConfirmDialog = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;
  return (
    <div className="delete-dialog-overlay">
      <div className="delete-dialog-container">
        <div className="delete-dialog-content">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p>Hapus pesan ini?</p>
        </div>
        <div className="delete-dialog-actions">
          <button className="delete-dialog-btn cancel" onClick={onClose}>Batal</button>
          <button className="delete-dialog-btn confirm" onClick={() => { onConfirm(); onClose(); }}>Hapus</button>
        </div>
      </div>
    </div>
  );
};

// ── Read Status Checkmarks (WhatsApp style) ───────────────────
// readStatus: "sending" | "sent" | "delivered" | "read"
const ReadCheckmarks = ({ readStatus }) => {
  if (!readStatus || readStatus === "sending") return null;

  if (readStatus === "sent") {
    // Centang 1 (abu-abu)
    return (
      <span className="rf-check rf-check--sent" title="Terkirim">
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <path d="M1 5.5L5 9.5L15 1.5" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (readStatus === "delivered") {
    // Centang 2 abu-abu
    return (
      <span className="rf-check rf-check--delivered" title="Diterima">
        <svg width="20" height="11" viewBox="0 0 20 11" fill="none">
          <path d="M1 5.5L5 9.5L15 1.5" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 5.5L10 9.5L20 1.5" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (readStatus === "read") {
    // Centang 2 biru
    return (
      <span className="rf-check rf-check--read" title="Dibaca semua">
        <svg width="20" height="11" viewBox="0 0 20 11" fill="none">
          <path d="M1 5.5L5 9.5L15 1.5" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 5.5L10 9.5L20 1.5" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  return null;
};

// ── Typing Indicator ─────────────────────────────────────────
const TypingIndicator = ({ typingUsers }) => {
  if (!typingUsers || typingUsers.length === 0) return null;

  const names = typingUsers.map((u) => u.userName).join(", ");
  const label = typingUsers.length === 1
    ? `${names} sedang mengetik`
    : `${names} sedang mengetik`;

  return (
    <div className="rf-typing-indicator">
      <div className="rf-typing-bubble">
        <span className="rf-typing-dot" />
        <span className="rf-typing-dot" />
        <span className="rf-typing-dot" />
      </div>
      <span className="rf-typing-text">{label}...</span>
    </div>
  );
};

// ── Hitung read status sebuah comment ─────────────────────────
// expectedReaders: array userId yang harus baca (semua peserta selain pengirim)
// ── Hitung status centang comment ─────────────────────────────
const getReadStatus = (comment, currentUserId, expectedReaderIds = [], onlineParticipantIds = [], adminParticipantIds = []) => {
  if (!currentUserId || comment.userId !== currentUserId) return null;

  const readers = comment.commentReads?.map((r) => String(r.userId)) || [];
const otherParticipants = expectedReaderIds.map(String).filter((id) => id !== String(comment.userId));
  if (otherParticipants.length === 0) return "sent";

  // Sender is staff (any non-employee role) → every employee participant must read it
  const senderIsAdmin = getRoleInfo(comment.user).isStaff;
  const adminIds = adminParticipantIds.map(String);

  let isRead;
  if (senderIsAdmin) {
    // Admin kirim → semua employer harus baca
    const employerParticipants = otherParticipants.filter(id => !adminIds.includes(id));
    isRead = employerParticipants.length === 0 
      ? otherParticipants.every(id => readers.includes(id))
      : employerParticipants.every(id => readers.includes(id));
  } else {
    // Employer kirim → cukup 1 admin baca
    const adminReaders = adminIds.filter(id => id !== String(comment.userId));

    console.log("EMPLOYER SEND CHECK", {
      adminIds,
      adminReaders,
      readers,
      commentUserId: String(comment.userId),
      match: adminReaders.filter(id => readers.includes(id)),
    });
    isRead = adminReaders.length > 0
      ? adminReaders.some(id => readers.includes(id))
      : otherParticipants.some(id => readers.includes(id));
  }

  if (isRead) return "read";

  const anyOnline = otherParticipants.some(id => onlineParticipantIds.includes(id));
  if (anyOnline) return "delivered";

  return "sent";
};




// ═════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════
export default function ReportForum({ reportId, takenTaskId }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [status, setStatus] = useState("OPEN");
  const [topic, setTopic] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const [replyToId, setReplyToId] = useState(null);
  const [replyToContent, setReplyToContent] = useState("");
  const [replyToType, setReplyToType] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [editImage, setEditImage] = useState(null);

  const [imageBase64, setImageBase64] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadError, setUploadError] = useState(false);
  const fileInputRef = useRef(null);

  const [deleteDialog, setDeleteDialog] = useState({ isOpen: false, commentId: null });

  // ── Typing state ──────────────────────────────────────────
  const [typingUsers, setTypingUsers] = useState([]); // [{userId, userName}]
  const typingTimerRef = useRef(null);
  const isTypingRef = useRef(false);
  const [onlineParticipantIds, setOnlineParticipantIds] = useState([]);
  const [adminParticipantIds, setAdminParticipantIds] = useState([]);  // ← tambah ini
  
  // ── Expected readers (peserta forum) ─────────────────────
  const [expectedReaderIds, setExpectedReaderIds] = useState([]);


  // ── Socket ref & Scroll refs ─────────────────────────────
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const initialScrollDone = useRef(false);
  const justSentRef = useRef(false);

  const isClosed = status === "DONE" || status === "completed" || status === "COMPLETED";

  // ── Init user dari token ──────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        setCurrentUserId(payload.userId || null);
      } catch (_) { }
    }
  }, []);

  // ── Fetch comments ────────────────────────────────────────
  const fetchComments = useCallback(async () => {


    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(`${API}/comments/${reportId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      console.log("onlineParticipantIds =", res.data.onlineParticipantIds);
      console.log("participantIds =", res.data.participantIds);
      console.log("commentReads sample =", res.data.comments?.[0]?.commentReads);
      setStatus(res.data.status || "OPEN");
      setTopic(res.data.report || null);

      setComments(
        Array.isArray(res.data)
          ? res.data
          : res.data.comments || []
      );

      // Fix: set participantIds ke state
      if (res.data.participantIds) {
        setExpectedReaderIds(res.data.participantIds);
      }

      if (res.data.onlineParticipantIds) {
        setOnlineParticipantIds(res.data.onlineParticipantIds);
      }
      
      if (res.data.adminParticipantIds) setAdminParticipantIds(res.data.adminParticipantIds);  // ← tambah ini
      
      console.log("PARTICIPANTS =", res.data.participantIds);
      setIsLoaded(true);

    } catch (err) {
      console.error(err);
      setIsLoaded(true); // Pastikan state tetap true walau error, agar initial scroll selesai
    }


  }, [reportId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // ── Fetch forum participants (untuk expectedReaders) ──────


  // ── Socket.io setup ───────────────────────────────────────
  useEffect(() => {
    if (!currentUserId) return;

    const token = localStorage.getItem("token");
    const s = io(SOCKET_URL, {
      auth: { token },
      query: { userId: currentUserId },
      transports: ["websocket"],
    });
    socketRef.current = s;

    s.on("connect", () => {
      s.emit("forum:join", { reportId, userId: currentUserId });
    });

    // Terima comment baru via socket (lebih cepat dari polling)
    s.on("forum:new_comment", () => {
      fetchComments();
    });

    // Comment diupdate
    s.on("forum:comment_updated", () => {
      fetchComments();
    });

    // Comment dihapus
    s.on("forum:comment_deleted", () => {
      fetchComments();
    });

    // Read receipt dari orang lain
    s.on("forum:read_receipt", ({ reader }) => {
      if (reader?.id !== currentUserId) {
        fetchComments(); // refresh untuk update reads[]
      }
    });

    // Typing indicator
    s.on("forum:typing", ({ userId, userName, isTyping }) => {
      if (userId === currentUserId) return;
      setTypingUsers((prev) => {
        if (isTyping) {
          // Tambah jika belum ada
          if (prev.find((u) => u.userId === userId)) return prev;
          return [...prev, { userId, userName }];
        } else {
          return prev.filter((u) => u.userId !== userId);
        }
      });
    });

    return () => {
      s.emit("forum:leave", { reportId });
      // s.disconnect();
    };
  }, [currentUserId, reportId, fetchComments]);

  // ── Mark as read saat masuk forum ────────────────────────
  useEffect(() => {
    if (!currentUserId || !reportId) return;
    const markRead = async () => {
      try {
        const token = localStorage.getItem("token");
        await axios.post(
          `${API}/comments/read`,
          { reportId },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch (_) { }
    };
    markRead();

    // Clear the unread badge HANYA untuk laporan ini (reportId), bukan seluruh takenTaskId
    // Ini memastikan laporan lain yang belum dibaca tetap menampilkan badge
    if (takenTaskId) {
      try {
        const val = localStorage.getItem('ctrack:unread_store');
        const store = val ? JSON.parse(val) : {};
        let currentVal = store[takenTaskId];

        // Kompatibilitas dengan nilai lama berupa angka
        if (typeof currentVal === 'number' && currentVal > 0) {
          store[takenTaskId] = currentVal - 1;
          if (store[takenTaskId] <= 0) delete store[takenTaskId];
        }
        // Logika array reportId (transisi sebelumnya)
        else if (Array.isArray(currentVal) && currentVal.includes(reportId)) {
          store[takenTaskId] = currentVal.filter(id => id !== reportId);
          if (store[takenTaskId].length === 0) delete store[takenTaskId];
        }
        // Logika baru berupa Object { reportId: count }
        else if (typeof currentVal === 'object' && currentVal !== null && !Array.isArray(currentVal)) {
          if (currentVal[reportId]) {
            const nextMap = { ...currentVal };
            delete nextMap[reportId];
            if (Object.keys(nextMap).length === 0) {
              delete store[takenTaskId];
            } else {
              store[takenTaskId] = nextMap;
            }
          }
        }

        // Simpan hanya jika ada perubahan (nilai dihapus atau dikurangi)
        if (JSON.stringify(store[takenTaskId]) !== JSON.stringify(currentVal)) {
          localStorage.setItem('ctrack:unread_store', JSON.stringify(store));
          window.__ctrackUnreadStore = store;
          window.dispatchEvent(new CustomEvent('ctrack:unread_total_updated', {
            detail: { counts: store }
          }));
        }
      } catch (e) {
        console.error('Error clearing unread count:', e);
      }
    }

    // 🔥 Beritahu ActivityPanel untuk hapus dot hijau
    window.dispatchEvent(new CustomEvent('ctrack:clear_report_dot', {
      detail: { reportId }
    }));

    // Juga mark saat fokus window kembali
    const onFocus = () => markRead();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [currentUserId, reportId, takenTaskId]);

  // Track the active report forum ID to suppress socket badges on the active chat
  useEffect(() => {
    if (reportId) {
      window.__ctrackActiveReportForumId = reportId;
    }
    return () => {
      if (window.__ctrackActiveReportForumId === reportId) {
        window.__ctrackActiveReportForumId = null;
      }
    };
  }, [reportId]);

  // ── Auto-scroll to bottom on new message ─────────────────
  useEffect(() => {
    if (!messagesContainerRef.current) return;
    const container = messagesContainerRef.current;

    // 1. Jika baru pertama kali load (data sudah selesai di-fetch)
    if (!initialScrollDone.current && isLoaded) {
      initialScrollDone.current = true;

      if (comments.length > 0) {
        // Flatten all comments and their nested replies
        const allCommentsFlat = [];
        const flatten = (list) => {
          if (!list || !Array.isArray(list)) return;
          for (const c of list) {
            allCommentsFlat.push(c);
            if (c.replies && c.replies.length > 0) {
              flatten(c.replies);
            }
          }
        };
        flatten(comments);

        // Sort chronologically by createdAt (oldest first) to find the first unread
        allCommentsFlat.sort((a, b) => {
          const timeA = new Date(a.createdAt || 0).getTime();
          const timeB = new Date(b.createdAt || 0).getTime();
          return timeA - timeB;
        });

        // Cari pesan pertama yang belum dibaca (yang bukan dikirim oleh current user)
        const firstUnread = allCommentsFlat.find(c => {
          const cUserId = c.userId || c.user?.id;
          const isMe = currentUserId && cUserId && String(cUserId).trim() === String(currentUserId).trim();
          const hasRead = c.commentReads && c.commentReads.some(r => String(r.userId).trim() === String(currentUserId).trim());
          return !isMe && !hasRead;
        });

        if (firstUnread) {
          setTimeout(() => {
            const el = document.getElementById(`comment-${firstUnread.commentId}`);
            if (el) el.scrollIntoView({ behavior: "auto", block: "center" });
          }, 100);
          return;
        }

        // Jika tidak ada pesan baru atau semua sudah terbaca, scroll ke bawah
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }
      return;
    }

    // 2. Jika user yang mengirim pesan (paksa scroll)
    if (justSentRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      justSentRef.current = false;
      return;
    }

    // 3. Jika user sedang men-scroll di dekat bagian bawah (toleransi 150px)
    // Hindari memaksa scroll jika user sedang melihat pesan lama di atas
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments, typingUsers, isLoaded, currentUserId]);

  // ── Typing emit ───────────────────────────────────────────
  const handleTyping = (val) => {
    setText(val);

    if (!socketRef.current || isClosed) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      const token = localStorage.getItem("token");
      axios.post(
        `${API}/comments/typing`,
        { reportId, isTyping: true },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(() => { });
    }

    // Reset timer stop-typing
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      const token = localStorage.getItem("token");
      axios.post(
        `${API}/comments/typing`,
        { reportId, isTyping: false },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(() => { });
    }, 2000);
  };

  // Stop typing saat kirim
  const stopTyping = () => {
    clearTimeout(typingTimerRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      const token = localStorage.getItem("token");
      axios.post(
        `${API}/comments/typing`,
        { reportId, isTyping: false },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(() => { });
    }
  };

  // ── Image handlers ────────────────────────────────────────
  const handleImageChange = (e, forEdit = false) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadError(false);
    const reader = new FileReader();
    reader.onloadend = () => {
      if (forEdit) setEditImage(reader.result);
      else { setImageBase64(reader.result); setImagePreview(reader.result); }
    };
    reader.onerror = () => setUploadError(true);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageBase64(null); setImagePreview(null); setUploadError(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const cancelReply = () => { setReplyToId(null); setReplyToContent(""); setReplyToType(null); };

  // ── Send comment ──────────────────────────────────────────
  const sendComment = async () => {
    const hasText = text.trim().length > 0;
    const hasImage = !!imageBase64;
    if (!hasText && !hasImage) return;
    if (isClosed) return;

    stopTyping();

    try {
      const token = localStorage.getItem("token");
      await axios.post(
        `${API}/comments`,
        {
          reportId,
          content: hasText ? text.trim() : "📷",
          parentId: replyToType === "report" ? null : (replyToId || null),
          isReplyToReport: replyToType === "report",
          image: imageBase64 || null,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setText(""); setInputKey((k) => k + 1); cancelReply(); clearImage();
      justSentRef.current = true; // Paksa scroll saat pesan terkirim
      fetchComments();

      // Mark as read setelah kirim (auto baca semua yg ada)
      setTimeout(() => {
        const token2 = localStorage.getItem("token");
        axios.post(
          `${API}/comments/read`,
          { reportId },
          { headers: { Authorization: `Bearer ${token2}` } }
        ).catch(() => { });
      }, 500);
    } catch (err) {
      console.error(err);
      if (imageBase64) setUploadError(true);
    }
  };

  const startEdit = (comment) => { setEditingId(comment.commentId); setEditText(comment.content); setEditImage(comment.image || null); };
  const cancelEdit = () => { setEditingId(null); setEditText(""); setEditImage(null); };

  const submitEdit = async (commentId) => {
    if (!editText.trim()) return;
    try {
      const token = localStorage.getItem("token");
      await axios.put(
        `${API}/comments/${commentId}`,
        { content: editText, image: editImage },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      cancelEdit(); fetchComments();
    } catch (err) { console.error(err); alert("Gagal menyimpan perubahan."); }
  };

  const handleDeleteClick = (commentId) => setDeleteDialog({ isOpen: true, commentId });

  const confirmDelete = async () => {
    const commentId = deleteDialog.commentId;
    if (!commentId) return;
    try {
      const token = localStorage.getItem("token");
      await axios.delete(`${API}/comments/${commentId}`, { headers: { Authorization: `Bearer ${token}` } });
      fetchComments();
    } catch (err) { console.error(err); }
  };

  const closeDeleteDialog = () => setDeleteDialog({ isOpen: false, commentId: null });

  const fmt = (dt) =>
    new Date(dt).toLocaleString("id-ID", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  const reportReplies = comments.filter((c) => c.isReplyToReport);
  const generalComments = comments.filter((c) => !c.isReplyToReport);

  // ── Render satu comment ───────────────────────────────────
  const renderComment = (comment, level = 0) => {
    const isOwnerCheck =
      currentUserId &&
      comment.userId &&
      String(comment.userId).trim() === String(currentUserId).trim();

    // ── Deleted ──────────────────────────────────────────────
    if (comment.deleted || comment.isDeleted) {
      return (
        <div key={comment.commentId} id={`comment-${comment.commentId}`} className="report-forum-comment">
          <div className="report-forum-comment-row">
            <UserAvatar userId={comment.userId || comment.user?.id} userName={comment.user?.name} size="medium" />
            <div className="report-forum-bubble deleted">
              <span className="report-forum-text small" style={{ color: "#9ca3af", fontStyle: "italic", margin: 0 }}>
                {isOwnerCheck ? "Anda menghapus pesan ini" : "Pesan ini telah dihapus"}
              </span>
            </div>
          </div>
          {comment.replies?.length > 0 && (
            <div className="report-forum-reply-thread">
              {comment.replies.map((child) => renderComment(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    const roleInfo = getRoleInfo(comment.user);
    const isOwner = isOwnerCheck;
    const isEditing = editingId === comment.commentId;
    const isEdited = comment.updatedAt && comment.updatedAt !== comment.createdAt;

    console.log("COMMENT READS =", comment.commentReads);
    // ── Read status (hanya tampil di pesan milik kita) ────────
    const readStatus = getReadStatus(comment, currentUserId, expectedReaderIds, onlineParticipantIds, adminParticipantIds);

    console.log({
      commentId: comment.commentId,
      expectedReaderIds,
      onlineParticipantIds,
      readStatus,
    });

    return (
      <div key={comment.commentId} id={`comment-${comment.commentId}`} className="report-forum-comment">
        <div className="report-forum-comment-row">
          <UserAvatar userId={comment.userId || comment.user?.id} userName={comment.user?.name} size="medium" />
          <div className={`report-forum-bubble${isOwner ? " own-bubble" : ""}`}>
            <div className="report-forum-bubble-header">
              <span className="report-forum-user-name">{comment.user?.name}</span>
              {roleInfo.isStaff && (
                <span
                  className="report-forum-role-badge admin"
                  style={roleInfo.color ? { backgroundColor: `${roleInfo.color}1f`, color: roleInfo.color } : undefined}
                >
                  {roleInfo.label.toUpperCase()}
                </span>
              )}
              <div className="report-forum-comment-meta">
                {isEdited && <span className="report-forum-edited-label">Diedit</span>}
                {fmt(comment.updatedAt || comment.createdAt)}
              </div>
            </div>

            {isEditing ? (
              <div>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="report-forum-edit-textarea"
                />
                {editImage && (
                  <div style={{ position: "relative", display: "inline-block", marginTop: 8 }}>
                    <img src={editImage} alt="preview" style={{ maxHeight: 120, borderRadius: 8 }} />
                    <button onClick={() => setEditImage(null)} style={{ position: "absolute", top: 4, right: 4, background: "#111827", color: "#fff", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 11, lineHeight: "20px" }}>×</button>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <label style={{ cursor: "pointer", fontSize: 13, color: "#6b7280", fontWeight: 500 }}>
                    📎 Ganti foto
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageChange(e, true)} />
                  </label>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button onClick={cancelEdit} style={{ fontSize: 13, padding: "6px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 500 }}>Batal</button>
                    <button onClick={() => submitEdit(comment.commentId)} style={{ fontSize: 13, padding: "6px 12px", borderRadius: 6, background: "#111827", color: "#fff", border: "none", cursor: "pointer", fontWeight: 500 }}>Simpan</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {comment.content && comment.content !== "📷" && (
                  <p className="report-forum-text small">{comment.content}</p>
                )}
                {comment.image && (
                  <img
                    src={comment.image}
                    alt="attachment"
                    className="report-forum-image"
                    onClick={() => window.open(comment.image, "_blank")}
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                )}

                {/* ── Footer: actions + checkmark ── */}
                <div className="report-forum-message-footer">
                  <div className="report-forum-actions">
                    {!isClosed && (
                      <button
                        onClick={() => { setReplyToId(comment.commentId); setReplyToContent(comment.content); setReplyToType("comment"); }}
                        className="report-forum-btn reply"
                      >
                        Balas
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
                        </svg>
                      </button>
                    )}
                    {isOwner && !isClosed && (
                      <>
                        <button onClick={() => startEdit(comment)} className="report-forum-btn edit">
                          Edit
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                          </svg>
                        </button>
                        <button onClick={() => handleDeleteClick(comment.commentId)} className="report-forum-btn delete">
                          Hapus
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>


                  {/* ── Checkmark read receipt ── */}
                  {isOwner && readStatus && (
                    <ReadCheckmarks readStatus={readStatus} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {comment.replies?.length > 0 && (
          <div className="report-forum-reply-thread">
            {comment.replies.map((child) => renderComment(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="report-forum-container">
      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={closeDeleteDialog}
        onConfirm={confirmDelete}
      />

      <div className="report-forum-messages" ref={messagesContainerRef}>
        {isClosed && (
          <div className="report-forum-closed">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Forum sudah ditutup
          </div>
        )}

        {topic && (
          <div className="report-forum-topic">
            <div className="report-forum-card">
              <div className="report-forum-card-header">
                <UserAvatar userId={topic.userId || topic.user?.id} userName={topic.user?.name} size="large" />
                <div className="report-forum-user-info">
                  <div className="report-forum-user-name">{topic.user?.name}</div>
                  <div className="report-forum-date">{fmt(topic.createdAt)}</div>
                </div>
                <div className="report-forum-badge">Laporan</div>
              </div>
              <p className="report-forum-text">{topic.content}</p>
              {topic.image && (() => {
                const imgUrls = parseReportImages(topic.image);
                if (imgUrls.length === 0) return null;
                if (imgUrls.length === 1) {
                  return (
                    <img
                      src={imgUrls[0]}
                      alt="laporan"
                      className="report-forum-image"
                      onClick={() => window.open(imgUrls[0], "_blank")}
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                  );
                }
                return (
                  <div className="report-forum-images-scroll-container">
                    {imgUrls.map((imgSrc, idx) => (
                      <img
                        key={idx}
                        src={imgSrc}
                        alt={`laporan-${idx}`}
                        className="report-forum-scroll-image"
                        onClick={() => window.open(imgSrc, "_blank")}
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                    ))}
                  </div>
                );
              })()}
              {!isClosed && (
                <button
                  onClick={() => { setReplyToId(reportId); setReplyToContent(topic.content); setReplyToType("report"); }}
                  className="report-forum-btn reply"
                >
                  Balas
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
                  </svg>
                </button>
              )}
            </div>

            {reportReplies.length > 0 && (
              <div className="report-forum-reply-thread">
                {reportReplies.map((c) => renderComment(c))}
              </div>
            )}
          </div>
        )}

        {generalComments.length > 0 && (
          <div className="report-forum-general-comments">
            {generalComments.map((c) => renderComment(c))}
          </div>
        )}

        {reportReplies.length === 0 && generalComments.length === 0 && (
          <div className="report-forum-empty">Belum ada komentar. Mulai diskusi!</div>
        )}

        {/* ── Typing indicator ── */}
        <TypingIndicator typingUsers={typingUsers} />
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ── */}
      <div className="report-forum-input-area">
        {replyToId && !isClosed && (
          <div className={`report-forum-replying-to ${replyToType === "report" ? "report" : "comment"}`}>
            <div className="report-forum-replying-content">
              <span className={`report-forum-replying-label ${replyToType === "report" ? "report" : "comment"}`}>
                {replyToType === "report" ? "📋 Membalas Laporan" : "↩ Membalas Komentar"}
              </span>
              <span className="report-forum-replying-text">{replyToContent}</span>
            </div>
            <button onClick={cancelReply} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 13, fontWeight: 500, padding: 0, flexShrink: 0 }}>batal</button>
          </div>
        )}

        {uploadError && (
          <div className="report-forum-error">
            ⚠ Gagal mengupload gambar.
            <button onClick={() => setUploadError(false)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontSize: 16, padding: 0 }}>✕</button>
          </div>
        )}

        {imagePreview && (
          <div style={{ position: "relative", display: "inline-block", marginBottom: 12 }}>
            <img src={imagePreview} alt="preview" style={{ maxHeight: 120, borderRadius: 8 }} />
            <button onClick={clearImage} style={{ position: "absolute", top: -8, right: -8, background: "#111827", color: "#fff", border: "2px solid #fff", borderRadius: "50%", width: 24, height: 24, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        )}

        {!isClosed && (
          <div className="report-forum-input-group">
            <label className="report-forum-file-label" title="Upload foto">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 4h3l2-2h6l2 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-2a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" />
              </svg>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageChange(e, false)} />
            </label>
            <input
              key={inputKey}
              value={text}
              onChange={(e) => handleTyping(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendComment()}
              placeholder={
                replyToType === "report"
                  ? "Balas laporan..."
                  : replyToId
                    ? "Balas komentar..."
                    : "Tulis Komentar"
              }
              className="report-forum-input"
            />
            <button
              onClick={sendComment}
              disabled={!text.trim() && !imageBase64}
              className="report-forum-send-btn"
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}