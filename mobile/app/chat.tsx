import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator } from "react-native";
import { io } from "socket.io-client";
import { useLocalSearchParams } from "expo-router";
import { API_BASE_URL, WS_URL } from "@/config/api.config";

const API = API_BASE_URL;

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
type ReadStatus = "sending" | "sent" | "delivered" | "read";

interface ChatMsg {
  id: string;
  takenTaskId: string;
  senderId: string;
  senderRole: string;
  message: string;
  createdAt: string;
  // local-only
  _readStatus?: ReadStatus;
  _tempId?: string;
}

interface TypingUser {
  userId: string;
  userName: string;
}

// ─────────────────────────────────────────────────────────────
// READ CHECKMARKS  (WhatsApp style)
// ─────────────────────────────────────────────────────────────
const CheckSingle = ({ color }: { color: string }) => (
  // Satu centang
  <Text style={{ color, fontSize: 13, lineHeight: 16 }}>✓</Text>
);

const CheckDouble = ({ color }: { color: string }) => (
  // Dua centang — pakai dua karakter dengan overlap tipis
  <View style={{ flexDirection: "row", alignItems: "center" }}>
    <Text style={{ color, fontSize: 13, lineHeight: 16, marginRight: -5 }}>✓</Text>
    <Text style={{ color, fontSize: 13, lineHeight: 16 }}>✓</Text>
  </View>
);

const ReadCheckmarks = ({ status }: { status?: ReadStatus }) => {
  if (!status || status === "sending") {
    return <ActivityIndicator size={10} color="#aaa" style={{ marginLeft: 4, alignSelf: "flex-end", marginBottom: 1 }} />;
  }
  if (status === "sent") {
    return (
      <View style={styles.checkWrap}>
        <CheckSingle color="#aaa" />
      </View>
    );
  }
  if (status === "delivered") {
    return (
      <View style={styles.checkWrap}>
        <CheckDouble color="#aaa" />
      </View>
    );
  }
  if (status === "read") {
    return (
      <View style={styles.checkWrap}>
        <CheckDouble color="#3b82f6" />
      </View>
    );
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// TYPING INDICATOR  (tiga titik animasi)
// ─────────────────────────────────────────────────────────────
const TypingIndicator = ({ typingUsers }: { typingUsers: TypingUser[] }) => {
  const [dot, setDot] = useState(0);

  useEffect(() => {
    if (typingUsers.length === 0) return;
    const t = setInterval(() => setDot((d) => (d + 1) % 3), 400);
    return () => clearInterval(t);
  }, [typingUsers.length]);

  if (typingUsers.length === 0) return null;

  const name = typingUsers.length === 1 ? typingUsers[0].userName : `${typingUsers[0].userName} +${typingUsers.length - 1}`;

  const dots = ["·", "· ·", "· · ·"][dot];

  return (
    <View style={styles.typingRow}>
      <View style={styles.typingBubble}>
        <Text style={styles.typingDots}>{dots}</Text>
      </View>
      <Text style={styles.typingLabel}>{name} sedang mengetik…</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const params = useLocalSearchParams();
  const takenTaskId = Array.isArray(params.takenTaskId) ? params.takenTaskId[0] : params.takenTaskId;

  // ── Ganti ini dengan userId asli dari auth/storage ────────
  const currentUserId = "mobile-user";
  const currentUserName = "Mobile User";

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [readerIds, setReaderIds] = useState<Set<string>>(new Set()); // siapa saja yg sudah baca

  const socketRef = useRef<any>(null);
  const flatListRef = useRef<FlatList>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // ─────────────────────────────────────────────────────────
  // FETCH history
  // ─────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    if (!takenTaskId) return;
    try {
      const res = await fetch(`${API}/chat/${takenTaskId}`);
      const data: ChatMsg[] = await res.json();
      // Semua pesan dari history anggap sudah "delivered"
      const withStatus = data.map((m) => ({
        ...m,
        _readStatus: (m.senderId === currentUserId ? "sent" : undefined) as ReadStatus | undefined,
      }));
      setMessages(withStatus);
    } catch (e) {
      console.error("Fetch chat error:", e);
    }
  }, [takenTaskId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // ─────────────────────────────────────────────────────────
  // SOCKET
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!takenTaskId) return;

    const s = io(WS_URL, {
      transports: ["websocket"],
      query: { userId: currentUserId },
    });
    socketRef.current = s;

    s.on("connect", () => {
      console.log("🔥 Socket connected:", s.id);
      s.emit("chat:join", { takenTaskId });
    });

    // Pesan masuk dari orang lain
    s.on("chat:receive", (msg: ChatMsg) => {
      setMessages((prev) => {
        // Jangan duplikat
        if (prev.find((m) => m.id === msg.id)) return prev;
        return [...prev, { ...msg, _readStatus: undefined }];
      });

      // Auto mark as read (kita sudah buka chat-nya)
      sendReadReceipt([msg.id]);
    });

    // Read receipt dari orang lain
    s.on("chat:read_receipt", ({ readerId, messageIds }: { readerId: string; messageIds: string[] }) => {
      if (readerId === currentUserId) return;

      setReaderIds((prev) => {
        const next = new Set(prev);
        next.add(readerId);
        return next;
      });

      // Update status pesan yang dibaca
      setMessages((prev) =>
        prev.map((m) => {
          if (m.senderId !== currentUserId) return m;
          if (messageIds.length > 0 && !messageIds.includes(m.id)) return m;
          // Hitung apakah semua peserta sudah baca
          // Sederhana: jika ada yg baca → "read"
          return { ...m, _readStatus: "read" as ReadStatus };
        }),
      );
    });

    // Typing dari orang lain
    s.on("chat:typing", ({ userId, userName, isTyping }: { userId: string; userName: string; isTyping: boolean }) => {
      if (userId === currentUserId) return;
      setTypingUsers((prev) => {
        if (isTyping) {
          if (prev.find((u) => u.userId === userId)) return prev;
          return [...prev, { userId, userName }];
        }
        return prev.filter((u) => u.userId !== userId);
      });
    });

    return () => {
      s.emit("chat:leave", { takenTaskId });
      s.disconnect();
    };
  }, [takenTaskId]);

  // ─────────────────────────────────────────────────────────
  // MARK READ
  // ─────────────────────────────────────────────────────────
  const sendReadReceipt = useCallback(
    async (messageIds: string[] = []) => {
      if (!takenTaskId) return;
      try {
        await fetch(`${API}/chat/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ takenTaskId, userId: currentUserId, messageIds }),
        });
      } catch (_) {}
    },
    [takenTaskId],
  );

  // Mark semua sebagai read saat buka screen
  useEffect(() => {
    sendReadReceipt();
  }, [sendReadReceipt]);

  // ─────────────────────────────────────────────────────────
  // TYPING EMIT
  // ─────────────────────────────────────────────────────────
  const handleTyping = (val: string) => {
    setInput(val);
    if (!takenTaskId) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      fetch(`${API}/chat/typing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takenTaskId, userId: currentUserId, userName: currentUserName, isTyping: true }),
      }).catch(() => {});
    }

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      fetch(`${API}/chat/typing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takenTaskId, userId: currentUserId, userName: currentUserName, isTyping: false }),
      }).catch(() => {});
    }, 2000);
  };

  const stopTyping = () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      fetch(`${API}/chat/typing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takenTaskId, userId: currentUserId, userName: currentUserName, isTyping: false }),
      }).catch(() => {});
    }
  };

  // ─────────────────────────────────────────────────────────
  // SEND MESSAGE
  // ─────────────────────────────────────────────────────────
  const sendMessage = () => {
    if (!input.trim() || !socketRef.current || !takenTaskId) return;

    stopTyping();

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: ChatMsg = {
      id: tempId,
      takenTaskId,
      senderId: currentUserId,
      senderRole: "employee",
      message: input.trim(),
      createdAt: new Date().toISOString(),
      _readStatus: "sending",
      _tempId: tempId,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInput("");

    socketRef.current.emit("chat:send", {
      takenTaskId,
      message: optimisticMsg.message,
    });

    // Setelah kirim, update status → "sent"
    setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m._tempId === tempId ? { ...m, _readStatus: "sent" as ReadStatus } : m)));
    }, 300);
  };

  // ─────────────────────────────────────────────────────────
  // AUTO SCROLL
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, typingUsers]);

  // ─────────────────────────────────────────────────────────
  // RENDER MESSAGE
  // ─────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: ChatMsg }) => {
    const isMe = item.senderId === currentUserId;

    return (
      <View style={[styles.msgWrap, isMe ? styles.msgWrapMe : styles.msgWrapOther]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
          <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextOther]}>{item.message}</Text>

          {/* Footer: waktu + centang */}
          <View style={styles.msgFooter}>
            <Text style={[styles.msgTime, isMe ? styles.msgTimeMe : styles.msgTimeOther]}>
              {new Date(item.createdAt).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
            {isMe && <ReadCheckmarks status={item._readStatus} />}
          </View>
        </View>
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────
  if (!takenTaskId) {
    return (
      <View style={styles.center}>
        <Text>No Task ID 😅</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chat</Text>
      </View>

      {/* MESSAGES */}
      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        <FlatList ref={flatListRef} data={messages} keyExtractor={(item, i) => item.id || `msg-${i}`} renderItem={renderItem} contentContainerStyle={{ gap: 6, paddingVertical: 12 }} />

        {/* TYPING INDICATOR */}
        <TypingIndicator typingUsers={typingUsers} />
      </View>

      {/* INPUT */}
      <View style={styles.inputRow}>
        <TextInput value={input} onChangeText={handleTyping} placeholder="Ketik pesan..." style={styles.textInput} onSubmitEditing={sendMessage} returnKeyType="send" multiline />
        <TouchableOpacity onPress={sendMessage} disabled={!input.trim()} style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}>
          <Text style={styles.sendBtnText}>Kirim</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  // Header
  header: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: {
    fontWeight: "700",
    fontSize: 16,
    color: "#111827",
  },

  // Messages
  msgWrap: {
    flexDirection: "row",
    marginVertical: 2,
  },
  msgWrapMe: {
    justifyContent: "flex-end",
  },
  msgWrapOther: {
    justifyContent: "flex-start",
  },
  bubble: {
    maxWidth: "75%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  bubbleMe: {
    backgroundColor: "#111827",
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: "#ffffff",
    borderBottomLeftRadius: 4,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  msgText: {
    fontSize: 14,
    lineHeight: 20,
  },
  msgTextMe: {
    color: "#ffffff",
  },
  msgTextOther: {
    color: "#111827",
  },

  // Footer (waktu + centang)
  msgFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 4,
    gap: 4,
  },
  msgTime: {
    fontSize: 10,
  },
  msgTimeMe: {
    color: "#9ca3af",
  },
  msgTimeOther: {
    color: "#6b7280",
  },

  // Centang
  checkWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 2,
  },

  // Typing
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 8,
  },
  typingBubble: {
    backgroundColor: "#ffffff",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  typingDots: {
    fontSize: 16,
    color: "#6b7280",
    letterSpacing: 2,
  },
  typingLabel: {
    fontSize: 12,
    color: "#9ca3af",
    fontStyle: "italic",
  },

  // Input
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    gap: 8,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  textInput: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: "#111827",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#d1d5db",
  },
  sendBtnText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
});
