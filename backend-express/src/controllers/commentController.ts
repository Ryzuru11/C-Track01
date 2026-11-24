import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import prisma from "../config/database";
import { onlineUsers } from "../sockets/socketStore";
import { io } from "../app";
import { findUserIdsWithPermission } from "../rbac/recipients";
import { Expo } from "expo-server-sdk";

const expo = new Expo();

// ── serialize BigInt ─────────────────────────────────────────
const safeJson = (data: any) =>
  JSON.parse(
    JSON.stringify(data, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );

// ── build comment tree ────────────────────────────────────────
const buildCommentTree = async (
  reportId: string,
  parentId: string | null = null,
  viewerUserId?: string
): Promise<any[]> => {
  const comments = await prisma.comment.findMany({
    where: { reportId, parentId },
    include: {
      user: {
        include: {
          modelHasRoles: {
            include: {
              role: true,
            },
          },
        },
      },
      reads: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      deliveries: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return Promise.all(
    comments.map(async (comment) => ({
      ...comment,
      commentReads: comment.reads,
      commentDeliveries: comment.deliveries,
      replies: await buildCommentTree(
        reportId,
        comment.commentId,
        viewerUserId
      ),
    }))
  );
}

// ── helper: ambil semua userId yang harus terima notif di forum ──
const getForumParticipantIds = async (
  reportId: string
): Promise<string[]> => {

  const report = await prisma.report.findUnique({
    where: { reportId },
    include: {
      takenTask: true,
    },
  });

  const participantIds: string[] = [];

  // Pelapor
  if (report?.userId) {
    participantIds.push(report.userId);
  }

  // Semua pegawai yang di-assign
  if (report?.takenTask?.userIds) {
    try {
      const userIds = JSON.parse(report.takenTask.userIds);

      if (Array.isArray(userIds)) {
        participantIds.push(...userIds);
      }
    } catch { }
  }

  // Semua staf web yang memantau laporan (RBAC: monitoring.view_reports)
  participantIds.push(...(await findUserIdsWithPermission("monitoring.view_reports")));

  return [...new Set(participantIds)];
};

// ── helper: forum hanya untuk peserta (pelapor, karyawan yang ditugaskan, staf monitoring) ──
const checkForumAccess = async (reportId: string, userId: string) => {
  const report = await prisma.report.findUnique({
    where: { reportId },
    include: { takenTask: true },
  });
  if (!report) return { ok: false as const, status: 404, message: "Report tidak ditemukan" };

  const participantIds = await getForumParticipantIds(reportId);
  if (!participantIds.includes(userId)) {
    return { ok: false as const, status: 403, message: "Anda tidak memiliki akses ke forum laporan ini" };
  }
  return { ok: true as const, report, participantIds };
};


// ============================================================
// TYPING INDICATOR (via Socket.io saja, tanpa DB)
// POST /api/comments/typing
// ============================================================
export const sendTyping = async (req: AuthRequest, res: Response) => {
  try {
    const { reportId, isTyping } = req.body;
    const userId = req.user?.userId;
    if (!userId || !reportId) return res.status(400).json({ message: "Invalid" });

    const access = await checkForumAccess(reportId, userId);
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    // Broadcast ke semua user di forum ini (kecuali pengirim)
    io.to(`forum:${reportId}`).emit("forum:typing", {
      reportId,
      userId,
      userName: user?.name || "Seseorang",
      isTyping: !!isTyping,
    });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Error typing" });
  }
};

// ============================================================
// MARK COMMENTS AS READ
// ============================================================
export const markCommentsAsRead = async (req: AuthRequest, res: Response) => {
  try {
    console.log("READ RECEIPT HIT", {
      reportId: req.body.reportId,
      userId: req.user?.userId,
    });

    const { reportId } = req.body;
    const userId = req.user?.userId;
    if (!userId || !reportId) return res.status(400).json({ message: "Invalid" });

    const access = await checkForumAccess(reportId, userId);
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    // Menandai notifikasi NEW_COMMENT atau CHAT terkait reportId ini untuk user ini sebagai "Sudah Dibaca"
    await prisma.notification.updateMany({
      where: {
        userId,
        category: { in: ["NEW_COMMENT", "CHAT"] },
        relatedId: reportId,
        isRead: false
      },
      data: {
        isRead: true
      }
    }).catch(err => {
      console.warn("Gagal update status baca notifikasi di forum:", err.message);
    });

    // Ambil semua commentId di report ini yang belum dibaca oleh user ini
    const comments = await prisma.comment.findMany({
      where: { reportId, deleted: false, userId: { not: userId } },
      select: { commentId: true },
    });

    if (comments.length === 0) return res.json({ marked: 0 });

    const data = comments.map((c) => ({
      commentId: c.commentId,
      userId,
      readAt: new Date(),
    }));

    let marked = 0;
    for (const d of data) {
      await prisma.commentRead.upsert({
        where: { commentId_userId: { commentId: d.commentId, userId: d.userId } },
        create: d,
        update: { readAt: d.readAt },
      });
      marked++;
    }

    // Broadcast read-receipt ke semua di forum
    const readerUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });

    io.to(`forum:${reportId}`).emit("forum:read_receipt", {
      reportId,
      reader: readerUser,
      commentIds: comments.map((c) => c.commentId),
    });

    return res.json({ marked });
  } catch (error: any) {
    console.error("MARK READ ERROR:", error);
    return res.status(500).json({ message: "Error mark read", error: error.message });
  }
};

// ============================================================
// CREATE COMMENT (DENGAN SUPER ADMIN NOTIFICATION FIX)
// ============================================================
export const createComment = async (req: AuthRequest, res: Response) => {
  try {
    const { reportId, content, parentId, image, isReplyToReport } = req.body;
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!reportId || !content)
      return res.status(400).json({ message: "reportId dan content wajib" });

    const access = await checkForumAccess(reportId, userId);
    if (!access.ok) return res.status(access.status).json({ message: access.message });
    const { report } = access;

    if (report.status === "DONE")
      return res.status(403).json({ message: "Forum sudah ditutup" });

    let resolvedParentId: string | null = null;
    if (!isReplyToReport && parentId && parentId !== reportId) {
      const parent = await prisma.comment.findUnique({
        where: { commentId: parentId },
      });
      if (parent) resolvedParentId = parentId;
    }

    const now = new Date();
    const comment = await prisma.comment.create({
      data: {
        reportId,
        content,
        parentId: resolvedParentId,
        userId,
        image: image || null,
        isReplyToReport: isReplyToReport === true,
        updatedAt: now,
      },
      include: {
        user: {
          include: { modelHasRoles: { include: { role: true } } },
        },
        reads: true,
      },
    });

    // ── Auto mark-as-read untuk pengirim sendiri ──────────────
    await prisma.commentRead.upsert({
      where: {
        commentId_userId: { commentId: comment.commentId, userId },
      },
      create: { commentId: comment.commentId, userId, readAt: now },
      update: { readAt: now },
    });

    // ── Broadcast comment baru ke forum room ──────────────────
    const participantIdsForRoom = await getForumParticipantIds(reportId);
    const onlineParticipantIds = participantIdsForRoom.filter(
      (id) => id !== userId && onlineUsers.has(id)
    );
    for (const receiverId of onlineParticipantIds) {
      await prisma.commentDelivered.upsert({
        where: {
          commentId_userId: {
            commentId: comment.commentId,
            userId: receiverId,
          },
        },
        create: {
          commentId: comment.commentId,
          userId: receiverId,
        },
        update: {},
      });
    }

    const updatedComment = await prisma.comment.findUnique({
      where: { commentId: comment.commentId },
      include: {
        user: {
          include: { modelHasRoles: { include: { role: true } } },
        },
        reads: {
          include: { user: { select: { id: true, name: true } } },
        },
        deliveries: true,
      },
    });

    io.to(`forum:${reportId}`).emit(
      "forum:new_comment",
      safeJson({
        ...updatedComment,
        onlineParticipantIds,
      })
    );

    // ============================================================
    // 🔥 NOTIFIKASI KE TIM DAN WEB ADMIN (DISEMPURNAKAN)
    // ============================================================
    try {
      const senderName = comment.user?.name || "Seseorang";

      // 1. Ambil ID Peserta Forum
      let participantIds = await getForumParticipantIds(reportId);

      // 2. Ambil ID semua staf web yang memantau laporan (RBAC: monitoring.view_reports)
      const adminIds = await findUserIdsWithPermission('monitoring.view_reports');

      // 3. Gabungkan Peserta + Admin (Hilangkan duplikat)
      const allTargetIds = [...new Set([...participantIds, ...adminIds])];

      // 4. Jangan kirim notif ke diri sendiri
      const recipientIds = allTargetIds.filter((id) => String(id) !== String(userId));

      if (recipientIds.length > 0) {
        // A. In-App Notification (Simpan ke DB agar lonceng merah di Web/Mobile muncul)
        await prisma.notification.createMany({
          data: recipientIds.map((recipientId) => ({
            userId: recipientId,
            title: "Pesan Baru!",
            message: `${senderName} mengirim pesan di laporan tugas.`,
            category: "NEW_COMMENT",
            relatedId: reportId,
          })),
        });

        // B. Tembak Socket.io SPESIFIK ke Room User (Untuk Real-time Web Dashboard Admin)
        recipientIds.forEach((uid) => {
          io.to(`user:${uid}`).emit('chat:new_message', {
            reportId,
            takenTaskId: report.takenTaskId,
            senderName,
            message: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
            createdAt: now,
            senderAvatar: comment.user?.avatar || null,
            senderId: comment.user?.id || null
          });

          // Trigger umum agar navbar Web Admin otomatis refresh lonceng
          io.to(`user:${uid}`).emit('notification:new', {
            title: "Pesan Baru!",
          });
        });
        console.log(`📡 [Socket.io] Sukses menyiarkan komentar dari ${senderName} ke Tim & Web Admin!`);

        // C. Tembak Expo Push Notification KHUSUS untuk HP (Mengabaikan Admin yg no token)
        const usersToNotify = await prisma.user.findMany({
          where: { id: { in: recipientIds } },
          select: { id: true, name: true, pushToken: true },
        });

        const messages: any[] = [];
        for (const u of usersToNotify) {
          const tu: any = u;
          if (tu.pushToken && Expo.isExpoPushToken(tu.pushToken)) {
            messages.push({
              to: tu.pushToken,
              sound: "default",
              title: "Pesan Baru C-Track! 💬",
              body: `${senderName}: ${content.substring(0, 40)}${content.length > 40 ? "..." : ""}`,
              data: { category: "NEW_COMMENT", relatedId: reportId },
            });
          }
        }

        if (messages.length > 0) {
          const chunks = expo.chunkPushNotifications(messages);
          for (const chunk of chunks) {
            try {
              await expo.sendPushNotificationsAsync(chunk);
            } catch (err) {
              console.error("[Push Notif Expo Error]:", err);
            }
          }
        }
      }
    } catch (notifError) {
      console.error("[Notifikasi Error]:", notifError);
    }
    // ============================================================

    res.status(201).json(safeJson(comment));
  } catch (error: any) {
    console.error("CREATE COMMENT ERROR:", error);
    res.status(500).json({ message: "Error create comment", error: error.message });
  }
};

// ============================================================
// GET COMMENTS BY REPORT
// ============================================================
export const getCommentsByReport = async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    const viewerUserId = (req as any).user?.userId;

    const report = await prisma.report.findUnique({
      where: { reportId },
      include: { takenTask: true, user: true },
    });

    if (!report) return res.status(404).json({ message: "Report tidak ditemukan" });

    const participantIds = await getForumParticipantIds(reportId);

    // Akses forum: peserta (pemilik laporan, karyawan yang ditugaskan, staf monitoring)
    if (!viewerUserId || !participantIds.includes(viewerUserId)) {
      return res.status(403).json({ message: "Anda tidak memiliki akses ke forum laporan ini" });
    }

    const comments = await buildCommentTree(reportId, null, viewerUserId);

    const staffIds = await findUserIdsWithPermission("monitoring.view_reports");
    const adminParticipantIds = staffIds.filter(id => participantIds.includes(id));

    const onlineParticipantIds = participantIds.filter(id => onlineUsers.has(id));
    console.log("PARTICIPANTS:", participantIds);
    console.log("ONLINE USERS:", [...onlineUsers.keys()]);
    console.log("ONLINE PARTICIPANTS:", onlineParticipantIds);
    const safeData = safeJson(comments);

    res.json({
      status: report?.takenTask?.status || "OPEN",
      participantIds,
      adminParticipantIds,
      onlineParticipantIds,
      report: {
        reportId: report.reportId,
        content: report.report,
        image: report.image,
        createdAt: report.createdAt,
        user: report.user,
      },
      comments: safeData,
    });

  } catch (error) {
    console.error("GET COMMENTS ERROR:", error);
    res.status(500).json({ message: "Error get comments", error: String(error) });
  }
};

// ============================================================
// UPDATE COMMENT
// ============================================================
export const updateComment = async (req: AuthRequest, res: Response) => {
  try {
    const { commentId } = req.params;
    const { content, image } = req.body;
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!content?.trim()) return res.status(400).json({ message: "Content wajib diisi" });

    const comment = await prisma.comment.findUnique({
      where: { commentId },
      select: {
        commentId: true, userId: true, reportId: true,
        content: true, image: true, parentId: true,
        createdAt: true, updatedAt: true, deleted: true,
      },
    });

    if (!comment) return res.status(404).json({ message: "Comment tidak ditemukan" });
    if (comment.deleted) return res.status(400).json({ message: "Comment sudah dihapus" });
    if (comment.userId !== userId) return res.status(403).json({ message: "Bukan milik kamu" });

    const updated = await prisma.comment.update({
      where: { commentId },
      data: {
        content: content.trim(),
        updatedAt: new Date(),
        ...(image !== undefined ? { image: image || null } : {}),
      },
      include: {
        user: { include: { modelHasRoles: { include: { role: true } } } },
        reads: true,
      },
    });

    io.to(`forum:${updated.reportId}`).emit("forum:comment_updated", safeJson(updated));
    res.json(safeJson(updated));
  } catch (error: any) {
    console.error("UPDATE COMMENT ERROR:", error);
    res.status(500).json({ message: "Error update comment", error: error.message });
  }
};

// ============================================================
// DELETE COMMENT (SOFT DELETE)
// ============================================================
export const deleteComment = async (req: AuthRequest, res: Response) => {
  try {
    const { commentId } = req.params;
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const comment = await prisma.comment.findUnique({
      where: { commentId },
      select: { commentId: true, userId: true, deleted: true, reportId: true },
    });

    if (!comment) return res.status(404).json({ message: "Comment tidak ditemukan" });
    if (comment.userId !== userId) return res.status(403).json({ message: "Bukan milik kamu" });
    if (comment.deleted) return res.status(400).json({ message: "Sudah dihapus" });

    await prisma.comment.update({
      where: { commentId },
      data: { deleted: true, content: "", image: null, updatedAt: new Date() },
    });

    io.to(`forum:${comment.reportId}`).emit("forum:comment_deleted", { commentId });

    res.json({ message: "Comment berhasil dihapus" });
  } catch (error: any) {
    console.error("DELETE COMMENT ERROR:", error);
    res.status(500).json({ message: "Error delete comment", error: error.message });
  }
};