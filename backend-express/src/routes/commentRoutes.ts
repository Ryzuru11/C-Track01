import { Router } from "express";

import {
createComment,
getCommentsByReport,
updateComment,
deleteComment,
markCommentsAsRead,
sendTyping,
} from "../controllers/commentController";

import { authenticate } from "../middleware/auth";

const router = Router();

// =====================================================
// GET COMMENTS
// =====================================================
router.get("/:reportId", authenticate, getCommentsByReport);

// =====================================================
// READ RECEIPT
// =====================================================
router.post("/read", authenticate, markCommentsAsRead);

// =====================================================
// TYPING INDICATOR
// =====================================================
router.post("/typing", authenticate, sendTyping);

// =====================================================
// CREATE COMMENT
// =====================================================
router.post("/", authenticate, createComment);

// =====================================================
// UPDATE COMMENT
// =====================================================
router.put("/:commentId", authenticate, updateComment);

// =====================================================
// DELETE COMMENT
// =====================================================
router.delete("/:commentId", authenticate, deleteComment);

export default router;
