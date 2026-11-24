import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { saveImageToDisk, deleteImageFiles } from '../utils/fileStorage';
import { io } from '../app';
import { PERMISSION_ROOMS } from '../sockets';
import { can } from '../rbac/access';
import { isAssignedTo } from '../rbac/assignmentAccess';
import {
  CapturedReportPhoto,
  MAX_REPORT_PHOTOS,
  MAX_TASK_DISTANCE_METERS,
  distanceInMeters,
  isCapturedReportPhoto,
} from '../utils/reportPhotoValidation';
// import { encrypt, decrypt } from '../utils/encryption'; // Uncomment to use encryption

function validateCapturedPhotos(
  photos: unknown,
  taskLatitude: number | null,
  taskLongitude: number | null
): CapturedReportPhoto[] {
  if (!Array.isArray(photos) || photos.length === 0 || photos.length > MAX_REPORT_PHOTOS) {
    throw new AppError(`Reports must include between 1 and ${MAX_REPORT_PHOTOS} camera photos`, 422);
  }

  if (taskLatitude === null || taskLongitude === null) {
    throw new AppError('Task location is not configured; photo location cannot be verified', 422);
  }

  const taskCoordinates = { latitude: taskLatitude, longitude: taskLongitude };
  const acceptedAt = Date.now();

  return photos.map((photo) => {
    if (!isCapturedReportPhoto(photo)) {
      throw new AppError('Each photo must include a valid, non-mock GPS capture location', 422);
    }

    if (Math.abs(acceptedAt - Date.parse(photo.capturedAt)) > 15 * 60 * 1000) {
      throw new AppError('Photo capture time is too old or invalid; take a new photo', 422);
    }

    const distance = distanceInMeters(taskCoordinates, {
      latitude: photo.latitude,
      longitude: photo.longitude,
    });

    if (distance > MAX_TASK_DISTANCE_METERS) {
      throw new AppError(`Photo must be taken within ${MAX_TASK_DISTANCE_METERS} meters of the task location`, 422);
    }

    return photo;
  });
}

async function saveWatermarkedPhotos(
  photos: CapturedReportPhoto[],
  taskLatitude: number,
  taskLongitude: number
) {
  const serverCapturedAt = new Date();

  return Promise.all(
    photos.map((photo) =>
      saveImageToDisk(photo.image, {
        maxWidth: 1920,
        quality: 75,
        format: 'jpeg',
        createThumbnail: true,
        watermark: {
          latitude: photo.latitude,
          longitude: photo.longitude,
          taskLatitude,
          taskLongitude,
          serverCapturedAt,
        },
      })
    )
  );
}

/**
 * Create a report
 */
export const createReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId, report, photos } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    // Verify taken task exists
    const takenTask = await prisma.takenTask.findUnique({
      where: { takenTaskId },
      include: { task: true },
    });

    if (!takenTask) {
      throw new AppError('Assignment not found', 404);
    }

    // Only the employees assigned to the task may report on it
    if (!isAssignedTo(takenTask, userId)) {
      throw new AppError('You are not assigned to this task', 403);
    }

    const taskLatitude = takenTask.task.latitude === null ? null : Number(takenTask.task.latitude);
    const taskLongitude = takenTask.task.longitude === null ? null : Number(takenTask.task.longitude);
    if (taskLatitude === null || taskLongitude === null) {
      throw new AppError('Task location is not configured; photo location cannot be verified', 422);
    }
    const capturedPhotos = validateCapturedPhotos(photos, taskLatitude, taskLongitude);

    console.log(`📸 Received ${capturedPhotos.length} verified camera photo(s) from mobile app`);
    const savedImages = await saveWatermarkedPhotos(capturedPhotos, taskLatitude, taskLongitude);
    const filenames = savedImages.map((img) => img.filename);
    const imageData = JSON.stringify(filenames);
    console.log(`✅ Saved ${filenames.length} watermarked images to disk: ${filenames.join(', ')}`);

    // Generate unique ticket number with retry logic
    let newReport;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        // Get all reports to find the highest ticket number
        const allReports = await prisma.report.findMany({
          where: {
            ticketNumber: {
              startsWith: 'RPT-',
            },
          },
          select: {
            ticketNumber: true,
          },
        });

        // Find the highest ticket number
        let maxNumber = 0;
        for (const r of allReports) {
          if (r.ticketNumber) {
            const match = r.ticketNumber.match(/^RPT-(\d+)$/);
            if (match) {
              const num = parseInt(match[1], 10);
              if (num > maxNumber) {
                maxNumber = num;
              }
            }
          }
        }

        const ticketNumber = `RPT-${String(maxNumber + 1).padStart(4, '0')}`;

        // Try to create the report
        newReport = await prisma.report.create({
          data: {
            reportId: uuidv4(),
            ticketNumber,
            userId,
            takenTaskId,
            report,
            image: imageData,
            createdAt: new Date(), // Explicitly set created timestamp
          },
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
              include: {
                task: true,
              },
            },
          },
        });

        // Success! Break out of the retry loop
        break;
      } catch (error: any) {
        // Check if it's a unique constraint error on ticket_number
        if (error.code === 'P2002' && error.meta?.target?.includes('ticketNumber')) {
          attempts++;
          if (attempts >= maxAttempts) {
            throw new AppError('Failed to generate unique ticket number after multiple attempts', 500);
          }
          // Add a small delay before retrying
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        // If it's a different error, throw it
        throw error;
      }
    }

    // Emit Socket.io event to notify team members of new report
    try {
      // Get the task details for the socket event
      const taskDetails = await prisma.task.findUnique({
        where: { taskId: takenTask.taskId },
        select: { title: true },
      });

      // Get all user IDs assigned to this task
      const userIds = Array.isArray(takenTask.userIds)
        ? takenTask.userIds
        : JSON.parse(takenTask.userIds as any);

      // Emit to each team member (including the report creator for confirmation)
      userIds.forEach((uid: string) => {
        io.to(`user:${uid}`).emit('report:created', {
          reportId: newReport!.reportId,
          takenTaskId,
          userId,
          userName: newReport!.user.name,
          userAvatar: newReport!.user.avatar || null,
          reportContent: newReport!.report,
          ticketNumber: newReport!.ticketNumber,
          taskTitle: taskDetails?.title || 'Task',
          createdAt: newReport!.createdAt,
        });
      });

      // Also notify admins
      io.to(PERMISSION_ROOMS.REPORTS).emit('report:new', {
        reportId: newReport!.reportId,
        takenTaskId,
        userId,
        userName: newReport!.user.name,
        userAvatar: newReport!.user.avatar || null,
        reportContent: newReport!.report,
        ticketNumber: newReport!.ticketNumber,
        taskTitle: taskDetails?.title || 'Task',
        createdAt: newReport!.createdAt,
      });

      console.log(`📡 Emitted report:created event to ${userIds.length} team member(s)`);
    } catch (socketError) {
      console.error('Error emitting socket event:', socketError);
      // Don't throw - report was created successfully
    }

    res.status(201).json({
      message: 'Report created successfully',
      report: newReport,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all reports
 */
export const getAllReports = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId, userId } = req.query;

    const reports = await prisma.report.findMany({
      where: {
        ...(takenTaskId && { takenTaskId: takenTaskId as string }),
        ...(userId && { userId: userId as string }),
      },
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
      orderBy: { createdAt: 'desc' },
    });

    res.json({ reports });
  } catch (error) {
    next(error);
  }
};

/**
 * Get report by ID
 */
export const getReportById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { reportId } = req.params;

    const report = await prisma.report.findUnique({
      where: { reportId },
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
          include: {
            task: true,
          },
        },
      },
    });

    if (!report) {
      throw new AppError('Report not found', 404);
    }

    // Access: the reporter, employees assigned to the task, or staff who monitor reports
    const viewerId = req.user?.userId;
    const canView =
      can(req.user, 'monitoring.view_reports') ||
      report.userId === viewerId ||
      (report.takenTask && viewerId ? isAssignedTo(report.takenTask, viewerId) : false);
    if (!canView) {
      throw new AppError('You do not have access to this report', 403);
    }

    // Fetch users for the taken task
    if (report.takenTask) {
      const userIds = Array.isArray(report.takenTask.userIds)
        ? report.takenTask.userIds
        : JSON.parse(report.takenTask.userIds as any);

      const users = await prisma.user.findMany({
        where: {
          id: {
            in: userIds,
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          position: true,
          department: true,
        },
      });

      // Add users array to takenTask
      (report.takenTask as any).users = users;
    }

    res.json({ report });
  } catch (error) {
    next(error);
  }
};

/**
 * Update report
 */
export const updateReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { reportId } = req.params;
    const { report: reportText, photos, removePhotos } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    // Get existing report
    const existingReport = await prisma.report.findUnique({
      where: { reportId },
      select: {
        reportId: true,
        userId: true,
        image: true,
        takenTaskId: true,
        takenTask: {
          select: {
            task: {
              select: {
                latitude: true,
                longitude: true,
              },
            },
          },
        },
      },
    });

    if (!existingReport) {
      throw new AppError('Report not found', 404);
    }

    // Check permissions: user can only edit their own reports, unless they manage reports
    const canManageReports = can(req.user, 'monitoring.manage_reports');
    if (!canManageReports && existingReport.userId !== userId) {
      throw new AppError('You can only edit your own reports', 403);
    }

    const updateData: any = {};

    // Update report text if provided
    if (reportText !== undefined) {
      updateData.report = reportText;
    }

    // Handle image updates
    let existingImages: string[] = [];
    if (existingReport.image) {
      try {
        existingImages = JSON.parse(existingReport.image);
      } catch (e) {
        console.error('Error parsing existing images:', e);
      }
    }

    // Remove specific photos if requested
    if (removePhotos && Array.isArray(removePhotos) && removePhotos.length > 0) {
      const imagesToRemove = removePhotos.filter((filename: string) => 
        existingImages.includes(filename)
      );
      
      if (imagesToRemove.length > 0) {
        deleteImageFiles(imagesToRemove);
        existingImages = existingImages.filter(
          (filename) => !imagesToRemove.includes(filename)
        );
        console.log(`🗑️  Removed ${imagesToRemove.length} image(s) from report ${reportId}`);
      }
    }

    // Add new camera photos if provided
    if (photos !== undefined) {
      const taskLatitude = existingReport.takenTask.task.latitude === null
        ? null
        : Number(existingReport.takenTask.task.latitude);
      const taskLongitude = existingReport.takenTask.task.longitude === null
        ? null
        : Number(existingReport.takenTask.task.longitude);
      if (taskLatitude === null || taskLongitude === null) {
        throw new AppError('Task location is not configured; photo location cannot be verified', 422);
      }
      const capturedPhotos = validateCapturedPhotos(photos, taskLatitude, taskLongitude);

      if (existingImages.length + capturedPhotos.length > MAX_REPORT_PHOTOS) {
        throw new AppError(`A report cannot contain more than ${MAX_REPORT_PHOTOS} photos`, 422);
      }

      console.log(`📸 Adding ${capturedPhotos.length} verified camera photo(s) to report`);
      const savedImages = await saveWatermarkedPhotos(capturedPhotos, taskLatitude, taskLongitude);
      const newFilenames = savedImages.map((img) => img.filename);
      existingImages = [...existingImages, ...newFilenames];
      console.log(`✅ Added ${newFilenames.length} watermarked images to report`);
    }

    // Update image field
    updateData.image = existingImages.length > 0 ? JSON.stringify(existingImages) : null;

    // Update report in database
    const updatedReport = await prisma.report.update({
      where: { reportId },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        takenTask: {
          include: {
            task: true,
          },
        },
      },
    });

    // Emit Socket.io event for report update
    try {
      const takenTask = await prisma.takenTask.findUnique({
        where: { takenTaskId: existingReport.takenTaskId },
      });

      if (takenTask) {
        const userIds = Array.isArray(takenTask.userIds)
          ? takenTask.userIds
          : JSON.parse(takenTask.userIds as any);

        userIds.forEach((uid: string) => {
          io.to(`user:${uid}`).emit('report:updated', {
            reportId: updatedReport.reportId,
            takenTaskId: existingReport.takenTaskId,
            userId,
            updatedAt: new Date(),
          });
        });

        io.to(PERMISSION_ROOMS.REPORTS).emit('report:updated', {
          reportId: updatedReport.reportId,
          takenTaskId: existingReport.takenTaskId,
          userId,
          updatedAt: new Date(),
        });
      }
    } catch (socketError) {
      console.error('Error emitting socket event:', socketError);
    }

    res.json({
      message: 'Report updated successfully',
      report: updatedReport,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete report
 */
export const deleteReport = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { reportId } = req.params;

    // Get report to find image filenames
    const report = await prisma.report.findUnique({
      where: { reportId },
      select: { image: true },
    });

    // Delete image files from disk if they exist
    if (report?.image) {
      try {
        const filenames = JSON.parse(report.image);
        if (Array.isArray(filenames) && filenames.length > 0) {
          deleteImageFiles(filenames);
          console.log(`🗑️  Deleted ${filenames.length} image file(s) for report ${reportId}`);
        }
      } catch (error) {
        console.error('Error deleting image files:', error);
      }
    }

    // Delete report from database
    await prisma.report.delete({
      where: { reportId },
    });

    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * Get my reports (employee)
 */
export const getMyReports = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const { startDate, endDate, perPage = '15', page = '1' } = req.query;

    const where: any = { userId };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const pageNum = parseInt(page as string);
    const limit = parseInt(perPage as string);
    const skip = (pageNum - 1) * limit;

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        include: {
          takenTask: {
            include: {
              task: {
                select: {
                  taskId: true,
                  title: true,
                  ticketNumber: true,
                  location: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.report.count({ where }),
    ]);

    res.json({
      reports: {
        data: reports,
        meta: {
          current_page: pageNum,
          per_page: limit,
          total,
          last_page: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get my report statistics (employee)
 */
export const getMyStatistics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Start of current week (Sunday)

    const [totalReports, reportsThisMonth, reportsThisWeek] = await Promise.all([
      prisma.report.count({
        where: { userId },
      }),
      prisma.report.count({
        where: {
          userId,
          createdAt: {
            gte: startOfMonth,
          },
        },
      }),
      prisma.report.count({
        where: {
          userId,
          createdAt: {
            gte: startOfWeek,
          },
        },
      }),
    ]);

    res.json({
      statistics: {
        total_reports: totalReports,
        reports_this_month: reportsThisMonth,
        reports_this_week: reportsThisWeek,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get my tasks with reports (grouped by taken task)
 */
export const getMyTasksWithReports = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    // Get all taken tasks where the user is assigned
    // Since userIds is a JSON field, we need to use string search
    const allTakenTasks = await prisma.takenTask.findMany({
      include: {
        task: {
          select: {
            taskId: true,
            title: true,
            ticketNumber: true,
            location: true,
            description: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter tasks where current user is in userIds array
    const takenTasks = allTakenTasks.filter((task) => {
      const userIds = Array.isArray(task.userIds)
        ? task.userIds
        : JSON.parse(task.userIds as any);
      return userIds.includes(userId);
    });

    // For each taken task, get ALL reports from ALL team members
    const tasksWithReports = await Promise.all(
      takenTasks.map(async (takenTask) => {
        // Get ALL reports for this taken task (from all team members)
        const reports = await prisma.report.findMany({
          where: {
            takenTaskId: takenTask.takenTaskId,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        let hasPhotos = false;
        let photoCount = 0;
        let latestReportDate = takenTask.createdAt || new Date();

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        let reportsThisMonth = 0;
        let reportsThisWeek = 0;

        // Calculate photo stats, latest report date, and monthly/weekly counts
        reports.forEach((report) => {
          if (report.image) {
            hasPhotos = true;
            try {
              const images = JSON.parse(report.image);
              photoCount += Array.isArray(images) ? images.length : 0;
            } catch (e) {
              // Ignore parsing errors
            }
          }

          if (report.createdAt && report.createdAt > latestReportDate) {
            latestReportDate = report.createdAt;
          }

          if (report.createdAt) {
            if (report.createdAt >= startOfMonth) reportsThisMonth++;
            if (report.createdAt >= startOfWeek) reportsThisWeek++;
          }
        });

        return {
          takenTaskId: takenTask.takenTaskId,
          ticketNumber: takenTask.ticketNumber,
          task: takenTask.task,
          date: takenTask.date,
          startTime: takenTask.startTime,
          endTime: takenTask.endTime,
          status: takenTask.status,
          reportCount: reports.length, // Total reports from ALL team members
          reportsThisMonth,
          reportsThisWeek,
          latestReportDate,
          hasPhotos,
          photoCount,
        };
      })
    );

    // Filter out tasks with no reports and sort by latest report date
    const tasksWithReportsFiltered = tasksWithReports
      .filter((task) => task.reportCount > 0)
      .sort((a, b) => b.latestReportDate.getTime() - a.latestReportDate.getTime());

    // Calculate global statistics
    const statsNow = new Date();
    const statsStartOfMonth = new Date(statsNow.getFullYear(), statsNow.getMonth(), 1);
    statsStartOfMonth.setHours(0, 0, 0, 0);
    const statsStartOfWeek = new Date(statsNow.getFullYear(), statsNow.getMonth(), statsNow.getDate() - statsNow.getDay());
    statsStartOfWeek.setHours(0, 0, 0, 0);

    const statistics = {
      total_reports: tasksWithReportsFiltered.reduce((sum, t) => sum + t.reportCount, 0),
      reports_this_month: tasksWithReportsFiltered.reduce((sum, t) => sum + (t.reportsThisMonth || 0), 0),
      reports_this_week: tasksWithReportsFiltered.reduce((sum, t) => sum + (t.reportsThisWeek || 0), 0),
    };

    console.log(`✅ Found ${tasksWithReportsFiltered.length} tasks with reports (from all team members)`);
    console.log(`📊 Statistics:`, statistics);

    res.json({
      tasks: tasksWithReportsFiltered,
      total: tasksWithReportsFiltered.length,
      statistics,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get reports for a specific taken task
 */
export const getReportsForTakenTask = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.userId;
    const { takenTaskId } = req.params;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    // Get the taken task details first
    const takenTask = await prisma.takenTask.findUnique({
      where: { takenTaskId },
      include: {
        task: {
          select: {
            taskId: true,
            title: true,
            ticketNumber: true,
            location: true,
            description: true,
          },
        },
      },
    });

    if (!takenTask) {
      throw new AppError('Task assignment not found', 404);
    }

    console.log(`📊 Fetching reports for task ${takenTaskId} - Current status: "${takenTask.status}"`);

    // Verify user has access to this task
    // - Staff with monitoring.view_reports: Can view all reports (for monitoring)
    // - Employee: Must be assigned to the task
    const canViewAllReports = can(req.user, 'monitoring.view_reports');

    if (!canViewAllReports) {
      // For employees, verify they are assigned to this task
      const userIds = Array.isArray(takenTask.userIds)
        ? takenTask.userIds
        : JSON.parse(takenTask.userIds as any);

      if (!userIds.includes(userId)) {
        throw new AppError('You do not have access to this task', 403);
      }
    }

    // 1. TAMBAHKAN LOG INI UNTUK MELACAK NILAI ASLINYA
    console.log("🕵️‍♂️ CEK VARIABEL takenTaskId:", takenTaskId);

    // 2. PASANG PENGAMAN JIKA NILAINYA KOSONG
    if (!takenTaskId) {
      return res.status(400).json({ 
        message: "Gagal memuat laporan. ID Tugas (takenTaskId) kosong atau tidak terbaca oleh server." 
      });
    }

    // 3. JALANKAN PENCARIAN (Bisa disesuaikan jika butuh Number/String)
    // Get ALL reports for this taken task from ALL team members
    const reports = await prisma.report.findMany({
      where: {
        // Jika schema Prisma kamu meminta String, langsung gunakan takenTaskId
        // Jika schema meminta Int, ubah menjadi: takenTaskId: parseInt(takenTaskId as string)
        takenTaskId: String(takenTaskId), // <-- Dibungkus String() agar formatnya pasti aman
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`✅ Sending task details: status="${takenTask.status}", reports from all team members=${reports.length}`);
    
    // Log image data for debugging
    reports.forEach(r => {
      console.log(`📷 Report ${r.reportId}: image field = ${r.image ? 'exists' : 'null'}, length = ${r.image ? r.image.length : 0}`);
    });

    res.json({
      takenTask,
      reports,
      total: reports.length,
    });
  } catch (error) {
    next(error);
  }
};
// 🔥 FUNGSI INI HARUS ADA DI PALING BAWAH DAN DI LUAR FUNGSI LAIN
export const finishReport = async (req: any, res: any) => {
  try {
    const { reportId } = req.params;

    const report = await prisma.report.update({
      where: { reportId },
      data: {
        status: "DONE",
      },
    });

    res.json({
      message: "Report selesai",
      data: report,
    });
  } catch (error) {
    console.error("FINISH REPORT ERROR:", error);
    res.status(500).json({ message: "Error update report" });
  }
};