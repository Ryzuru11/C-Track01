import { getLeaderboard } from './leaderboard.service';

export const getMyAchievement = async (userId: string) => {
  const leaderboard = await getLeaderboard();

  const user = leaderboard.find(
    (item) => item.userId === userId
  );

  if (!user) {
    return null;
  }

  return {
    rank: user.rank,
    score: user.behaviorScore,
    name: user.name,
    totalTasks: user.totalTasks,
    completedTasks: user.completedTasks,

    totalReports: user.totalReports,
    totalDistanceKm: user.totalDistanceKm,

    reportRate: user.reportRate,
    activityRate: user.activityRate,
    completionRate: user.completionRate,

    pendingTasks: user.pendingTasks,
    inProgressTasks: user.inProgressTasks,

    avgDistanceKm: user.avgDistanceKm,
    avgDurationMs: user.avgDurationMs,
  };
};