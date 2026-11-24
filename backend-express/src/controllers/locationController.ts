import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { io } from '../app';
import { PERMISSION_ROOMS } from '../sockets';
import { assertAssignmentAccess, isAssignedTo } from '../rbac/assignmentAccess';
// Timezone note: Store UTC in DB. Frontend converts to Jakarta via toLocaleTimeString('id-ID').

/**
 * Save location tracking data
 */
export const saveLocation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      id, // client-generated UUID — used for idempotency (optional, falls back to server-generated)
      takenTaskId,
      latitude,
      longitude,
      accuracy,
      address: clientAddress, // optional — mobile may still send it, but we prefer backend geocoding
      trackingStatus,
      recordedAt,
    } = req.body;

    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    // Only the employees assigned to the task may record locations for it
    await assertAssignmentAccess(req.user, takenTaskId);

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    // Reject missing/invalid coordinates with 400 (e.g. mobile heartbeat records with null coords).
    // A 400 tells the mobile upload worker to drop the record instead of retrying it forever.
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new AppError('Invalid latitude/longitude', 400);
    }

    // Address is resolved on the mobile device via reverseGeocodeAsync (Google/Apple geocoding).
    // Fallback to formatted coordinates if mobile didn't send an address.
    const address = (clientAddress || '').trim() || `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

    console.log(`💾 [SAVE] Address="${address.substring(0, 60)}" for (${lat.toFixed(4)}, ${lon.toFixed(4)}), userId=${userId}`);

    // Prefer client-supplied UUID for idempotency. If the mobile retries a failed
    // request the same UUID causes a no-op UPDATE instead of a duplicate INSERT.
    const locationId = (typeof id === 'string' && id.trim()) ? id.trim() : uuidv4();

    const location = await prisma.location.upsert({
      where: { locationId },
      create: {
        locationId,
        takenTaskId,
        userId,
        latitude: lat,
        longitude: lon,
        accuracy: accuracy ? parseFloat(accuracy) : null,
        address,
        trackingStatus: trackingStatus || 'auto',
        recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
      },
      update: {}, // duplicate — first write wins, silently ignore retry
    });

    // Emit real-time location update to admins
    io.to(PERMISSION_ROOMS.LOCATIONS).emit('location:updated', {
      locationId: location.locationId,
      takenTaskId,
      userId,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      recordedAt: location.recordedAt.toISOString(),
    });

    res.status(201).json({
      message: 'Location saved successfully',
      location: {
        ...location,
        recordedAt: location.recordedAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get locations for a taken task
 * Returns locations with address field (resolved via backend reverse geocoding)
 */
export const getLocationsByTakenTask = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId } = req.params;
    const { userId, limit } = req.query;

    const locations = await prisma.location.findMany({
      where: {
        takenTaskId,
        ...(userId && { userId: userId as string }),
      },
      orderBy: { recordedAt: 'desc' },
      take: limit ? parseInt(limit as string) : undefined,
    });

    console.log(`📍 [GET LOCATIONS] Task=${takenTaskId}, userId=${userId}, found=${locations.length} locations`);

    // Server is already in Jakarta timezone, no conversion needed
    const formattedLocations = locations.map((loc, idx) => {
      // Ensure address is never null in response — fallback to formatted coordinates
      const lat = Number(loc.latitude);
      const lon = Number(loc.longitude);
      const address = loc.address || `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

      // Log first 3 locations to verify address is present
      if (idx < 3) {
        console.log(`  📝 [LOC ${idx}] address="${address}", lat=${lat}, lon=${lon}`);
      }
      return {
        ...loc,
        address,
        recordedAt: loc.recordedAt.toISOString(),
      };
    });

    res.json({ locations: formattedLocations });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all locations (for admin monitoring)
 */
export const getAllLocations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId, limit } = req.query;

    const locations = await prisma.location.findMany({
      where: userId ? { userId: userId as string } : undefined,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        takenTask: {
          select: {
            takenTaskId: true,
            ticketNumber: true,
            taskId: true,
            status: true,
          },
        },
      },
      orderBy: { recordedAt: 'desc' },
      take: limit ? parseInt(limit as string) : 100,
    });

    // Get task details separately
    const taskIds = [...new Set(locations.map(l => l.takenTask.taskId))];
    const tasks = await prisma.task.findMany({
      where: { taskId: { in: taskIds } },
      select: {
        taskId: true,
        title: true,
        ticketNumber: true,
      },
    });

    const taskMap = new Map(tasks.map(t => [t.taskId, t]));

    // Combine data and format timestamps
    const enrichedLocations = locations.map(location => {
      const lat = Number(location.latitude);
      const lon = Number(location.longitude);
      return {
        ...location,
        address: location.address || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
        recordedAt: location.recordedAt.toISOString(),
        takenTask: {
          ...location.takenTask,
          task: taskMap.get(location.takenTask.taskId),
        },
      };
    });

    res.json({ locations: enrichedLocations });
  } catch (error) {
    next(error);
  }
};

/**
 * Get latest location per user (for monitoring map)
 */
export const getLatestLocations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1 query — active users
    const users = await prisma.user.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, email: true, avatar: true },
    });

    if (users.length === 0) {
      return res.json({ locations: [] });
    }

    const userIdList = users.map(u => u.id);
    const userMap = new Map(users.map(u => [u.id, u]));

    // 1 query (was N) — latest location per user via INNER JOIN subquery.
    // MySQL returns DECIMAL columns as strings, so we cast with Number() below.
    type RawLoc = {
      location_id: string;
      user_id: string;
      taken_task_id: string;
      latitude: string | number;
      longitude: string | number;
      accuracy: string | number | null;
      address: string | null;
      tracking_status: string;
      recorded_at: Date;
    };

    // ✅ FIX: Removed trailing 'GROUP BY l.user_id' which caused MySQL Error 1055
    const rawLocations = await prisma.$queryRaw<RawLoc[]>`
      SELECT l.location_id, l.user_id, l.taken_task_id,
             l.latitude, l.longitude, l.accuracy,
             l.address, l.tracking_status, l.recorded_at
      FROM locations l
      INNER JOIN (
        SELECT user_id, MAX(recorded_at) AS max_at
        FROM locations
        WHERE user_id IN (${Prisma.join(userIdList)})
        GROUP BY user_id
      ) m ON l.user_id = m.user_id AND l.recorded_at = m.max_at`;

    if (rawLocations.length === 0) {
      return res.json({ locations: [] });
    }

    // 1 query — taken tasks for all found locations
    const takenTaskIds = [...new Set(rawLocations.map(r => r.taken_task_id))];
    const takenTasks = await prisma.takenTask.findMany({
      where: { takenTaskId: { in: takenTaskIds } },
      select: { takenTaskId: true, ticketNumber: true, taskId: true, status: true },
    });
    const takenTaskMap = new Map(takenTasks.map(t => [t.takenTaskId, t]));

    // 1 query — tasks for all taken tasks
    const taskIds = [...new Set(takenTasks.map(t => t.taskId))];
    const tasks = await prisma.task.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, title: true, ticketNumber: true },
    });
    const taskMap = new Map(tasks.map(t => [t.taskId, t]));

    // Assemble response (same shape as before)
    const latestLocations = rawLocations
      .map(loc => {
        const user = userMap.get(loc.user_id);
        const takenTask = takenTaskMap.get(loc.taken_task_id);
        if (!user || !takenTask) return null;
        const lat = Number(loc.latitude);
        const lon = Number(loc.longitude);
        return {
          userId: loc.user_id,
          userName: user.name,
          userEmail: user.email,
          userAvatar: user.avatar,
          location: {
            locationId: loc.location_id,
            takenTaskId: loc.taken_task_id,
            userId: loc.user_id,
            latitude: lat,
            longitude: lon,
            accuracy: loc.accuracy !== null ? Number(loc.accuracy) : null,
            address: loc.address || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
            trackingStatus: loc.tracking_status,
            recordedAt: new Date(loc.recorded_at).toISOString(),
            takenTask: {
              ...takenTask,
              task: taskMap.get(takenTask.taskId),
            },
          },
        };
      })
      .filter(Boolean);

    res.json({ locations: latestLocations });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current locations for users in a taken task (for monitoring map)
 */
export const getCurrentLocationsByTakenTask = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId } = req.params;

    // Get the taken task with user info
    const takenTask = await prisma.takenTask.findUnique({
      where: { takenTaskId },
      select: {
        takenTaskId: true,
        userIds: true,
        taskId: true,
      },
    });

    if (!takenTask) {
      throw new AppError('Taken task not found', 404);
    }

    // Parse user IDs from JSON
    const userIds = Array.isArray(takenTask.userIds) 
      ? takenTask.userIds 
      : JSON.parse(takenTask.userIds as any);

    // Get latest location for each user in this task
    const currentLocations = await Promise.all(
      userIds.map(async (userId: string) => {
        const location = await prisma.location.findFirst({
          where: {
            takenTaskId,
            userId,
          },
          orderBy: { recordedAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                // Exclude avatar to reduce response size (base64 images can be huge)
              },
            },
          },
        });

        if (!location) return null;

        return {
          location_id: location.locationId,
          taken_task_id: location.takenTaskId,
          user_id: location.userId,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          address: location.address,
          tracking_status: location.trackingStatus,
          recorded_at: location.recordedAt.toISOString(),
          user: location.user,
        };
      })
    );

    // Filter out null values (users without location data)
    const validLocations = currentLocations.filter(Boolean);

    res.json({ 
      current_locations: validLocations,
      count: validLocations.length 
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk save location records (from mobile background task)
 * * REQUIREMENTS:
 * - Accept array of location records with client-generated UUID
 * - Use UNIQUE constraint for idempotent behavior
 * - Silently ignore duplicates (same UUID)
 * - Return count of inserted rows
 * * PAYLOAD:
 * [
 * {
 * id: "uuid",
 * takenTaskId: "uuid",
 * userId: "uuid",
 * latitude: number,
 * longitude: number,
 * accuracy: number,
 * recordedAt: number (milliseconds since epoch)
 * }
 * ]
 * * PRODUCTION NOTES:
 * - Validates all inputs before database insertion
 * - ON DUPLICATE KEY UPDATE handles resubmitted batches (idempotent)
 * - Returns actual number of rows inserted
 * - Foreign key errors return 400 (invalid references)
 */
export const bulkSaveLocations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const body = req.body as unknown;

    if (!Array.isArray(body) || body.length === 0) {
      throw new AppError('Invalid request: expected non-empty array', 400);
    }

    // Validate each record strictly: these values end up in a raw INSERT.
    // userId always comes from the token — a body userId is ignored so nobody
    // can record locations on behalf of another employee.
    const locations = body.map((raw: any) => {
      const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
      const isNonEmptyString = (v: unknown, max: number): v is string =>
        typeof v === 'string' && v.trim().length > 0 && v.length <= max;

      const accuracyValid = raw?.accuracy === undefined || raw?.accuracy === null || (isFiniteNumber(raw.accuracy) && raw.accuracy >= 0);
      const addressValid = raw?.address === undefined || raw?.address === null || (typeof raw.address === 'string' && raw.address.length <= 255);

      if (
        !raw || typeof raw !== 'object' ||
        !isNonEmptyString(raw.id, 36) ||
        !isNonEmptyString(raw.takenTaskId, 36) ||
        !isFiniteNumber(raw.latitude) || raw.latitude < -90 || raw.latitude > 90 ||
        !isFiniteNumber(raw.longitude) || raw.longitude < -180 || raw.longitude > 180 ||
        !isFiniteNumber(raw.recordedAt) || raw.recordedAt <= 0 ||
        !accuracyValid || !addressValid
      ) {
        throw new AppError('Invalid location record format', 400);
      }

      return {
        id: raw.id.trim() as string,
        takenTaskId: raw.takenTaskId.trim() as string,
        userId,
        latitude: raw.latitude as number,
        longitude: raw.longitude as number,
        accuracy: (raw.accuracy ?? null) as number | null,
        address: (raw.address ? String(raw.address) : null) as string | null,
        recordedAt: raw.recordedAt as number,
      };
    });

    // Every task in the batch must be assigned to the caller
    const taskIds = [...new Set(locations.map((loc) => loc.takenTaskId))];
    const assignments = await prisma.takenTask.findMany({
      where: { takenTaskId: { in: taskIds } },
      select: { takenTaskId: true, userIds: true },
    });
    for (const taskId of taskIds) {
      const assignment = assignments.find((a) => a.takenTaskId === taskId);
      if (!assignment) {
        throw new AppError('Invalid takenTaskId or userId', 400);
      }
      if (!isAssignedTo(assignment, userId)) {
        throw new AppError('You are not assigned to this task', 403);
      }
    }

    // ── Deduplicate by (takenTaskId, userId, minute-bucket) ──────────────
    // Batch uploads happen when reconnecting after offline. Multiple pings
    // in the same minute are redundant — keep only the one with best accuracy.
    const minuteMap = new Map<string, typeof locations[0]>();

    for (const loc of locations) {
      const d = new Date(loc.recordedAt);
      const minuteKey = `${loc.takenTaskId}__${loc.userId}__${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}-${d.getUTCMinutes()}`;

      const existing = minuteMap.get(minuteKey);
      if (!existing) {
        minuteMap.set(minuteKey, loc);
      } else {
        // Lower accuracy value = better GPS fix; keep the better one
        const existingAcc = existing.accuracy ?? Infinity;
        const newAcc = loc.accuracy ?? Infinity;
        if (newAcc < existingAcc) {
          minuteMap.set(minuteKey, loc);
        }
      }
    }

    const afterMinute = Array.from(minuteMap.values());

    // ── Second pass: distance-based dedup ────────────────────────────────
    // Sort ascending by recordedAt so we walk the path chronologically.
    // Drop any point that is less than MIN_DISTANCE_M meters from the last kept point.
    // This eliminates redundant pings when the user is stationary.
    const MIN_DISTANCE_M = 10; // ignore movement below 10 metres
    afterMinute.sort((a, b) => a.recordedAt - b.recordedAt);
    const deduped: typeof afterMinute = [];
    for (const loc of afterMinute) {
      if (deduped.length === 0) {
        deduped.push(loc); // always keep first
        continue;
      }
      const last = deduped[deduped.length - 1];
      const distM = haversineKm(last.latitude, last.longitude, loc.latitude, loc.longitude) * 1000;
      if (distM >= MIN_DISTANCE_M) {
        deduped.push(loc);
      }
    }

    const droppedMinute  = locations.length - afterMinute.length;
    const droppedDist    = afterMinute.length - deduped.length;
    const dropped        = droppedMinute + droppedDist;

    console.log(`📦 [BULK] received=${locations.length}, after_minute_dedup=${afterMinute.length} (-${droppedMinute}), after_distance_dedup=${deduped.length} (-${droppedDist}), total_dropped=${dropped}`);

    if (deduped.length === 0) {
      return res.json({ message: '0 location records saved', count: 0, dropped, status: 'success' });
    }

    // Parameterized VALUES rows — every value is bound, never concatenated into the SQL text
    const valuesList = deduped.map((loc) => Prisma.sql`(${loc.id}, ${loc.takenTaskId}, ${loc.userId}, ${loc.latitude}, ${loc.longitude}, ${loc.accuracy}, ${loc.address}, FROM_UNIXTIME(${Math.floor(loc.recordedAt / 1000)}), NOW(), NOW())`);

    const insertCount = await prisma.$executeRaw(Prisma.sql`
      INSERT INTO locations
      (location_id, taken_task_id, user_id, latitude, longitude, accuracy, address, recorded_at, created_at, updated_at)
      VALUES
      ${Prisma.join(valuesList)}
      ON DUPLICATE KEY UPDATE
      updated_at = NOW()
    `).catch((error) => {
      if (error.message && error.message.includes('Foreign key')) {
        console.error('⚠️  Foreign key constraint violation:', error.message);
        throw new AppError('Invalid takenTaskId or userId', 400);
      }
      throw error;
    });

    console.log(`✅ Bulk location save: inserted=${insertCount}, dropped=${dropped}`);

    // Emit latest location to admins for real-time map update
    const latest = deduped[deduped.length - 1];
    io.to(PERMISSION_ROOMS.LOCATIONS).emit('location:updated', {
      takenTaskId: latest.takenTaskId,
      userId: latest.userId,
      latitude: latest.latitude,
      longitude: latest.longitude,
      accuracy: latest.accuracy ?? null,
      recordedAt: new Date(latest.recordedAt).toISOString(),
    });

    res.json({
      message: `${insertCount} location records saved`,
      count: insertCount,
      dropped,
      status: 'success',
    });
  } catch (error) {
    console.error('❌ Bulk save locations error:', error);
    next(error);
  }
};

// ── Haversine helper ────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

/**
 * GET /locations/tasks/:takenTaskId/route
 * Returns route coordinates + statistics (distance, duration) for a task.
 * Statistics are computed from the user's ordered location logs.
 * - distance_km : sum of consecutive haversine distances
 * - start_time  : first recorded location
 * - end_time    : last recorded location (or null if task still active)
 * - duration_hours : (end_time - start_time) in hours
 */
export const getTaskRoute = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId } = req.params;
    const { userId } = req.query;

    const locations = await prisma.location.findMany({
      where: {
        takenTaskId,
        ...(userId ? { userId: userId as string } : {}),
      },
      orderBy: { recordedAt: 'asc' },
    });

    if (locations.length === 0) {
      return res.json({
        route: [],
        statistics: {
          total_points: 0,
          distance_km: 0,
          start_time: null,
          end_time: null,
          duration_hours: 0,
        },
      });
    }

    // Build route array
    const route = locations.map(loc => ({
      latitude: loc.latitude,
      longitude: loc.longitude,
      recordedAt: loc.recordedAt.toISOString(),
      address: loc.address || null,
    }));

    // Calculate total distance (sum of consecutive haversine distances)
    let distanceKm = 0;
    for (let i = 1; i < locations.length; i++) {
      distanceKm += haversineKm(
        Number(locations[i - 1].latitude),
        Number(locations[i - 1].longitude),
        Number(locations[i].latitude),
        Number(locations[i].longitude),
      );
    }

    // Check if task is still active
    const takenTask = await prisma.takenTask.findUnique({
      where: { takenTaskId },
      select: { status: true },
    });
    const isActive = takenTask?.status === 'in_progress';

    const startTime = locations[0].recordedAt;
    const endTime = isActive ? null : locations[locations.length - 1].recordedAt;
    const durationMs = endTime
      ? endTime.getTime() - startTime.getTime()
      : Date.now() - startTime.getTime();

    res.json({
      route,
      statistics: {
        total_points: locations.length,
        distance_km: parseFloat(distanceKm.toFixed(3)),
        start_time: startTime.toISOString(),
        end_time: endTime ? endTime.toISOString() : null,
        duration_hours: parseFloat((durationMs / 3_600_000).toFixed(4)),
      },
    });
  } catch (error) {
    next(error);
  }
};