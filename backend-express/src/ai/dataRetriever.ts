import prisma from '../config/database';

type RetrievedDataItem = {
  title: string;
  content: string;
};

type OperationalSnapshot = {
  activeUsers: number;
  totalUsers: number;
  activeTasks: number;
  totalTasks: number;
  inProgressAssignments: number;
  completedAssignmentsToday: number;
  reportsToday: number;
  inactiveUsers: number;
  completedTasks: number;
  assignmentsLastWeek: number;
  completedAssignmentsLastWeek: number;
};

const startOfTodayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const previousWeekRangeUtc = () => {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const mondayOffset = (dayOfWeek + 6) % 7;

  const startOfCurrentWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  startOfCurrentWeek.setUTCDate(startOfCurrentWeek.getUTCDate() - mondayOffset);

  const startOfPreviousWeek = new Date(startOfCurrentWeek);
  startOfPreviousWeek.setUTCDate(startOfPreviousWeek.getUTCDate() - 7);

  return {
    start: startOfPreviousWeek,
    end: startOfCurrentWeek,
  };
};

export const isOperationalDataQuestion = (question: string) => {
  const q = question.toLowerCase();
  const operationalKeywords = [
    'user aktif',
    'active user',
    'berapa user',
    'jumlah user',
    'task aktif',
    'jumlah task',
    'laporan hari ini',
    'report hari ini',
    'assignment',
    'in progress',
    'sedang berjalan',
    'statistik',
    'dashboard',
    'task yang dijalankan',
    'dijalankan di minggu',
    'minggu kemarin',
    'last week',
    'weekly',
  ];

  return operationalKeywords.some((keyword) => q.includes(keyword));
};

const buildOperationalSummary = (snapshot: OperationalSnapshot): RetrievedDataItem => {
  return {
    title: 'CTrack Operational Snapshot (Live Data)',
    content: [
      `active_users=${snapshot.activeUsers}`,
      `total_users=${snapshot.totalUsers}`,
      `active_tasks=${snapshot.activeTasks}`,
      `total_tasks=${snapshot.totalTasks}`,
      `assignments_in_progress=${snapshot.inProgressAssignments}`,
      `assignments_completed_today=${snapshot.completedAssignmentsToday}`,
      `reports_today=${snapshot.reportsToday}`,
      `inactive_users=${snapshot.inactiveUsers}`,
      `completed_tasks=${snapshot.completedTasks}`,
      `assignments_last_week=${snapshot.assignmentsLastWeek}`,
      `completed_assignments_last_week=${snapshot.completedAssignmentsLastWeek}`,
      'Jika user menanyakan jumlah task/assignment minggu kemarin, utamakan assignments_last_week atau completed_assignments_last_week sesuai konteks.',
      'Gunakan angka di atas sebagai prioritas untuk menjawab pertanyaan statistik operasional.',
    ].join('; '),
  };
};

export const retrieveLiveDataContext = async (
  question: string,
  options?: { intent?: string }
): Promise<RetrievedDataItem[]> => {
  const shouldRetrieve =
    isOperationalDataQuestion(question) || options?.intent === 'ANALYTICS';

  if (!shouldRetrieve) {
    return [];
  }

  const todayStart = startOfTodayUtc();
  const lastWeek = previousWeekRangeUtc();

  const [
    activeUsers,
    totalUsers,
    activeTasks,
    totalTasks,
    inProgressAssignments,
    completedAssignmentsToday,
    reportsToday,
    inactiveUsers,
    completedTasks,
    assignmentsLastWeek,
    completedAssignmentsLastWeek,
  ] = await Promise.all([
    prisma.user.count({ where: { status: 'active' } }),
    prisma.user.count(),
    prisma.task.count({ where: { status: 'active' } }),
    prisma.task.count(),
    prisma.takenTask.count({ where: { status: 'in_progress' } }),
    prisma.takenTask.count({ where: { status: 'completed', updatedAt: { gte: todayStart } } }),
    prisma.report.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.user.count({ where: { status: 'inactive' } }),
    prisma.task.count({ where: { status: 'completed' } }),
    prisma.takenTask.count({
      where: {
        OR: [
          { date: { gte: lastWeek.start, lt: lastWeek.end } },
          { createdAt: { gte: lastWeek.start, lt: lastWeek.end } },
        ],
      },
    }),
    prisma.takenTask.count({
      where: {
        status: 'completed',
        OR: [
          { date: { gte: lastWeek.start, lt: lastWeek.end } },
          { updatedAt: { gte: lastWeek.start, lt: lastWeek.end } },
        ],
      },
    }),
  ]);

  return [
    buildOperationalSummary({
      activeUsers,
      totalUsers,
      activeTasks,
      totalTasks,
      inProgressAssignments,
      completedAssignmentsToday,
      reportsToday,
      inactiveUsers,
      completedTasks,
      assignmentsLastWeek,
      completedAssignmentsLastWeek,
    }),
  ];
};
