import { useEffect, useState, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Image, Alert, Modal, Dimensions, FlatList, StatusBar,
  Platform, Keyboard,
} from "react-native";
import { useNavigation, useLocalSearchParams, useRouter, Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { io } from "socket.io-client";
import api, { getUserAvatar } from "@/services/api";
import { IconSymbol } from '@/components/ui/icon-symbol';
import { API_BASE_URL } from "@/config/api.config";
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { showDialog } from "@/utils/alert";

const SERVER_BASE = API_BASE_URL.replace(/\/api\/?$/, "");
const IMAGE_BASE = `${SERVER_BASE}/uploads/reports`;
const { width: SCREEN_WIDTH } = Dimensions.get("window");

const parseReportImages = (raw: string | null): string[] => {
  if (!raw) return [];
  if (raw.startsWith("data:image") || raw.startsWith("/9j")) return [raw];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((img: string) =>
        img.startsWith("data:image") || img.startsWith("/9j")
          ? img
          : `${IMAGE_BASE}/${img}`
      );
    }
  } catch (_) { }
  if (!raw.startsWith("[")) return [`${IMAGE_BASE}/${raw}`];
  return [];
};

// ── Fullscreen Image Viewer ────────────────────────────────────
const ImageViewerModal = ({ images, initialIndex, visible, onClose }: {
  images: string[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}) => {
  const [currentIdx, setCurrentIdx] = useState(initialIndex);

  useEffect(() => { setCurrentIdx(initialIndex); }, [initialIndex]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar hidden />
      <View style={ivStyles.overlay}>
        <TouchableOpacity style={ivStyles.closeBtn} onPress={onClose}>
          <Text style={ivStyles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={ivStyles.counter}>{currentIdx + 1} / {images.length}</Text>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
          keyExtractor={(_, i) => String(i)}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            setCurrentIdx(idx);
          }}
          renderItem={({ item }) => (
            <View style={{ width: SCREEN_WIDTH, height: "100%", justifyContent: "center", alignItems: "center" }}>
              <Image
                source={{ uri: item }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="contain"
              />
            </View>
          )}
          showsHorizontalScrollIndicator={false}
        />
      </View>
    </Modal>
  );
};

const ivStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" },
  closeBtn: { position: "absolute", top: 48, right: 20, zIndex: 10, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  closeText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  counter: { position: "absolute", top: 56, alignSelf: "center", color: "#fff", fontSize: 14, zIndex: 10, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
});

type RoleInfo = {
  /** Any non-employee (web) role: superadmin, admin, manager or a custom role */
  isStaff: boolean;
  /** Badge text: the role's displayName, falling back to "Staff" */
  label: string;
  /** Badge colour from the role (RBAC v2), or null to use the default style */
  color: string | null;
};

const getRoleInfo = (user: any): RoleInfo => {
  const roles = user?.modelHasRoles || [];
  const role: { name?: string; displayName?: string | null; color?: string | null } | undefined = roles[0]?.role;
  const roleName = role?.name?.toLowerCase() || "";
  const isStaff = roleName !== "" && roleName !== "employee";
  return {
    isStaff,
    label: isStaff ? role?.displayName || "Staff" : "",
    color: isStaff ? role?.color || null : null,
  };
};

const getReadStatus = (comment: any, currentUserId: string | null, expectedReaderIds: string[] = [], onlineParticipantIds: string[] = [], adminParticipantIds: string[] = []) => {
  if (!currentUserId || String(comment.userId) !== String(currentUserId)) return null;

  const readers = comment.commentReads?.map((r: any) => String(r.userId)) || [];
  const otherParticipants = expectedReaderIds.map(String).filter((id) => id !== String(comment.userId));
  if (otherParticipants.length === 0) return "sent";

  const adminIds = adminParticipantIds.map(String);
  const senderIsAdmin = getRoleInfo(comment.user).isStaff;

  let isRead: boolean;
  if (senderIsAdmin) {
    const employerParticipants = otherParticipants.filter(id => !adminIds.includes(id));
    isRead = employerParticipants.length === 0
      ? otherParticipants.every(id => readers.includes(id))
      : employerParticipants.every(id => readers.includes(id));
  } else {
    const adminReaders = adminIds.filter(id => id !== String(comment.userId));
    isRead = adminReaders.length > 0
      ? adminReaders.some(id => readers.includes(id))
      : otherParticipants.some(id => readers.includes(id));
  }

  if (isRead) return "read";

  const anyOnline = otherParticipants.some(id => onlineParticipantIds.map(String).includes(id));
  if (anyOnline) return "delivered";

  return "sent";
};

const ReadCheckmarks = ({ status }: { status: string | null }) => {
  if (!status) return null;
  if (status === "sent") {
    return (
      <View style={{ marginLeft: 4 }}>
        <Text style={{ color: "#9ca3af", fontSize: 13 }}>✓</Text>
      </View>
    );
  }
  if (status === "delivered") {
    return (
      <View style={{ flexDirection: "row", marginLeft: 4 }}>
        <Text style={{ color: "#9ca3af", fontSize: 13, marginRight: -5 }}>✓</Text>
        <Text style={{ color: "#9ca3af", fontSize: 13 }}>✓</Text>
      </View>
    );
  }
  if (status === "read") {
    return (
      <View style={{ flexDirection: "row", marginLeft: 4 }}>
        <Text style={{ color: "#3b82f6", fontSize: 13, marginRight: -5 }}>✓</Text>
        <Text style={{ color: "#3b82f6", fontSize: 13 }}>✓</Text>
      </View>
    );
  }
  return null;
};

const UserAvatar = ({ user, fallbackBg, fallbackTextColor = "#fff" }: { user: any, fallbackBg: string, fallbackTextColor?: string }) => {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const userId = user?.id || user?.userId || user?.id_user;
    if (userId) {
      getUserAvatar(String(userId)).then((uri) => {
        if (isMounted && uri) setAvatarUri(uri);
      });
    }
    return () => { isMounted = false; };
  }, [user]);

  if (avatarUri) {
    return (
      <Image
        source={{ uri: avatarUri }}
        style={styles.avatar}
      />
    );
  }

  const initials = (user?.name || "?").charAt(0).toUpperCase();
  return (
    <View style={[styles.avatar, { backgroundColor: fallbackBg }]}>
      <Text style={[styles.avatarText, { color: fallbackTextColor }]}>{initials}</Text>
    </View>
  );
};

export default function ForumScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { reportId } = useLocalSearchParams();
  const insets = useSafeAreaInsets();

  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [photoOptionsForEdit, setPhotoOptionsForEdit] = useState(false);

  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [status, setStatus] = useState("OPEN");
  const [topic, setTopic] = useState<any>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyToContent, setReplyToContent] = useState<string>("");
  const [replyToType, setReplyToType] = useState<"comment" | "report" | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editImage, setEditImage] = useState<string | null>(null);

  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState(false);

  const [expectedReaderIds, setExpectedReaderIds] = useState<string[]>([]);
  const [onlineParticipantIds, setOnlineParticipantIds] = useState<string[]>([]);
  const [adminParticipantIds, setAdminParticipantIds] = useState<string[]>([]);
  const [typingUsers, setTypingUsers] = useState<{ userId: string; userName: string }[]>([]);

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const socketRef = useRef<any>(null);
  const typingTimer = useRef<any>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const commentRefs = useRef<Record<string, any>>({});
  const justSentRef = useRef(false);
  const initialScrollDoneRef = useRef(false);

  const scrollToComment = (commentId: string) => {
    const element = commentRefs.current[commentId];
    if (scrollViewRef.current && element) {
      try {
        element.measureLayout(
          scrollViewRef.current,
          (x: number, y: number) => {
            scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 60), animated: true });
          },
          (err: any) => {
            console.log("measureLayout err:", err);
          }
        );
      } catch (e) {
        console.log("measureLayout catch:", e);
      }
    }
  };

  // ── Keyboard Listeners ──────────────────────────────────────
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardVisible(true);
        setKeyboardHeight(e.endCoordinates.height);
        setTimeout(() => {
          if (editingId) {
            scrollToComment(editingId);
          } else if (replyToId && replyToType === 'comment') {
            scrollToComment(replyToId);
          } else {
            scrollViewRef.current?.scrollToEnd({ animated: true });
          }
        }, 150);
      }
    );
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardVisible(false);
        setKeyboardHeight(0);
        setTimeout(() => {
          if (editingId) {
            scrollToComment(editingId);
          } else if (replyToId && replyToType === 'comment') {
            scrollToComment(replyToId);
          } else {
            scrollViewRef.current?.scrollToEnd({ animated: true });
          }
        }, 100);
      }
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, [editingId, replyToId, replyToType]);

  const isClosed = status === "completed" || status === "DONE" || status === "COMPLETED";

  // ── Load user ─────────────────────────────────────────────
  useEffect(() => {
    const loadUser = async () => {
      try {
        const userStr = await AsyncStorage.getItem("user");
        if (userStr) {
          const user = JSON.parse(userStr);
          const uid = user?.id || user?.userId || null;
          if (uid) setCurrentUserId(String(uid));
        }
      } catch (e) { }
    };
    loadUser();
  }, []);

  // ── Fetch comments ────────────────────────────────────────
  const fetchComments = async () => {
    try {
      const res = await api.get(`/comments/${reportId}`);
      setComments(res.data.comments || []);
      setStatus(res.data.status || "OPEN");
      setTopic(res.data.report || null);
      if (res.data.participantIds) setExpectedReaderIds(res.data.participantIds);
      if (res.data.onlineParticipantIds) setOnlineParticipantIds(res.data.onlineParticipantIds);
      if (res.data.adminParticipantIds) setAdminParticipantIds(res.data.adminParticipantIds);
    } catch (err: any) {
      console.log("GET ERROR:", err.response?.data || err.message);
    }
  };

  // ── Polling + mark read ───────────────────────────────────
  useEffect(() => {
    if (!reportId) return;

    fetchComments();

    const markAsRead = async () => {
      try {
        await api.post("/comments/read", { reportId });
      } catch (err) {
        console.log("MARK READ ERROR:", err);
      }
    };

    markAsRead();

    const interval = setInterval(() => {
      fetchComments();
      markAsRead();
    }, 3000);

    return () => clearInterval(interval);
  }, [reportId]);

  // ── Auto-scroll logic ─────────────────────────────────────
  useEffect(() => {
    if (comments.length === 0 || !currentUserId) return;

    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;

      const allCommentsFlat: any[] = [];
      const flatten = (list: any[]) => {
        if (!list || !Array.isArray(list)) return;
        for (const c of list) {
          allCommentsFlat.push(c);
          if (c.replies && c.replies.length > 0) {
            flatten(c.replies);
          }
        }
      };
      flatten(comments);

      allCommentsFlat.sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeA - timeB;
      });

      const firstUnread = allCommentsFlat.find(c => {
        const cUserId = c.userId || c.user?.id;
        const isMe = currentUserId && cUserId && String(cUserId).trim() === String(currentUserId).trim();
        const hasRead = c.commentReads && c.commentReads.some((r: any) => String(r.userId).trim() === String(currentUserId).trim());
        return !isMe && !hasRead;
      });

      if (firstUnread) {
        setTimeout(() => {
          scrollToComment(firstUnread.commentId);
        }, 500);
      } else {
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: false });
        }, 500);
      }
      return;
    }

    if (justSentRef.current) {
      justSentRef.current = false;
      const allCommentsFlat: any[] = [];
      const flatten = (list: any[]) => {
        if (!list || !Array.isArray(list)) return;
        for (const c of list) {
          allCommentsFlat.push(c);
          if (c.replies && c.replies.length > 0) {
            flatten(c.replies);
          }
        }
      };
      flatten(comments);

      const myComments = allCommentsFlat.filter(c => {
        const cUserId = c.userId || c.user?.id;
        return currentUserId && cUserId && String(cUserId).trim() === String(currentUserId).trim();
      });

      if (myComments.length > 0) {
        myComments.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        const latestSent = myComments[0];
        setTimeout(() => {
          scrollToComment(latestSent.commentId);
        }, 100);
      } else {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }
    }
  }, [comments, currentUserId]);

  // ── Socket.io ─────────────────────────────────────────────
  useEffect(() => {
    if (!currentUserId || !reportId) return;

    const connectSocket = async () => {
      const token = await AsyncStorage.getItem("userToken");
      const s = io(SERVER_BASE, {
        auth: { token },
        query: { userId: currentUserId },
        transports: ["websocket"],
      });
      socketRef.current = s;

      s.on("connect", () => {
        s.emit("forum:join", { reportId, userId: currentUserId });
      });

      s.on("forum:typing", ({ userId, userName, isTyping }: any) => {
        if (userId === currentUserId) return;
        setTypingUsers((prev) => {
          if (isTyping) {
            if (prev.find((u) => u.userId === userId)) return prev;
            return [...prev, { userId, userName }];
          }
          return prev.filter((u) => u.userId !== userId);
        });
      });

      s.on("forum:new_comment", () => fetchComments());
      s.on("forum:comment_updated", () => fetchComments());
      s.on("forum:comment_deleted", () => fetchComments());
      s.on("forum:read_receipt", ({ reader }: any) => {
        if (reader?.id !== currentUserId) fetchComments();
      });
    };

    connectSocket();

    return () => {
      socketRef.current?.emit("forum:leave", { reportId });
    };
  }, [currentUserId, reportId]);

  // ── Image picker options ──────────────────────────────────
  const handleCameraPhoto = async () => {
    setShowPhotoOptions(false);
    setUploadError(false);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Izin diperlukan", "Izin kamera diperlukan untuk mengambil foto.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        if (!asset.base64) { setUploadError(true); return; }
        const base64 = `data:image/jpeg;base64,${asset.base64}`;
        if (photoOptionsForEdit) setEditImage(base64);
        else { setImageBase64(base64); setImagePreview(asset.uri); }
      }
    } catch { setUploadError(true); }
  };

  const handleGalleryPhoto = async () => {
    setShowPhotoOptions(false);
    setUploadError(false);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Izin diperlukan", "Izinkan akses galeri.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        if (!asset.base64) { setUploadError(true); return; }
        const base64 = `data:image/jpeg;base64,${asset.base64}`;
        if (photoOptionsForEdit) setEditImage(base64);
        else { setImageBase64(base64); setImagePreview(asset.uri); }
      }
    } catch { setUploadError(true); }
  };

  const openPhotoOptions = (forEdit = false) => {
    setPhotoOptionsForEdit(forEdit);
    setShowPhotoOptions(true);
  };

  const clearImage = () => { setImageBase64(null); setImagePreview(null); setUploadError(false); };
  const cancelReply = () => { setReplyToId(null); setReplyToContent(""); setReplyToType(null); };

  // ── Send comment ──────────────────────────────────────────
  const sendComment = async () => {
    const hasText = text.trim().length > 0;
    const hasImage = !!imageBase64;
    if (!hasText && !hasImage) return;
    if (isClosed) return;

    clearTimeout(typingTimer.current);
    api.post("/comments/typing", { reportId, isTyping: false }).catch(() => { });

    try {
      await api.post(`/comments`, {
        reportId,
        content: hasText ? text.trim() : "📷",
        parentId: replyToType === "report" ? null : (replyToId || null),
        isReplyToReport: replyToType === "report",
        image: imageBase64 || null,
      });
      setText(""); setInputKey((k) => k + 1); cancelReply(); clearImage(); justSentRef.current = true; fetchComments();
      Keyboard.dismiss();
    } catch (err: any) {
      console.log("SEND ERROR:", err.response?.data || err.message);
      if (imageBase64) setUploadError(true);
    }
  };

  const startEdit = (comment: any) => { setEditingId(comment.commentId); setEditText(comment.content?.trim() === "📷" ? "" : comment.content); setEditImage(comment.image || null); };
  const cancelEdit = () => { setEditingId(null); setEditText(""); setEditImage(null); };

  const submitEdit = async (commentId: string) => {
    const hasText = editText.trim().length > 0;
    const hasImage = !!editImage;
    if (!hasText && !hasImage) return;
    try {
      await api.put(`/comments/${commentId}`, { content: hasText ? editText.trim() : "📷", image: editImage });
      cancelEdit(); await fetchComments();
    } catch (err: any) {
      Alert.alert("Gagal", "Gagal menyimpan perubahan.");
    }
  };

  const deleteComment = (commentId: string) => {
    showDialog(
      "Hapus pesan",
      "Yakin ingin menghapus pesan ini?",
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus",
          style: "destructive",
          onPress: async () => {
            try {
              await api.delete(`/comments/${commentId}`);
              fetchComments();
            } catch (err: any) {
              console.log("DELETE ERROR:", err.response?.data || err.message);
            }
          },
        },
      ]
    );
  };

  const fmt = (dt: string) => new Date(dt).toLocaleString("id-ID", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

  const reportReplies = comments.filter((c) => c.isReplyToReport);
  const generalComments = comments.filter((c) => !c.isReplyToReport);

  // ── Render comment ────────────────────────────────────────
  const renderComment = (comment: any, level = 0) => {
    const isOwnerCheck = currentUserId && comment.userId &&
      String(comment.userId).trim() === String(currentUserId).trim();

    // Lebar card tetap - ditambah sedikit
    const cardWidth = SCREEN_WIDTH - 75;

    if (comment.deleted || comment.isDeleted) {
      return (
        <View ref={(r) => { commentRefs.current[comment.commentId] = r; }} key={comment.commentId} style={{ marginTop: level === 0 ? 8 : 6 }}>
          <View style={[styles.commentRow, { width: cardWidth }]}>
            {level > 0 && <View style={styles.threadLine} />}
            <UserAvatar user={comment.user} fallbackBg="#e5e7eb" fallbackTextColor="#9ca3af" />
            <View style={[styles.deletedCard, { width: cardWidth - 40 }]}>
              <Text style={styles.deletedIcon}>⊘</Text>
              <Text style={styles.deletedText}>
                {isOwnerCheck ? "Anda menghapus pesan ini" : "Pesan ini telah dihapus"}
              </Text>
            </View>
          </View>
          {comment.replies?.length > 0 && (
            <View style={{ marginLeft: 30 }}>
              {comment.replies.map((child: any) => renderComment(child, level + 1))}
            </View>
          )}
        </View>
      );
    }

    const roleInfo = getRoleInfo(comment.user);
    const initials = (comment.user?.name || "?").charAt(0).toUpperCase();
    const isOwner = isOwnerCheck;
    const isEditing = editingId === comment.commentId;
    const isEdited = comment.updatedAt && comment.updatedAt !== comment.createdAt;
    const avatarBg = roleInfo.isStaff ? roleInfo.color || "#2563eb" : "#94a3b8";

    return (
      <View ref={(r) => { commentRefs.current[comment.commentId] = r; }} key={comment.commentId} style={{ marginTop: level === 0 ? 8 : 6 }}>
        <View style={[styles.commentRow, { width: cardWidth }]}>
          {level > 0 && <View style={styles.threadLine} />}
          <UserAvatar user={comment.user} fallbackBg={avatarBg} />
          <View style={[styles.card, level > 0 && styles.cardNested, { width: cardWidth - 40 }]}>
            <View style={styles.cardHeader}>
              <Text style={styles.userName}>{comment.user?.name}</Text>
              {roleInfo.isStaff && (
                <View style={[styles.adminBadge, roleInfo.color ? { backgroundColor: `${roleInfo.color}1f` } : null]}>
                  <Text style={[styles.adminBadgeText, roleInfo.color ? { color: roleInfo.color } : null]}>
                    {roleInfo.label.toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.timeRow}>
                {isEdited && <Text style={styles.editedLabel}>Diedit</Text>}
                <Text style={styles.timeText}>{fmt(comment.updatedAt || comment.createdAt)}</Text>
              </View>
            </View>

            {isEditing ? (
              <View>
                <TextInput
                  value={editText}
                  onChangeText={setEditText}
                  multiline
                  placeholder="Tambahkan Pesan..."
                  placeholderTextColor="#9ca3af"
                  style={[styles.editInput, !editText && { fontStyle: "italic" }]}
                />
                {editImage ? (
                  <View style={{ marginTop: 6 }}>
                    <Image
                      source={{ uri: editImage }}
                      style={{ width: "100%", height: 120, borderRadius: 8 }}
                      resizeMode="cover"
                    />
                    <TouchableOpacity onPress={() => setEditImage(null)} style={styles.removeImageBtn}>
                      <Text style={{ color: "#fff", fontSize: 12 }}>×</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                <View style={[styles.editActions, { justifyContent: comment.image ? "space-between" : "flex-end" }]}>
                  {!!comment.image && (
                    <TouchableOpacity onPress={() => openPhotoOptions(true)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <IconSymbol name="photo.fill" size={16} color="#6b7280" />
                      <Text style={styles.attachText}>Ganti foto</Text>
                    </TouchableOpacity>
                  )}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity onPress={cancelEdit} style={styles.btnOutline}>
                      <Text style={styles.btnOutlineText}>Batal</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => submitEdit(comment.commentId)} style={styles.btnDark}>
                      <Text style={styles.btnDarkText}>Simpan</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : (
              <>
                {comment.content && comment.content.trim() !== "📷" && (
                  <Text style={styles.contentText}>{comment.content}</Text>
                )}
                {comment.image ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => openViewer([comment.image], 0)}
                    style={styles.imageWrapper}
                  >
                    <Image
                      source={{ uri: comment.image }}
                      style={styles.commentImage}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                ) : null}
                <View style={styles.actionRow}>
                  {!isClosed && (
                    <TouchableOpacity
                      onPress={() => {
                        setReplyToId(comment.commentId);
                        setReplyToContent(comment.content);
                        setReplyToType("comment");
                      }}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.replyBtnText}>↩ Balas</Text>
                    </TouchableOpacity>
                  )}
                  {isOwner && !isClosed && (
                    <>
                      <TouchableOpacity onPress={() => startEdit(comment)} activeOpacity={0.6}>
                        <Text style={styles.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteComment(comment.commentId)} activeOpacity={0.6}>
                        <Text style={styles.deleteBtnText}>Hapus</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
                {!!isOwner && (
                  <View style={{ alignItems: "flex-end", marginTop: 2 }}>
                    <ReadCheckmarks
                      status={getReadStatus(comment, currentUserId, expectedReaderIds, onlineParticipantIds, adminParticipantIds)}
                    />
                  </View>
                )}
              </>
            )}
          </View>
        </View>
        {comment.replies?.length > 0 && (
          <View style={{ marginLeft: 30 }}>
            {comment.replies.map((child: any) => renderComment(child, level + 1))}
          </View>
        )}
      </View>
    );
  };

  const openViewer = (images: string[], index: number) => {
    setViewerImages(images);
    setViewerIndex(index);
    setViewerVisible(true);
  };

  // ═══════════════════════════════════════════════════════════
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <ImageViewerModal
        images={viewerImages}
        initialIndex={viewerIndex}
        visible={viewerVisible}
        onClose={() => setViewerVisible(false)}
      />
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Custom Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <IconSymbol name="arrow.left" size={20} color="#1d1d1f" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {topic?.content
              ? topic.content.length > 30
                ? topic.content.substring(0, 30) + "..."
                : topic.content
              : "Forum Diskusi"}
          </Text>
          <View style={styles.headerRight} />
        </View>

        {isClosed && (
          <View style={styles.closedBanner}>
            <Text style={styles.closedText}>🔒 Forum sudah ditutup</Text>
          </View>
        )}

        <View
          style={[
            styles.keyboardAvoidingView,
            keyboardVisible && { paddingBottom: keyboardHeight + insets.bottom }
          ]}
        >
          {/* Content Container */}
          <View style={styles.contentContainer}>
            <ScrollView
              ref={scrollViewRef}
              style={styles.scrollView}
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: 16 }
              ]}
              showsHorizontalScrollIndicator={false}
            >
              {/* LAPORAN - TETAP DI LUAR SCROLL HORIZONTAL */}
              {topic && (
                <View style={{ marginBottom: 12 }}>
                  <View style={styles.topicCard}>
                    <View style={styles.topicHeader}>
                      <UserAvatar user={topic.user} fallbackBg="#94a3b8" />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.userName}>{topic.user?.name}</Text>
                        <Text style={styles.timeText}>{fmt(topic.createdAt)}</Text>
                      </View>
                      <View style={styles.topicBadge}>
                        <Text style={styles.topicBadgeText}>LAPORAN</Text>
                      </View>
                    </View>
                    <Text style={styles.topicContent}>{topic.content}</Text>
                    {topic.image ? (() => {
                      const imgUrls = parseReportImages(topic.image);
                      if (imgUrls.length === 0) return null;
                      if (imgUrls.length === 1) {
                        return (
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => openViewer(imgUrls, 0)}
                            style={styles.singleImageWrap}
                          >
                            <Image
                              source={{ uri: imgUrls[0] }}
                              style={styles.singleImage}
                              resizeMode="cover"
                            />
                          </TouchableOpacity>
                        );
                      }
                      return (
                        <View style={{ marginTop: 10 }}>
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.imgStrip}
                          >
                            {imgUrls.map((uri, idx) => (
                              <TouchableOpacity
                                key={idx}
                                activeOpacity={0.85}
                                onPress={() => openViewer(imgUrls, idx)}
                                style={styles.stripThumbWrap}
                              >
                                <Image
                                  source={{ uri }}
                                  style={styles.stripThumb}
                                  resizeMode="cover"
                                />
                                {imgUrls.length > 1 && (
                                  <View style={styles.stripBadge}>
                                    <Text style={styles.stripBadgeText}>{idx + 1}/{imgUrls.length}</Text>
                                  </View>
                                )}
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      );
                    })() : null}
                    {!isClosed && (
                      <TouchableOpacity
                        onPress={() => {
                          setReplyToId(String(reportId));
                          setReplyToContent(topic.content);
                          setReplyToType("report");
                        }}
                        activeOpacity={0.6}
                      >
                        <Text style={styles.replyBtnText}>↩ Balas</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Report Replies - dengan indentasi */}
                  {reportReplies.length > 0 && (
                    <View style={{
                      marginLeft: 16,
                      paddingLeft: 12,
                      borderLeftWidth: 1.5,
                      borderLeftColor: "#bbf7d0",
                      marginTop: 6,
                    }}>
                      {/* Report replies menggunakan ScrollView horizontal */}
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={true}
                        contentContainerStyle={{ paddingRight: 10 }}
                      >
                        <View>
                          {reportReplies.map((c) => renderComment(c, 1))}
                        </View>
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}

              {/* GENERAL COMMENTS - dengan ScrollView horizontal untuk nested replies */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={true}
                contentContainerStyle={{ paddingRight: 10 }}
              >
                <View>
                  {generalComments.map((c) => renderComment(c))}
                </View>
              </ScrollView>

              {reportReplies.length === 0 && generalComments.length === 0 && (
                <Text style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, paddingVertical: 24 }}>
                  Belum ada komentar. Mulai diskusi!
                </Text>
              )}

              {typingUsers.length > 0 && (
                <View style={styles.typingContainer}>
                  <View style={styles.typingDots}>
                    {[0, 1, 2].map((i) => (
                      <View key={i} style={styles.typingDot} />
                    ))}
                  </View>
                  <Text style={styles.typingText}>
                    {typingUsers.map((u) => u.userName).join(", ")} sedang mengetik...
                  </Text>
                </View>
              )}
            </ScrollView>

            {uploadError && (
              <View style={styles.uploadErrorBanner}>
                <Text style={styles.uploadErrorText}>⚠ Gagal mengupload gambar.</Text>
                <TouchableOpacity onPress={() => setUploadError(false)}>
                  <Text style={styles.uploadErrorClose}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            {replyToId && !isClosed && (
              <View style={[styles.replyIndicator, {
                backgroundColor: replyToType === "report" ? "#f0fdf4" : "#fffbeb",
                borderTopColor: replyToType === "report" ? "#bbf7d0" : "#fde68a",
              }]}>
                <View style={[styles.replyIndicatorBar, {
                  backgroundColor: replyToType === "report" ? "#16a34a" : "#f59e0b",
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.replyIndicatorLabel, {
                    color: replyToType === "report" ? "#16a34a" : "#b45309",
                  }]}>
                    {replyToType === "report" ? "📋 Membalas Laporan" : "↩ Membalas Komentar"}
                  </Text>
                  <Text style={styles.replyIndicatorText} numberOfLines={1}>{replyToContent}</Text>
                </View>
                <TouchableOpacity onPress={cancelReply}>
                  <Text style={styles.cancelText}>batal</Text>
                </TouchableOpacity>
              </View>
            )}

            {imagePreview && (
              <View style={styles.imagePreviewWrap}>
                <Image source={{ uri: imagePreview }} style={styles.imagePreview} resizeMode="cover" />
                <TouchableOpacity onPress={clearImage} style={styles.removeImageBtn}>
                  <Text style={{ color: "#fff", fontSize: 12 }}>×</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Input Area */}
          {!isClosed && (
            <View style={[
              styles.inputArea,
              { paddingBottom: keyboardVisible ? 8 : (insets.bottom || 8) },
            ]}>
              <TouchableOpacity onPress={() => openPhotoOptions(false)} style={styles.attachButton}>
                <IconSymbol name="camera.fill" size={22} color="#4b5563" />
              </TouchableOpacity>

              <View style={styles.inputWrapper}>
                <TextInput
                  key={inputKey}
                  value={text}
                  onChangeText={(val) => {
                    setText(val);
                    api.post("/comments/typing", { reportId, isTyping: true }).catch(() => { });
                    clearTimeout(typingTimer.current);
                    typingTimer.current = setTimeout(() => {
                      api.post("/comments/typing", { reportId, isTyping: false }).catch(() => { });
                    }, 2000);
                  }}
                  editable={!isClosed}
                  placeholder={
                    replyToType === "report" ? "Balas laporan..." :
                      replyToId ? "Balas komentar..." : "Ketik Pesan..."
                  }
                  placeholderTextColor="#9ca3af"
                  style={styles.input}
                  returnKeyType="send"
                  onSubmitEditing={sendComment}
                  multiline
                  maxLength={500}
                />
              </View>

              <TouchableOpacity
                onPress={sendComment}
                disabled={!text.trim() && !imageBase64}
                style={[styles.sendBtn, (!text.trim() && !imageBase64) && styles.sendBtnDisabled]}
                activeOpacity={0.8}
              >
                <IconSymbol
                  name="paperplane.fill"
                  size={28}
                  color={(text.trim() || imageBase64) ? "#374151" : "#ccc"}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Photo Options Modal */}
      <Modal
        visible={showPhotoOptions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPhotoOptions(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Tambah Foto</Text>
                <TouchableOpacity onPress={() => setShowPhotoOptions(false)}>
                  <IconSymbol size={20} name="xmark" color="#1d1d1f" />
                </TouchableOpacity>
              </View>

              <View style={styles.modalOptions}>
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={handleCameraPhoto}
                >
                  <View style={styles.modalOptionIcon}>
                    <IconSymbol size={28} name="camera.fill" color="#1d1d1f" />
                  </View>
                  <View style={styles.modalOptionText}>
                    <Text style={styles.modalOptionTitle}>Ambil Foto Kamera</Text>
                    <Text style={styles.modalOptionDesc}>Ambil foto menggunakan kamera perangkat</Text>
                  </View>
                  <IconSymbol size={18} name="chevron.right" color="#86868b" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={handleGalleryPhoto}
                >
                  <View style={styles.modalOptionIcon}>
                    <IconSymbol size={28} name="photo.fill" color="#1d1d1f" />
                  </View>
                  <View style={styles.modalOptionText}>
                    <Text style={styles.modalOptionTitle}>Pilih dari Galeri</Text>
                    <Text style={styles.modalOptionDesc}>Pilih foto dari galeri perangkat</Text>
                  </View>
                  <IconSymbol size={18} name="chevron.right" color="#86868b" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowPhotoOptions(false)}
              >
                <Text style={styles.modalCancelButtonText}>Batal</Text>
              </TouchableOpacity>
              <View style={{ height: 20 }} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // ── Container ────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  contentContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 14,
  },

  // ── Header Styles ───────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f5f5f7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerRight: {
    width: 36,
  },

  closedBanner: {
    backgroundColor: "#fee2e2",
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center"
  },
  closedText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#b91c1c"
  },

  // ── Topic ────────────────────────────────────────────────────
  topicCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 0.5,
    borderColor: "#e5e7eb"
  },
  topicHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8
  },
  topicBadge: {
    backgroundColor: "#f0fdf4",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4
  },
  topicBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#15803d"
  },
  topicContent: {
    fontSize: 13,
    color: "#111827",
    lineHeight: 20,
    marginBottom: 8
  },
  singleImageWrap: {
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 10,
    overflow: "hidden"
  },
  singleImage: {
    width: "100%",
    height: 220,
    borderRadius: 10
  },
  imgStrip: {
    paddingRight: 12,
    gap: 8
  },
  stripThumbWrap: {
    borderRadius: 10,
    overflow: "hidden",
    position: "relative"
  },
  stripThumb: {
    width: 130,
    height: 130,
    borderRadius: 10
  },
  stripBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  stripBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600"
  },

  // ── Comment ──────────────────────────────────────────────────
  commentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  threadLine: {
    width: 2,
    alignSelf: "stretch",
    backgroundColor: "#dbeafe",
    borderRadius: 1,
    marginRight: 4,
    minHeight: 32,
    marginLeft: 4,
  },
  avatar: {
    width: 32,
    height: 32,
    minWidth: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center"
  },
  avatarText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600"
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 10,
    borderWidth: 0.5,
    borderColor: "#e5e7eb",
  },
  cardNested: {
    borderTopLeftRadius: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
    flexWrap: "wrap"
  },
  userName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827"
  },
  superAdminBadge: {
    backgroundColor: "#ede9fe",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  superAdminBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#6d28d9"
  },
  adminBadge: {
    backgroundColor: "#dbeafe",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  adminBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#1e40af"
  },
  timeRow: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  editedLabel: {
    fontSize: 11,
    color: "#6b7280",
    fontStyle: "italic"
  },
  timeText: {
    fontSize: 11,
    color: "#9ca3af"
  },
  deletedCard: {
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    padding: 10,
    borderWidth: 0.5,
    borderColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deletedIcon: {
    fontSize: 15,
    color: "#9ca3af"
  },
  deletedText: {
    fontSize: 13,
    color: "#9ca3af",
    fontStyle: "italic"
  },
  contentText: {
    fontSize: 13,
    color: "#1f2937",
    lineHeight: 19,
    marginBottom: 6
  },
  // ── Image 1:1 (Kotak) ──────────────────────────────────────
  imageWrapper: {
    marginTop: 6,
    marginBottom: 6,
    borderRadius: 8,
    overflow: 'hidden',
    aspectRatio: 1, // Membuat gambar 1:1 (kotak)
    width: '100%',
    maxWidth: 300, // Batasi ukuran maksimum agar tidak terlalu besar
  },
  commentImage: {
    width: '100%',
    height: '100%',
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  replyBtnText: {
    fontSize: 12,
    color: "#9ca3af"
  },
  editBtnText: {
    fontSize: 12,
    color: "#6b7280"
  },
  deleteBtnText: {
    fontSize: 12,
    color: "#ef4444"
  },
  editInput: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top"
  },
  editActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8
  },
  attachText: {
    fontSize: 12,
    color: "#6b7280"
  },
  btnOutline: {
    borderWidth: 0.5,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  btnOutlineText: {
    fontSize: 12,
    color: "#374151"
  },
  btnDark: {
    backgroundColor: "#111827",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  btnDarkText: {
    fontSize: 12,
    color: "#fff"
  },

  // ── Typing ────────────────────────────────────────────────────
  typingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 4
  },
  typingDots: {
    flexDirection: "row",
    gap: 3
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#9ca3af"
  },
  typingText: {
    fontSize: 12,
    color: "#6b7280",
    fontStyle: "italic"
  },

  // ── Upload Error ─────────────────────────────────────────────
  uploadErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fee2e2",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: "#fca5a5"
  },
  uploadErrorText: {
    fontSize: 12,
    color: "#b91c1c",
    flex: 1
  },
  uploadErrorClose: {
    fontSize: 13,
    color: "#b91c1c",
    paddingLeft: 8
  },

  // ── Reply Indicator ──────────────────────────────────────────
  replyIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 0.5
  },
  replyIndicatorBar: {
    width: 3,
    height: 36,
    borderRadius: 2
  },
  replyIndicatorLabel: {
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 2
  },
  replyIndicatorText: {
    fontSize: 12,
    color: "#374151"
  },
  cancelText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ef4444"
  },

  // ── Image Preview ────────────────────────────────────────────
  imagePreviewWrap: {
    margin: 10,
    position: "relative",
    alignSelf: "flex-start"
  },
  imagePreview: {
    width: 80,
    height: 80,
    borderRadius: 8
  },
  removeImageBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "#111827",
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center"
  },

  // ── Input Area - Responsive ──────────────────────────────────
  keyboardAvoidingView: {
    flex: 1,
  },
  inputArea: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e7eb",
    minHeight: 60,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
  },
  inputAreaWithKeyboard: {
    paddingBottom: Platform.OS === 'ios' ? 8 : 8,
  },
  attachButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: '#f5f5f7',
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    minHeight: 40,
    maxHeight: 120,
  },
  input: {
    fontSize: 14,
    color: "#111827",
    padding: 0,
    textAlignVertical: 'center',
    minHeight: Platform.OS === 'ios' ? 24 : 36,
  },
  sendBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },

  // ── Modal ────────────────────────────────────────────────────
  modalContainer: { flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 17, fontWeight: "600", color: "#1d1d1f" },
  modalOptions: { gap: 10, marginBottom: 16 },
  modalOption: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: "#f5f5f7", borderRadius: 8, borderWidth: 1, borderColor: "#e5e5ea" },
  modalOptionIcon: { width: 48, height: 48, borderRadius: 8, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center" },
  modalOptionText: { flex: 1 },
  modalOptionTitle: { fontSize: 14, fontWeight: "600", color: "#1d1d1f", marginBottom: 2 },
  modalOptionDesc: { fontSize: 12, color: "#86868b" },
  modalCancelButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: "#f5f5f7", alignItems: "center" },
  modalCancelButtonText: { fontSize: 14, fontWeight: "500", color: "#86868b" },
});