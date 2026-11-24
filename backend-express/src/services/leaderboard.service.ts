import prisma from "../config/database";

type EmployeeLeaderboard = {
  rank?: number;

  userId: string;
  name: string;
  email: string;

  pushToken?: string | null;

  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;

  totalReports: number;

  totalDistanceKm: number;
  totalDurationMs: number;

  completionRate: number;
  reportRate: number;
  activityRate: number;

  behaviorScore: number;

  avgDurationMs: number;
  avgDistanceKm: number;
};

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeBehaviorScore(
  completionRate: number,
  reportRate: number,
  activityRate: number
): number {
  return Math.min(
    100,
    Math.round(
      completionRate * 0.45 +
        reportRate * 0.35 +
        activityRate * 0.2
    )
  );
}

export const getLeaderboard = async (): Promise<EmployeeLeaderboard[]> => {
  const employees = await prisma.user.findMany({
    where: {
      status: "active",
      modelHasRoles: {
        some: {
          role: {
            name: "employee",
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      pushToken: true,
    },
  });

  const takenTasks = await prisma.takenTask.findMany({
    include: {
      task: true,
    },
  });

  const reports = await prisma.report.findMany();

  const locations = await prisma.location.findMany({
    orderBy: {
      recordedAt: "asc",
    },
  });

  // locationMap
  const locationMap: Record<string, any[]> = {};

  locations.forEach((loc) => {
    const key = `${loc.takenTaskId}::${loc.userId}`;

    if (!locationMap[key]) {
      locationMap[key] = [];
    }

    locationMap[key].push(loc);
  });

  Object.keys(locationMap).forEach((key) => {
    locationMap[key].sort(
      (a, b) =>
        new Date(a.recordedAt).getTime() -
        new Date(b.recordedAt).getTime()
    );
  });

  // reportsByUser
  const reportsByUser: Record<string, any[]> = {};

  reports.forEach((report) => {
    if (!reportsByUser[report.userId]) {
      reportsByUser[report.userId] = [];
    }

    reportsByUser[report.userId].push(report);
  });

  // statsMap
  const statsMap: Record<string, any> = {};

  takenTasks.forEach((tt) => {
    let statusesObj: Record<string, string> = {};

    try {
      statusesObj =
        typeof tt.userStatuses === "string"
          ? JSON.parse(tt.userStatuses)
          : (tt.userStatuses as any);
    } catch {
      return;
    }

    Object.entries(statusesObj).forEach(([userId, status]) => {
      // Only active employees are ranked (deactivated or deleted users would show up nameless)
      const user = employees.find((u) => u.id === userId);
      if (!user) return;

      if (!statsMap[userId]) {
        statsMap[userId] = {
        userId,
        name: user?.name || "",
        email: user?.email || "",
        pushToken: user?.pushToken || null,

          totalTasks: 0,
          completedTasks: 0,
          inProgressTasks: 0,
          pendingTasks: 0,

          totalReports: 0,

          totalDistanceKm: 0,
          totalDurationMs: 0,

          taskDurations: [],
          taskDistances: [],
        };
      }

      const s = statsMap[userId];

      s.totalTasks++;

      if (status === "completed") {
        s.completedTasks++;
      } else if (status === "in_progress") {
        s.inProgressTasks++;
      } else {
        s.pendingTasks++;
      }

      const locKey = `${tt.takenTaskId}::${userId}`;
      const locs = locationMap[locKey];

      if (locs && locs.length >= 2) {
        let distance = 0;

        for (let i = 1; i < locs.length; i++) {
          distance += haversineKm(
            parseFloat(String(locs[i - 1].latitude)),
            parseFloat(String(locs[i - 1].longitude)),
            parseFloat(String(locs[i].latitude)),
            parseFloat(String(locs[i].longitude))
          );
        }

        const durationMs =
          new Date(locs[locs.length - 1].recordedAt).getTime() -
          new Date(locs[0].recordedAt).getTime();

        s.totalDistanceKm += distance;
        s.totalDurationMs += durationMs;

        s.taskDistances.push(distance);
        s.taskDurations.push(durationMs);
      }
    });
  });

  Object.keys(statsMap).forEach((uid) => {
    statsMap[uid].totalReports =
      reportsByUser[uid]?.length || 0;
  });

  const leaderboard: EmployeeLeaderboard[] = Object.values(statsMap)
    .filter((s: any) => s.totalTasks > 0)
    .map((s: any) => {
      const completionRate =
        s.totalTasks > 0
          ? Math.round(
              (s.completedTasks / s.totalTasks) * 100
            )
          : 0;

      const reportRate =
        s.completedTasks > 0
          ? Math.min(
              100,
              Math.round(
                (s.totalReports /
                  Math.max(s.completedTasks, 1)) *
                  100
              )
            )
          : 0;

      const activityRate =
        s.totalDistanceKm > 0
          ? Math.min(
              100,
              Math.round(s.totalDistanceKm * 5)
            )
          : 0;

      const behaviorScore = computeBehaviorScore(
        completionRate,
        reportRate,
        activityRate
      );

      const avgDurationMs =
        s.taskDurations.length > 0
          ? s.taskDurations.reduce(
              (a: number, b: number) => a + b,
              0
            ) / s.taskDurations.length
          : 0;

      const avgDistanceKm =
        s.taskDistances.length > 0
          ? s.taskDistances.reduce(
              (a: number, b: number) => a + b,
              0
            ) / s.taskDistances.length
          : 0;

      return {
        userId: s.userId,
        name: s.name,
        email: s.email,
        pushToken: s.pushToken,

        totalTasks: s.totalTasks,
        completedTasks: s.completedTasks,
        inProgressTasks: s.inProgressTasks,
        pendingTasks: s.pendingTasks,

        totalReports: s.totalReports,

        totalDistanceKm: Number(
          s.totalDistanceKm.toFixed(2)
        ),

        totalDurationMs: s.totalDurationMs,

        completionRate,
        reportRate,
        activityRate,

        behaviorScore,

        avgDurationMs,

        avgDistanceKm: Number(
          avgDistanceKm.toFixed(2)
        ),
      };
    });

  leaderboard.sort((a, b) => {
    return (
      b.behaviorScore - a.behaviorScore ||
      b.completedTasks - a.completedTasks
    );
  });

  return leaderboard.map((item, index) => ({
    rank: index + 1,
    ...item,
  }));
};