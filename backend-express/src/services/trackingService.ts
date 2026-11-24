import prisma from '../config/database';

type LocationPoint = {
  latitude: number;
  longitude: number;
  recordedAt: Date;
};

const EARTH_RADIUS_KM = 6371;
const IDLE_SPEED_THRESHOLD_KMH = 2;
const MAX_IDLE_GAP_MINUTES = 15;

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number(value);
};

const parseJsonUserIds = (userIds: unknown): string[] => {
  if (Array.isArray(userIds)) {
    return userIds.filter((item): item is string => typeof item === 'string');
  }

  if (typeof userIds === 'string') {
    try {
      const parsed = JSON.parse(userIds);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }

  return [];
};

const haversineKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const calculateDistanceKm = (points: LocationPoint[]): number => {
  if (points.length < 2) return 0;

  let totalKm = 0;
  for (let i = 1; i < points.length; i++) {
    totalKm += haversineKm(
      points[i - 1].latitude,
      points[i - 1].longitude,
      points[i].latitude,
      points[i].longitude
    );
  }

  return totalKm;
};

const calculateIdleMinutes = (points: LocationPoint[]): number => {
  if (points.length < 2) return 0;

  let idleMinutes = 0;

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];

    const gapMs = current.recordedAt.getTime() - previous.recordedAt.getTime();
    if (gapMs <= 0) continue;

    const gapMinutes = gapMs / 60_000;
    if (gapMinutes > MAX_IDLE_GAP_MINUTES) continue;

    const segmentKm = haversineKm(
      previous.latitude,
      previous.longitude,
      current.latitude,
      current.longitude
    );

    const speedKmh = segmentKm / (gapMs / 3_600_000);
    if (speedKmh <= IDLE_SPEED_THRESHOLD_KMH) {
      idleMinutes += gapMinutes;
    }
  }

  return idleMinutes;
};

const calculateRouteEfficiency = (points: LocationPoint[]): number => {
  if (points.length < 2) return 1;

  const totalKm = calculateDistanceKm(points);
  if (totalKm <= 0) return 1;

  const start = points[0];
  const end = points[points.length - 1];
  const directKm = haversineKm(start.latitude, start.longitude, end.latitude, end.longitude);

  return Number((directKm / totalKm).toFixed(4));
};

const parseMonthRange = (month: string): { start: Date; end: Date } => {
  const isValid = /^\d{4}-\d{2}$/.test(month);
  if (!isValid) {
    throw new Error('month must use YYYY-MM format');
  }

  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;

  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0));

  return { start, end };
};

const parseDayRange = (date: string): { start: Date; end: Date } => {
  const day = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) {
    throw new Error('date must use YYYY-MM-DD format');
  }

  const end = new Date(day);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start: day, end };
};

const expectedTaskDurationMinutes = (taskStartTime: Date, taskEndTime: Date): number => {
  const startMinutes = taskStartTime.getUTCHours() * 60 + taskStartTime.getUTCMinutes();
  const endMinutes = taskEndTime.getUTCHours() * 60 + taskEndTime.getUTCMinutes();

  if (endMinutes >= startMinutes) {
    return endMinutes - startMinutes;
  }

  return 24 * 60 - startMinutes + endMinutes;
};

export const getTrackingLogs = async (
  userId: string,
  startDate: string,
  endDate: string
) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid startDate or endDate');
  }

  const locations = await prisma.location.findMany({
    where: {
      userId,
      recordedAt: {
        gte: start,
        lte: end,
      },
    },
    orderBy: { recordedAt: 'asc' },
    include: {
      takenTask: {
        include: {
          task: {
            select: {
              taskId: true,
              title: true,
              ticketNumber: true,
            },
          },
        },
      },
    },
  });

  const logs = locations.map((item, index) => {
    const previous = index > 0 ? locations[index - 1] : null;
    const segmentKm = previous
      ? haversineKm(
          toNumber(previous.latitude),
          toNumber(previous.longitude),
          toNumber(item.latitude),
          toNumber(item.longitude)
        )
      : 0;

    const segmentDurationHours =
      previous && item.recordedAt > previous.recordedAt
        ? (item.recordedAt.getTime() - previous.recordedAt.getTime()) / 3_600_000
        : 0;

    const speedKmh = segmentDurationHours > 0 ? segmentKm / segmentDurationHours : 0;

    return {
      locationId: item.locationId,
      takenTaskId: item.takenTaskId,
      taskTitle: item.takenTask?.task?.title ?? null,
      latitude: toNumber(item.latitude),
      longitude: toNumber(item.longitude),
      accuracy: item.accuracy !== null ? toNumber(item.accuracy) : null,
      address: item.address,
      trackingStatus: item.trackingStatus,
      recordedAt: item.recordedAt.toISOString(),
      segmentDistanceKm: Number(segmentKm.toFixed(4)),
      estimatedSpeedKmh: Number(speedKmh.toFixed(2)),
    };
  });

  return {
    userId,
    range: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    totalLogs: logs.length,
    logs,
  };
};

export const getDistanceSummary = async (userId: string, date: string) => {
  const { start, end } = parseDayRange(date);

  const locations = await prisma.location.findMany({
    where: {
      userId,
      recordedAt: {
        gte: start,
        lt: end,
      },
    },
    orderBy: { recordedAt: 'asc' },
  });

  const points: LocationPoint[] = locations.map((item) => ({
    latitude: toNumber(item.latitude),
    longitude: toNumber(item.longitude),
    recordedAt: item.recordedAt,
  }));

  const totalDistanceKm = calculateDistanceKm(points);
  const routeEfficiency = calculateRouteEfficiency(points);

  return {
    userId,
    date,
    totalPoints: points.length,
    distanceTraveledKm: Number(totalDistanceKm.toFixed(3)),
    routeEfficiency,
  };
};

export const getIdleTime = async (
  userId: string,
  startDate: string,
  endDate: string
) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid startDate or endDate');
  }

  const locations = await prisma.location.findMany({
    where: {
      userId,
      recordedAt: {
        gte: start,
        lte: end,
      },
    },
    orderBy: { recordedAt: 'asc' },
  });

  const points: LocationPoint[] = locations.map((item) => ({
    latitude: toNumber(item.latitude),
    longitude: toNumber(item.longitude),
    recordedAt: item.recordedAt,
  }));

  const idleMinutes = calculateIdleMinutes(points);
  const activeMinutes =
    points.length > 1
      ? (points[points.length - 1].recordedAt.getTime() - points[0].recordedAt.getTime()) /
        60_000
      : 0;

  return {
    userId,
    range: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    idleMinutes: Number(idleMinutes.toFixed(2)),
    activeWindowMinutes: Number(activeMinutes.toFixed(2)),
    idleRatio: activeMinutes > 0 ? Number((idleMinutes / activeMinutes).toFixed(4)) : 0,
  };
};

export const getDeviationAnalytics = async (userId: string, month: string) => {
  const { start, end } = parseMonthRange(month);

  const takenTasks = await prisma.takenTask.findMany({
    where: {
      date: {
        gte: start,
        lt: end,
      },
    },
    include: {
      task: true,
      locations: {
        where: { userId },
        orderBy: { recordedAt: 'asc' },
      },
    },
  });

  const scopedTasks = takenTasks.filter((item) => parseJsonUserIds(item.userIds).includes(userId));

  const taskAnalytics = scopedTasks.map((item) => {
    const points: LocationPoint[] = item.locations.map((loc) => ({
      latitude: toNumber(loc.latitude),
      longitude: toNumber(loc.longitude),
      recordedAt: loc.recordedAt,
    }));

    const expectedMinutes = expectedTaskDurationMinutes(item.task.startTime, item.task.endTime);

    let actualMinutes = 0;
    if (item.startTime && item.endTime && item.endTime > item.startTime) {
      actualMinutes = (item.endTime.getTime() - item.startTime.getTime()) / 60_000;
    } else if (points.length > 1) {
      actualMinutes =
        (points[points.length - 1].recordedAt.getTime() - points[0].recordedAt.getTime()) / 60_000;
    }

    const deviationMinutes = actualMinutes - expectedMinutes;
    const distanceKm = calculateDistanceKm(points);
    const idleMinutes = calculateIdleMinutes(points);
    const routeEfficiency = calculateRouteEfficiency(points);

    const anomalyFlags: string[] = [];
    if (Math.abs(deviationMinutes) > expectedMinutes * 0.3) {
      anomalyFlags.push('deviation_outlier');
    }
    if (idleMinutes > actualMinutes * 0.25) {
      anomalyFlags.push('high_idle_time');
    }
    if (routeEfficiency < 0.6 && points.length > 5) {
      anomalyFlags.push('low_route_efficiency');
    }

    return {
      takenTaskId: item.takenTaskId,
      ticketNumber: item.ticketNumber,
      taskTitle: item.task.title,
      status: item.status,
      expectedDurationMinutes: Number(expectedMinutes.toFixed(2)),
      actualDurationMinutes: Number(actualMinutes.toFixed(2)),
      deviationMinutes: Number(deviationMinutes.toFixed(2)),
      distanceTraveledKm: Number(distanceKm.toFixed(3)),
      idleMinutes: Number(idleMinutes.toFixed(2)),
      routeEfficiency,
      anomalyFlags,
    };
  });

  const totals = taskAnalytics.reduce(
    (acc, item) => {
      acc.expected += item.expectedDurationMinutes;
      acc.actual += item.actualDurationMinutes;
      acc.deviation += item.deviationMinutes;
      acc.distance += item.distanceTraveledKm;
      acc.idle += item.idleMinutes;
      return acc;
    },
    { expected: 0, actual: 0, deviation: 0, distance: 0, idle: 0 }
  );

  const anomalies = taskAnalytics.filter((item) => item.anomalyFlags.length > 0);

  return {
    userId,
    month,
    summary: {
      totalTasks: taskAnalytics.length,
      expectedDurationMinutes: Number(totals.expected.toFixed(2)),
      actualDurationMinutes: Number(totals.actual.toFixed(2)),
      deviationMinutes: Number(totals.deviation.toFixed(2)),
      distanceTraveledKm: Number(totals.distance.toFixed(3)),
      idleMinutes: Number(totals.idle.toFixed(2)),
      anomalyCount: anomalies.length,
    },
    tasks: taskAnalytics,
    anomalies,
  };
};

export const detectRouteAnomaly = async (userId: string, date: string) => {
  const { start, end } = parseDayRange(date);

  const currentDayLocations = await prisma.location.findMany({
    where: {
      userId,
      recordedAt: {
        gte: start,
        lt: end,
      },
    },
    orderBy: { recordedAt: 'asc' },
  });

  const currentPoints: LocationPoint[] = currentDayLocations.map((item) => ({
    latitude: toNumber(item.latitude),
    longitude: toNumber(item.longitude),
    recordedAt: item.recordedAt,
  }));

  const currentDistanceKm = calculateDistanceKm(currentPoints);
  const currentIdleMinutes = calculateIdleMinutes(currentPoints);
  const currentRouteEfficiency = calculateRouteEfficiency(currentPoints);

  const historicalStart = new Date(start);
  historicalStart.setUTCDate(historicalStart.getUTCDate() - 14);

  const historicalLocations = await prisma.location.findMany({
    where: {
      userId,
      recordedAt: {
        gte: historicalStart,
        lt: start,
      },
    },
    orderBy: { recordedAt: 'asc' },
  });

  const byDay = new Map<string, LocationPoint[]>();
  for (const loc of historicalLocations) {
    const dayKey = loc.recordedAt.toISOString().slice(0, 10);
    const bucket = byDay.get(dayKey) ?? [];
    bucket.push({
      latitude: toNumber(loc.latitude),
      longitude: toNumber(loc.longitude),
      recordedAt: loc.recordedAt,
    });
    byDay.set(dayKey, bucket);
  }

  const historicalDistances = Array.from(byDay.values()).map((points) => calculateDistanceKm(points));

  const meanDistance =
    historicalDistances.length > 0
      ? historicalDistances.reduce((sum, value) => sum + value, 0) / historicalDistances.length
      : 0;

  const variance =
    historicalDistances.length > 0
      ? historicalDistances.reduce((sum, value) => sum + (value - meanDistance) ** 2, 0) /
        historicalDistances.length
      : 0;

  const stdDev = Math.sqrt(variance);
  const zScoreDistance = stdDev > 0 ? (currentDistanceKm - meanDistance) / stdDev : 0;

  const reasons: string[] = [];
  if (currentRouteEfficiency < 0.55 && currentPoints.length > 5) {
    reasons.push('Route efficiency below 55%');
  }
  if (currentIdleMinutes > 120) {
    reasons.push('Idle time exceeds 120 minutes');
  }
  if (zScoreDistance > 2) {
    reasons.push('Distance is significantly above 14-day baseline (z-score > 2)');
  }

  return {
    userId,
    date,
    anomalyDetected: reasons.length > 0,
    reasons,
    metrics: {
      totalPoints: currentPoints.length,
      distanceTraveledKm: Number(currentDistanceKm.toFixed(3)),
      idleMinutes: Number(currentIdleMinutes.toFixed(2)),
      routeEfficiency: currentRouteEfficiency,
      distanceZScore: Number(zScoreDistance.toFixed(3)),
      baselineDistanceKm: Number(meanDistance.toFixed(3)),
      baselineStdDevKm: Number(stdDev.toFixed(3)),
    },
  };
};
