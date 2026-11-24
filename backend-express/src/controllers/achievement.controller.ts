import { Request, Response } from 'express';
import { getMyAchievement } from '../services/achievement.service';

export const getMyAchievementController = async (
  req: Request,
  res: Response
) => {
  try {
    const userId = (req as any).user.userId;

    const achievement = await getMyAchievement(userId);

    return res.status(200).json({
      success: true,
      data: achievement,
    });
  } catch (error) {
    console.error('Achievement Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
};