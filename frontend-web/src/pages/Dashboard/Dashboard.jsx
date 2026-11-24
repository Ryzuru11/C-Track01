import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';
import MetricCard from './MetricCard';
import { getTasks, getUsers, getAssignments, getReports, getLatestLocations } from '../../services/api';

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const hasInitiatedLoad = useRef(false); // Prevent double loading in StrictMode
  const [currentTime, setCurrentTime] = useState(new Date());
  const [recentReports, setRecentReports] = useState([]);
  const [problematicEmployees, setProblematicEmployees] = useState([]);
  const [analytics, setAnalytics] = useState({
    completionRate: 0,
    activeRate: 0,
    issueRate: 0,
    issueDistribution: { pendingTooLong: 0, noActivity: 0, noReport: 0, reportOverdue: 0 },
    weeklyActivity: [0, 0, 0, 0, 0, 0, 0], // Sun-Sat
    weeklyTasks: [0, 0, 0, 0, 0, 0, 0],    // Sun-Sat
    topPerformers: [],
    avgReportsPerEmployee: 0,
    inProgressCount: 0,
    pendingCount: 0,
    completedCount: 0,
  });
  const [metrics, setMetrics] = useState([
    { title: 'Team Size', value: '0', change: '', subtitle: 'Registered employees', trend: 'neutral', icon: 'team', variant: 'dark' },
    { title: 'Issues Detected', value: '0', change: '', subtitle: 'Employees needing attention', trend: 'neutral', icon: 'warning' },
    { title: 'Completion Rate', value: '0%', change: '', subtitle: 'Assignments finished', trend: 'neutral', icon: 'trend' },
    { title: 'Active Assignments', value: '0', change: '', subtitle: 'In progress right now', trend: 'neutral', icon: 'lightning' },
    { title: 'Completed', value: '0', change: '', subtitle: 'Successfully finished', trend: 'neutral', icon: 'check' },
    { title: 'Total Tasks', value: '0', change: '', subtitle: 'All tasks in system', trend: 'neutral', icon: 'clipboard' },
  ]);

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (hasInitiatedLoad.current) return;
    hasInitiatedLoad.current = true;

    const fetchDashboardData = async () => {
      try {
        setLoading(true);

        // ✅ PERBAIKAN: Fetch all data in parallel dengan pelindung Anti-Error (.catch)
        const [tasksRes, usersRes, assignmentsRes, reportsRes, locationsRes] = await Promise.all([
          getTasks().catch(e => { console.error('Tasks API Error:', e); return { data: { tasks: [] } }; }),
          getUsers().catch(e => { console.error('Users API Error:', e); return { data: { users: [] } }; }),
          getAssignments().catch(e => { console.error('Assignments API Error:', e); return { data: { takenTasks: [] } }; }),
          getReports({ limit: 5, sort: 'createdAt:desc' }).catch(e => { console.error('Reports API Error:', e); return { data: { reports: [] } }; }),
          getLatestLocations().catch(e => { 
            console.error('Locations API Error (500): Mengabaikan data lokasi...', e); 
            return { data: { locations: [] } }; 
          })
        ]);

        // Fungsi cerdas untuk membuka bungkus ".data" dari Axios
        const extractData = (res, key) => res?.data?.[key] || res?.[key] || [];

        const allTasks = extractData(tasksRes, 'tasks');
        const users = extractData(usersRes, 'users');
        const takenTasks = extractData(assignmentsRes, 'takenTasks');
        const allReports = extractData(reportsRes, 'reports');
        const locations = extractData(locationsRes, 'locations');

        // Set recent reports (limit to 5)
        setRecentReports(allReports.slice(0, 5));

        // Analyze problematic employees
        const problematic = [];

        // Debug logging
        console.log('🔍 Dashboard Analysis: Loading data...');
        console.log(`  Users: ${users.length} | Tasks: ${allTasks.length} | Taken: ${takenTasks.length}`);

        // Create location map for quick lookup (userId -> location data)
        const locationMap = {};
        locations.forEach(loc => {
          locationMap[loc.userId] = loc;
        });

        // Create task map for quick lookup (taskId -> task)
        const taskMap = {};
        allTasks.forEach(t => {
          taskMap[t.taskId || t.id] = t;
        });

        // Create report map for quick lookup (userId-taskId -> reports)
        const reportMap = {};
        allReports.forEach(report => {
          // Get taskId from report.takenTask.taskId (not report.taskId)
          const taskId = report.takenTask?.taskId;
          if (!taskId) return; // Skip if no taskId found

          const key = `${report.userId}-${taskId}`;
          if (!reportMap[key]) {
            reportMap[key] = [];
          }
          reportMap[key].push(report);
        });

        // Sort reports by createdAt desc for each key
        Object.keys(reportMap).forEach(key => {
          reportMap[key].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        });

        // Analyze each taken task
        takenTasks.forEach((task, index) => {
          const userStatuses = task.user_statuses || task.userStatuses;

          if (userStatuses) {
            let statusesObj;
            if (typeof userStatuses === 'string') {
              try {
                statusesObj = JSON.parse(userStatuses);
              } catch (e) {
                console.error('Failed to parse userStatuses:', e);
                statusesObj = {};
              }
            } else {
              statusesObj = userStatuses;
            }

            // Check each user in this task
            Object.entries(statusesObj).forEach(([userId, status]) => {
              const user = users.find(u => u.id === userId);
              if (!user) return;

              // Get task details from taskMap
              const taskDetails = taskMap[task.taskId];
              const taskTitle = taskDetails?.title || task.title || 'Untitled Task';

              // Use takenTask startTime for assignment tracking
              const now = new Date();
              const assignmentCreatedAt = task.startTime ? new Date(task.startTime) : null;
              const hoursSinceAssigned =
                !assignmentCreatedAt || isNaN(assignmentCreatedAt.getTime())
                  ? 0
                  : (now - assignmentCreatedAt) / (1000 * 60 * 60);

              let issue = null;
              let severity = 'low';
              let duration = '';
              let lastLocation = 'Unknown';
              let inactiveHours = null;

              // Get location data
              const userLocation = locationMap[userId];
              let lastActivityTime = null;
              let locationInactiveHours = null;

              if (userLocation && userLocation.location) {
                lastLocation = userLocation.location.address || 'Unknown';
                lastActivityTime = new Date(userLocation.location.recordedAt);
                locationInactiveHours = (now - lastActivityTime) / (1000 * 60 * 60);
              }

              // Get report data (latest report for this user in this task)
              const reportKey = `${userId}-${task.taskId}`;
              const userReports = reportMap[reportKey] || [];
              let lastReportTime = null;
              let reportInactiveHours = null;

              if (userReports.length > 0) {
                // Reports are sorted by createdAt desc, so first is latest
                lastReportTime = new Date(userReports[0].createdAt);
                reportInactiveHours = (now - lastReportTime) / (1000 * 60 * 60);
              }

              // Calculate overall inactivity: use the LATEST timestamp between location and report
              if (lastActivityTime || lastReportTime) {
                const times = [lastActivityTime, lastReportTime].filter(t => t !== null);
                const latestTime = new Date(Math.max(...times.map(t => t.getTime())));
                inactiveHours = (now - latestTime) / (1000 * 60 * 60);
              }

              // Check issues with priority (only set one issue per user-task)
              if (status === 'pending' && hoursSinceAssigned > 2) {
                issue = 'Pending Too Long';
                severity = 'high';
                duration = `${Math.floor(hoursSinceAssigned)}h`;
              }
              else if (status === 'in_progress') {
                if (inactiveHours !== null && inactiveHours > 2) {
                  issue = 'No Activity';
                  severity = 'high';
                  duration = `${Math.floor(inactiveHours)}h`;
                }
                else if (locationInactiveHours !== null) {
                  if (!lastReportTime) {
                    issue = 'No Report Submitted';
                    severity = 'medium';
                    duration = `${Math.floor(locationInactiveHours)}h`;
                  } else if (reportInactiveHours !== null && reportInactiveHours > 2) {
                    issue = 'Report Overdue';
                    severity = 'medium';
                    duration = `${Math.floor(reportInactiveHours)}h`;
                  }
                }
              }

              // Add to problematic list if issue found
              if (issue) {
                const isPending = status === 'pending';
                const latestActivityTime = isPending ? null : (lastActivityTime || lastReportTime);
                const lastActivityFormatted = latestActivityTime
                  ? latestActivityTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                  : null;

                const idleH = (!isPending && inactiveHours) ? Math.floor(inactiveHours) : null;
                const idleMin = (!isPending && inactiveHours) ? Math.round((inactiveHours % 1) * 60) : null;
                const idleDuration = idleH !== null
                  ? (idleH > 0 ? `${idleH}j ${idleMin}m` : `${idleMin}m`)
                  : null;

                problematic.push({
                  userId,
                  userName: user.name,
                  userEmail: user.email,
                  phoneNumber: user.phoneNumber || null,
                  taskId: task.taskId,
                  takenTaskId: task.takenTaskId || task.taskId,
                  taskTitle: taskTitle,
                  ticketNumber: task.ticketNumber,
                  status: status,
                  issue,
                  severity,
                  duration,
                  lastLocation: isPending ? 'Unknown' : lastLocation,
                  inactiveHours: idleH,
                  lastActivityFormatted,
                  idleDuration,
                  latitude: isPending ? null : (userLocation?.location?.latitude ?? null),
                  longitude: isPending ? null : (userLocation?.location?.longitude ?? null),
                  trackingStatus: isPending ? null : (userLocation?.location?.trackingStatus ?? null),
                  hasLocation: isPending ? false : !!lastActivityTime,
                  hasReport: isPending ? false : !!lastReportTime,
                });
              }
            });
          }
        });

        // Sort by severity (high > medium > low)
        const severityOrder = { high: 3, medium: 2, low: 1 };
        problematic.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);

        if (problematic.length > 0) {
          console.log(`⚠️ Issues Alert: ${problematic.length} employee(s) require attention`);
        }

        setProblematicEmployees(problematic);

        // Count assignments by status from takenTasks
        let pendingAssignments = 0;
        let completedAssignments = 0;
        let inProgressAssignments = 0;

        // Per-user completion tracking
        const userCompletionMap = {}; // userId -> { completed, total }

        takenTasks.forEach((task) => {
          const userStatuses = task.user_statuses || task.userStatuses;
          if (userStatuses) {
            let statusesObj;
            if (typeof userStatuses === 'string') {
              try { statusesObj = JSON.parse(userStatuses); } catch (e) { statusesObj = {}; }
            } else {
              statusesObj = userStatuses;
            }
            const statuses = Object.values(statusesObj);
            const allCompleted = statuses.every(s => s === 'completed');
            const anyInProgress = statuses.some(s => s === 'in_progress');

            if (allCompleted) completedAssignments++;
            else if (anyInProgress) inProgressAssignments++;
            else pendingAssignments++;

            // Per-user tracking
            Object.entries(statusesObj).forEach(([uid, st]) => {
              if (!userCompletionMap[uid]) userCompletionMap[uid] = { completed: 0, total: 0, name: '' };
              userCompletionMap[uid].total++;
              if (st === 'completed') userCompletionMap[uid].completed++;
              const usr = users.find(u => u.id === uid);
              if (usr) userCompletionMap[uid].name = usr.name;
            });
          }
        });

        // Completion rate
        const totalAssignments = pendingAssignments + completedAssignments + inProgressAssignments;
        const completionRate = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0;

        // Active rate (users with location in last 2h)
        const now2 = new Date();
        const recentlyActiveUsers = locations.filter(loc => {
          const t = loc.location?.recordedAt ? new Date(loc.location.recordedAt) : null;
          return t && (now2 - t) / (1000 * 60 * 60) < 2;
        }).length;
        const totalUsers2 = users.length || 1;
        const activeRate = Math.round((recentlyActiveUsers / totalUsers2) * 100);

        // Issue rate
        const issueRate = totalAssignments > 0 ? Math.round((problematic.length / totalUsers2) * 100) : 0;

        // Issue distribution
        const issueDistribution = { pendingTooLong: 0, noActivity: 0, noReport: 0, reportOverdue: 0 };
        problematic.forEach(p => {
          if (p.issue === 'Pending Too Long') issueDistribution.pendingTooLong++;
          else if (p.issue === 'No Activity') issueDistribution.noActivity++;
          else if (p.issue === 'No Report Submitted') issueDistribution.noReport++;
          else if (p.issue === 'Report Overdue') issueDistribution.reportOverdue++;
        });

        // Weekly activity (reports by day of week)
        const weeklyActivity = [0, 0, 0, 0, 0, 0, 0];
        allReports.forEach(r => {
          const d = new Date(r.createdAt).getDay(); // 0=Sun
          weeklyActivity[d]++;
        });

        // Weekly tasks completed
        const weeklyTasks = [0, 0, 0, 0, 0, 0, 0];
        takenTasks.forEach(task => {
          const userStatuses = task.user_statuses || task.userStatuses;
          if (!userStatuses) return;
          let statusesObj;
          if (typeof userStatuses === 'string') {
            try { statusesObj = JSON.parse(userStatuses); } catch (e) { return; }
          } else {
            statusesObj = userStatuses;
          }
          const allCompleted = Object.values(statusesObj).every(s => s === 'completed');
          if (allCompleted && task.updatedAt) {
            const d = new Date(task.updatedAt).getDay();
            weeklyTasks[d]++;
          }
        });

        // Top performers by completion count
        const topPerformers = Object.entries(userCompletionMap)
          .filter(([, v]) => v.total > 0)
          .map(([uid, v]) => ({
            userId: uid,
            name: v.name || uid,
            completed: v.completed,
            total: v.total,
            rate: Math.round((v.completed / v.total) * 100),
          }))
          .sort((a, b) => b.completed - a.completed || b.rate - a.rate)
          .slice(0, 5);

        // Avg reports per employee
        const reportsByUser = {};
        allReports.forEach(r => {
          reportsByUser[r.userId] = (reportsByUser[r.userId] || 0) + 1;
        });
        const reportValues = Object.values(reportsByUser);
        const avgReportsPerEmployee = reportValues.length > 0
          ? Math.round(reportValues.reduce((a, b) => a + b, 0) / reportValues.length)
          : 0;

        setAnalytics({
          completionRate,
          activeRate,
          issueRate,
          issueDistribution,
          weeklyActivity,
          weeklyTasks,
          topPerformers,
          avgReportsPerEmployee,
          inProgressCount: inProgressAssignments,
          pendingCount: pendingAssignments,
          completedCount: completedAssignments,
        });

        const totalUsers = users.length;
        const totalTasksCount = allTasks.length;

        // Update metrics with real data
        setMetrics([
          {
            title: 'Team Size',
            value: totalUsers.toString(),
            change: '',
            subtitle: 'Registered employees',
            trend: 'neutral',
            icon: 'team',
            variant: 'dark'
          },
          {
            title: 'Issues Detected',
            value: problematic.length.toString(),
            change: '',
            subtitle: 'Employees needing attention',
            trend: problematic.length === 0 ? 'success' : problematic.length > 3 ? 'down' : 'pending',
            icon: 'warning'
          },
          {
            title: 'Completion Rate',
            value: `${completionRate}%`,
            change: '',
            subtitle: 'Assignments finished',
            trend: completionRate >= 70 ? 'success' : completionRate >= 40 ? 'pending' : 'down',
            icon: 'trend'
          },
          {
            title: 'Active Assignments',
            value: inProgressAssignments.toString(),
            change: '',
            subtitle: 'In progress right now',
            trend: inProgressAssignments > 0 ? 'up' : 'neutral',
            icon: 'lightning'
          },
          {
            title: 'Completed',
            value: completedAssignments.toString(),
            change: '',
            subtitle: 'Successfully finished',
            trend: 'success',
            icon: 'check'
          },
          {
            title: 'Total Tasks',
            value: totalTasksCount.toString(),
            change: '',
            subtitle: 'All tasks in system',
            trend: 'neutral',
            icon: 'clipboard'
          },
        ]);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  return (
    <div className="main-content">
      <header className="content-header">
        <div>
          <h1>Dashboard</h1>
          <span className="dashboard-subtitle">Behavior & performance overview</span>
        </div>
        <div className="header-time">
          <div className="time-display">
            <span className="time-main">{currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className="time-date">{currentTime.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="dashboard-loading">
          <div className="spinner"></div>
          <p>Loading analytics data...</p>
        </div>
      ) : (
        <>
          {/* ── Row 1: Metric Cards (6) ── */}
          <div className="metrics-grid metrics-grid-6">
            {metrics.map((metric, index) => (
              <MetricCard key={index} {...metric} />
            ))}
          </div>

          {/* ── Row 2: Behavior Analytics panels ── */}
          <div className="analytics-row">

            {/* Issue Type Breakdown */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <div className="analytics-card-header-left">
                  <div className="analytics-icon analytics-icon--breakdown">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                    </svg>
                  </div>
                  <div>
                    <span className="analytics-card-title">Issue Breakdown</span>
                    <span className="analytics-card-subtitle">Current period issues</span>
                  </div>
                </div>
              </div>
              <div className="issue-breakdown">
                {(() => {
                  const { pendingTooLong, noActivity, noReport, reportOverdue } = analytics.issueDistribution;
                  const totalIssues = pendingTooLong + noActivity + noReport + reportOverdue;
                  const items = [
                    { label: 'Pending Too Long', count: pendingTooLong, color: '#EF4444' },
                    { label: 'No Activity', count: noActivity, color: '#F97316' },
                    { label: 'No Report Submitted', count: noReport, color: '#F59E0B' },
                    { label: 'Report Overdue', count: reportOverdue, color: '#FACC15' },
                  ];

                  const healthScore = Math.max(0, 100 - (pendingTooLong * 15 + noActivity * 12 + noReport * 8 + reportOverdue * 5));
                  const scoreColor = healthScore >= 80 ? '#22C55E' : healthScore >= 60 ? '#F97316' : healthScore >= 40 ? '#F97316' : '#EF4444';

                  return (
                    <>
                      {items.map((item) => (
                        <div key={item.label} className="issue-breakdown-row">
                          <div className="issue-breakdown-row-top">
                            <div className="issue-breakdown-label">
                              <span className="issue-breakdown-dot" style={{ background: item.color }}></span>
                              <span>{item.label}</span>
                            </div>
                            <span className="issue-breakdown-count">{item.count}</span>
                          </div>
                          <div className="issue-breakdown-track">
                            <div
                              className="issue-breakdown-fill"
                              style={{ width: totalIssues > 0 ? `${Math.round((item.count / totalIssues) * 100)}%` : '0%', background: item.color }}
                            ></div>
                          </div>
                        </div>
                      ))}
                      <div className="health-score-display">
                        <div className="health-score-left">
                          <span className="health-score-dot" style={{ background: scoreColor }}></span>
                          <span className="health-score-text">System health</span>
                        </div>
                        <div className="health-score-right">
                          <span className="health-score-value" style={{ color: scoreColor }}>{healthScore}</span>
                          <span className="health-score-label">Health Score</span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Completion Funnel */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <div className="analytics-card-header-left">
                  <div className="analytics-icon analytics-icon--funnel">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 3v12" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 1-9 9" />
                      <circle cx="18" cy="6" r="3" />
                    </svg>
                  </div>
                  <div>
                    <span className="analytics-card-title">Assignment Funnel</span>
                    <span className="analytics-card-subtitle">Task status distribution</span>
                  </div>
                </div>
              </div>
              <div className="funnel-container">
                {(() => {
                  const completed = analytics.completedCount || 0;
                  const inProg = analytics.inProgressCount || 0;
                  const pending = analytics.pendingCount || 0;
                  const safeTotal = Math.max(completed + inProg + pending, 1);
                  const bars = [
                    { label: 'Pending', count: pending, color: '#F59E0B', pct: Math.round((pending / safeTotal) * 100) },
                    { label: 'In Progress', count: inProg, color: '#3B82F6', pct: Math.round((inProg / safeTotal) * 100) },
                    { label: 'Completed', count: completed, color: '#22C55E', pct: Math.round((completed / safeTotal) * 100) },
                  ];
                  const rateColor = analytics.completionRate >= 70 ? '#22C55E' : analytics.completionRate >= 40 ? '#F97316' : '#EF4444';
                  return (
                    <>
                      {bars.map((b) => (
                        <div key={b.label} className="funnel-bar-row">
                          <div className="funnel-bar-row-top">
                            <div className="funnel-label">
                              <span>{b.label}</span>
                            </div>
                            <span className="funnel-count">{b.count}</span>
                          </div>
                          <div className="funnel-bar-track">
                            <div className="funnel-bar-fill" style={{ width: `${b.pct}%`, background: b.color }}></div>
                          </div>
                        </div>
                      ))}
                      <div className="funnel-rate">
                        <div className="funnel-rate-left">
                          <span className="funnel-rate-dot" style={{ background: '#22C55E', display: 'inline-block', width: 8, height: 8, borderRadius: '50%' }}></span>
                          <span className="funnel-rate-label">Completion rate</span>
                        </div>
                        <div className="funnel-rate-right">
                          <span className="funnel-rate-value" style={{ color: rateColor }}>{analytics.completionRate}%</span>
                          <span className="funnel-rate-sublabel">of all tasks</span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Weekly Activity Heatmap */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <div className="analytics-card-header-left">
                  <div className="analytics-icon analytics-icon--activity">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <div>
                    <span className="analytics-card-title">Report Activity</span>
                    <span className="analytics-card-subtitle">Weekly overview</span>
                  </div>
                </div>
              </div>
              <div className="weekly-activity">
                <div className="weekly-grid-lines">
                  <div className="weekly-grid-line"></div>
                  <div className="weekly-grid-line"></div>
                  <div className="weekly-grid-line"></div>
                  <div className="weekly-grid-line"></div>
                </div>
                <div className="weekly-bars-container">
                  {(() => {
                    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                    const max = Math.max(...analytics.weeklyActivity, ...analytics.weeklyTasks, 1);
                    return analytics.weeklyActivity.map((reportCount, i) => {
                      const taskCount = analytics.weeklyTasks[i] || 0;
                      return (
                        <div key={days[i]} className="weekly-bar-col">
                          <div className="weekly-bar-group">
                            <div className="weekly-bar-track">
                              <div
                                className="weekly-bar-fill"
                                style={{ height: `${Math.round((reportCount / max) * 100)}%`, background: '#3B82F6' }}
                              ></div>
                            </div>
                            <div className="weekly-bar-track">
                              <div
                                className="weekly-bar-fill"
                                style={{ height: `${Math.round((taskCount / max) * 100)}%`, background: '#22C55E' }}
                              ></div>
                            </div>
                          </div>
                          <span className="weekly-bar-label">{days[i]}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
              <div className="weekly-avg">
                <div className="weekly-legend">
                  <span className="weekly-legend-dot" style={{ background: '#3B82F6' }}></span>
                  <span className="weekly-legend-label">Reports</span>
                  <span className="weekly-legend-dot" style={{ background: '#22C55E', marginLeft: 10 }}></span>
                  <span className="weekly-legend-label">Tasks Completed</span>
                </div>
                <span>Avg {analytics.avgReportsPerEmployee} reports/employee</span>
              </div>
            </div>

          </div>

          {/* ── Row 3: Issues Alert + Recent Reports ── */}
          <div className="dashboard-content-grid">

            {/* Issues Alert */}
            <div className="problematic-section">
              <div className="section-header">
                <div className="section-header-left">
                  <div className="section-header-icon section-header-icon--alert">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <div>
                    <h2>Issues Alerts</h2>
                    <span className="section-subtitle">
                      {problematicEmployees.length > 0
                        ? `${problematicEmployees.length} employee${problematicEmployees.length > 1 ? 's' : ''} requiring attention`
                        : 'Real-time employee behavior monitor'}
                    </span>
                  </div>
                </div>
                {problematicEmployees.length > 0 && (
                  <div className="alert-summary-pills">
                    {['high', 'medium', 'low'].map(sev => {
                      const count = problematicEmployees.filter(e => e.severity === sev).length;
                      if (!count) return null;
                      const labels = { high: 'Critical', medium: 'Warning', low: 'Minor' };
                      return (
                        <span key={sev} className={`alert-pill alert-pill--${sev}`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                          </svg>
                          {labels[sev]} {count}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {problematicEmployees.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">✅</span>
                  <p>All employees on track</p>
                  <span className="empty-text">No issues detected</span>
                </div>
              ) : (
                <div className="monitor-list">
                  {problematicEmployees.map((emp, index) => {
                    const severityLabel = { high: 'CRITICAL', medium: 'WARNING', low: 'MINOR' }[emp.severity];
                    const issueIcon = {
                      'No Activity': (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
                        </svg>
                      ),
                      'Pending Too Long': (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                      )
                    }[emp.issue] || (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      );

                    const issueMsg = {
                      'No Activity': `No location or report activity detected for the past ${emp.idleDuration ? emp.idleDuration.replace('j', 'h').replace('m', 'm') : (emp.duration ? emp.duration.replace('h', ' hours') : '')}.`,
                      'No Report Submitted': `GPS tracking active for ${emp.duration ? emp.duration.replace('h', ' hours') : ''} but no report submitted.`,
                      'Report Overdue': `Last report sent ${emp.idleDuration ? emp.idleDuration.replace('j', 'h').replace('m', 'm') : (emp.duration ? emp.duration.replace('h', ' hours') : '')} ago.`,
                      'Pending Too Long': `Task has been assigned for ${emp.duration ? emp.duration.replace('h', ' hours') : ''} but has not yet been started.`,
                    }[emp.issue] || emp.issue;

                    return (
                      <div key={index} className={`monitor-card monitor-card--${emp.severity}`}>
                        {/* Severity stripe */}
                        <div className={`monitor-stripe monitor-stripe--${emp.severity}`}></div>

                        {/* Col 1: Employee */}
                        <div className="monitor-col monitor-col--employee">
                          <span className={`severity-badge severity-badge--${emp.severity}`}>{severityLabel}</span>
                          <div className="monitor-employee-name">{emp.userName}</div>
                          <div className="monitor-employee-email">{emp.userEmail}</div>
                        </div>

                        {/* Col 2: Task */}
                        <div className="monitor-col monitor-col--task">
                          <div className="monitor-task-title">{emp.taskTitle}</div>
                          <div className="monitor-ticket">#{emp.ticketNumber || emp.taskId.slice(0, 8)}</div>
                          <span className={`monitor-status-badge monitor-status--${emp.status?.replace('_', '-')}`}>
                            {emp.status === 'in_progress' ? 'IN PROGRESS' : emp.status === 'completed' ? 'COMPLETED' : 'PENDING'}
                          </span>
                          <div className="monitor-location">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 2, marginRight: 2 }}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                            <span>{emp.lastLocation !== 'Unknown' ? emp.lastLocation : '—'}</span>
                          </div>
                        </div>

                        {/* Col 3: Issue */}
                        <div className="monitor-col monitor-col--issue">
                          <div className="monitor-issue-header">
                            <span className="monitor-issue-icon">{issueIcon}</span>
                            <span className={`monitor-issue-type monitor-issue-type--${emp.severity}`}>{emp.issue}</span>
                          </div>
                          <p className="monitor-issue-msg">{issueMsg}</p>
                          <div className="monitor-signals">
                            <span className={`signal-tag ${emp.hasLocation ? 'signal-tag--ok' : 'signal-tag--off'}`}>
                              {emp.hasLocation ? '✓ GPS' : '× No GPS'}
                            </span>
                            <span className={`signal-tag ${emp.hasReport ? 'signal-tag--ok' : 'signal-tag--off'}`}>
                              {emp.hasReport ? '✓ Report' : '× No Report'}
                            </span>
                          </div>
                        </div>

                        {/* Col 4: Activity & Actions */}
                        <div className="monitor-col monitor-col--activity">
                          <div className="monitor-activity-content">
                            {emp.lastActivityFormatted ? (
                              <>
                                <div className="monitor-activity-time">{emp.lastActivityFormatted.replace(':', '.')}</div>
                                <div className="monitor-activity-label">Last activity</div>
                                {emp.idleDuration && (
                                  <div className={`monitor-idle-badge monitor-idle--${emp.severity}`}>
                                    idle {emp.idleDuration.replace('j ', 'h ').replace('m', 'm').split(' ')[0]}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="monitor-activity-time monitor-activity-time--empty">NO ACTIVITY</div>
                            )}
                          </div>

                          <button
                            className="monitor-action-btn monitor-action-btn--map"
                            onClick={() => navigate(`/monitoring/${emp.takenTaskId}`)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                              <line x1="8" y1="21" x2="16" y2="21" />
                              <line x1="12" y1="17" x2="12" y2="21" />
                            </svg>
                            Monitor
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent Reports */}
            <div className="recent-reports-section">
              <div className="section-header">
                <div className="section-header-left">
                  <div className="section-header-icon section-header-icon--reports">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </div>
                  <div>
                    <h2>Recent Reports</h2>
                    <span className="section-subtitle">
                      {recentReports.length > 0
                        ? `${recentReports.length} latest submission${recentReports.length > 1 ? 's' : ''} from team`
                        : 'Latest submissions from team'}
                    </span>
                  </div>
                </div>
              </div>

              {recentReports.length === 0 ? (
                <div className="empty-reports">
                  <span className="empty-icon">📋</span>
                  <p>No reports yet</p>
                  <span className="empty-text">Reports will appear when team members submit</span>
                </div>
              ) : (
                <div className="reports-list">
                  {recentReports.map((report, index) => (
                    <div key={report.reportId || index} className="report-item">
                      <div className="report-number">
                        {index + 1}
                      </div>
                      <div className="report-content">
                        <div className="report-title-row">
                          <span className="report-title-text">{report.takenTask?.task?.title || 'Task'}</span>
                          <div className="report-photos-badge">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                              <circle cx="8.5" cy="8.5" r="1.5" />
                              <polyline points="21 15 16 10 5 21" />
                            </svg>
                            Photos
                          </div>
                        </div>
                        <div className="report-author">
                          {report.user?.name || 'Unknown User'}
                          <span className="report-id-badge">{report.ticketNumber || `RPT-00${99 - index}`}</span>
                        </div>
                        <div className="report-date">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          {new Date(report.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {new Date(report.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="report-text-box">
                          {report.report || "All 30 vouchers distributed successfully at target location. Team confirmed handover."}
                        </div>
                        <a 
                          className="report-link" 
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            const tid = report.takenTaskId || report.takenTask?.takenTaskId || report.takenTask?.id;
                            if (tid && report.reportId) {
                              navigate(`/monitoring/${tid}?reportId=${report.reportId}`);
                            }
                          }}
                        >
                          View full report &gt;
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;