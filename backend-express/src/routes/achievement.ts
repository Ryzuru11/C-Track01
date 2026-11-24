import { Router } from 'express';
import { getMyAchievementController } from '../controllers/achievement.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get(
  '/me',
  authenticate,
  getMyAchievementController
);

export default router;