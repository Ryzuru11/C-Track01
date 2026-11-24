import express, { Response } from "express";
import prisma from "../config/database";
import { io } from "../app";
import { authenticate, AuthRequest } from "../middleware/auth";
import { assertAssignmentAccess, requireAssignmentAccess } from "../rbac/assignmentAccess";

const router = express.Router();

// Chat per penugasan: hanya karyawan yang ditugaskan, atau staf yang memantau laporan.
// userId selalu diambil dari token, bukan dari body.
const CHAT_STAFF_PERMISSIONS = ["monitoring.view_reports"];

// ── GET messages by takenTaskId ───────────────────────────────
router.get("/:takenTaskId", authenticate, requireAssignmentAccess(...CHAT_STAFF_PERMISSIONS), async (req: AuthRequest, res: Response) => {
  const { takenTaskId } = req.params;

  try {
    const messages = await prisma.chatMessage.findMany({
      where: { takenTaskId },
      orderBy: { createdAt: "asc" },
    });

    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: "Failed to get messages" });
  }
});

// ── POST mark messages as read ────────────────────────────────
// Body: { takenTaskId, messageIds: string[] }
router.post("/read", authenticate, async (req: AuthRequest, res: Response) => {
  const { takenTaskId, messageIds } = req.body;

  if (!takenTaskId) {
    return res.status(400).json({ message: "takenTaskId required" });
  }

  try {
    await assertAssignmentAccess(req.user, takenTaskId, CHAT_STAFF_PERMISSIONS);

    // Broadcast read receipt ke semua di room chat ini
    io.to(`chat:${takenTaskId}`).emit("chat:read_receipt", {
      takenTaskId,
      readerId: req.user!.userId,
      messageIds: Array.isArray(messageIds) ? messageIds : [],
      readAt: new Date().toISOString(),
    });

    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("CHAT READ ERROR:", err);
    return res.status(500).json({ message: "Failed to mark as read" });
  }
});

// ── POST typing indicator ─────────────────────────────────────
// Body: { takenTaskId, userName, isTyping: boolean }
router.post("/typing", authenticate, async (req: AuthRequest, res: Response) => {
  const { takenTaskId, userName, isTyping } = req.body;

  if (!takenTaskId) {
    return res.status(400).json({ message: "takenTaskId required" });
  }

  try {
    await assertAssignmentAccess(req.user, takenTaskId, CHAT_STAFF_PERMISSIONS);

    // Broadcast typing ke semua di room (kecuali pengirim di-handle di frontend)
    io.to(`chat:${takenTaskId}`).emit("chat:typing", {
      takenTaskId,
      userId: req.user!.userId,
      userName: userName || "Seseorang",
      isTyping: !!isTyping,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(500).json({ message: "Failed to send typing" });
  }
});

export default router;
