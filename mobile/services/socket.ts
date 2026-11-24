import { io, Socket } from "socket.io-client";
import AsyncStorage from "@react-native-async-storage/async-storage";

let socket: Socket | null = null;

export const connectSocket = async (): Promise<Socket> => {
  if (socket && socket.connected) return socket;

  const token = await AsyncStorage.getItem("userToken");

  console.log("🔑 TOKEN:", token);

  if (!token) {
    throw new Error("No token found");
  }

  // =========================================================
  // 🔥 KODE DINAMIS: Ambil URL dari .env (Anti-Hardcode)
  // Fallback ke http://10.0.2.2:8000 khusus untuk Emulator Android
  // =========================================================
  const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || "http://10.0.2.2:8000";

  socket = io(SOCKET_URL, {
    transports: ["websocket"],
    auth: {
      token,
    },
  });

  socket.on("connect", () => {
    console.log("✅ SOCKET CONNECTED:", socket?.id);
  });

  socket.on("connect_error", (err) => {
    console.log("❌ SOCKET ERROR:", err.message);
  });

  return socket;
};

export const getSocket = () => socket;