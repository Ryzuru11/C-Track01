import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAssignments, getUsers, getReports, getAllLocations } from '../../services/api';
import './Analytics.css';

// ── Haversine distance (same formula as mobile) ────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
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

// ── Duration formatter (same as mobile) ───────────────────────────────────────
function formatDuration(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}j`;
  return `${hours}j ${minutes}m`;
}

function formatDurationShort(ms) {
  if (!ms || ms <= 0) return '0j 0m';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}j ${minutes}m`;
}

// ── Behavior score (0-100) ────────────────────────────────────────────────────
function computeBehaviorScore(completionRate, reportRate, activityRate) {
  return Math.min(100, Math.round(completionRate * 0.45 + reportRate * 0.35 + activityRate * 0.20));
}

function scoreColor(score) {
  if (score >= 80) return '#34c759';
  if (score >= 60) return '#ff9500';
  if (score >= 40) return '#ff6b35';
  return '#ff3b30';
}

function scoreLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

// Cari label dari bucket dengan jumlah terbanyak (Mode - "paling umum")
  function getMostCommonLabel(buckets, labels) {
    if (!buckets || buckets.length === 0) return '-';
    
    let maxVal = -1;
    let maxLabel = '-';
    
    buckets.forEach((val, i) => {
      if (val > maxVal) {
        maxVal = val;
        maxLabel = labels[i];
      }
    });
    
    return maxVal === 0 ? '-' : maxLabel;
  }

  // Hitung total dari array (untuk laporan)
  function sumArray(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0);
  }

// ── Simple mini bar chart ──────────────────────────────────────────────────────
function MiniBarChart({ data, labels, color = '#007AFF', height = 60 }) {
  const max = Math.max(...data, 1);
  return (
    <div className="mini-bar-chart" style={{ height }}>
      {data.map((v, i) => (
        <div key={i} className="mini-bar-col">
          <div
            className="mini-bar-fill"
            style={{ height: `${Math.round((v / max) * 100)}%`, background: color }}
          />
          {labels && <span className="mini-bar-label">{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Donut chart (pure CSS/SVG) ─────────────────────────────────────────────────
function DonutChart({ segments, size = 90 }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 34;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  return (
    <svg width={size} height={size}>
      {segments.map((seg, i) => {
        const pct = seg.value / total;
        const dash = pct * circ;
        const gap = circ - dash;
        const el = (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={12}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        );
        offset += dash;
        return el;
      })}
      <circle cx={cx} cy={cy} r={27} fill="#FFFF" />
    </svg>
  );
}

// ── GitHub-style yearly contribution calendar ──────────────────────────────────
function GitHubCalendar({ data }) {
  const [tooltip, setTooltip] = useState(null);

  // Use local date (not UTC) to avoid timezone shift in Jakarta (UTC+7)
  const pad = (n) => String(n).padStart(2, '0');
  const toLocalDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toLocalDateStr(today);

  // Start exactly 52 weeks ago (364 days), aligned to Sunday
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  // Build week columns — always ends on today
  const weeks = [];
  const cur = new Date(startDate);
  while (cur <= today) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      if (cur > today) {
        week.push(null);
      } else {
        const dateStr = toLocalDateStr(cur);
        week.push({ date: new Date(cur), dateStr, count: data[dateStr] || 0 });
      }
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

    // ── URUTAN WARNA HIJAU (MATCH FIGMA) ──
      const getColor = (count, isToday) => {
        if (count === 0) return isToday ? '#EEF0F3' : '#EEF0F3';
        if (count === 1) return '#ACEEBB';  // Hijau sangat muda
        if (count <= 3) return '#4AC26B';  // Hijau muda
        if (count <= 5) return '#2DA44E';  // Hijau medium
        return '#116329';                  // Hijau tua
      };

  // Month label positions (percentage-based)
  const monthLabels = [];
  let prevMonth = -1;
  weeks.forEach((week, wi) => {
    const firstDay = week.find((d) => d !== null);
    if (!firstDay) return;
    const m = firstDay.date.getMonth();
    if (m !== prevMonth) {
      monthLabels.push({
        pct: (wi / weeks.length) * 100,
        label: firstDay.date.toLocaleString('id-ID', { month: 'short' }),
      });
      prevMonth = m;
    }
  });

  const totalCount = Object.values(data).reduce((a, b) => a + b, 0);
  const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

   // 1. Hari aktif (jumlah hari yang ada task)
  const activeDays = Object.values(data).filter(c => c > 0).length;

  // 2. Streak terbaik (streak terpanjang berturut-turut)
  let bestStreak = 0;
  let currentStreak = 0;
  const sortedDates = Object.keys(data).sort();
  sortedDates.forEach((dateStr, i) => {
    if (data[dateStr] > 0) {
      // Cek apakah ini hari setelah tanggal sebelumnya (kontinu)
      if (i > 0) {
        const prevDate = new Date(sortedDates[i - 1]);
        const currDate = new Date(dateStr);
        const diffDays = (currDate - prevDate) / (1000 * 60 * 60 * 24);
        if (diffDays > 1) currentStreak = 0; // Reset kalau ada jeda
      }
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  });

  // 3. Hari tersibuk (day of week dengan total task terbanyak)
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  Object.entries(data).forEach(([dateStr, count]) => {
    const day = new Date(dateStr).getDay();
    dayCounts[day] += count;
  });
  const busiestDayIndex = dayCounts.indexOf(Math.max(...dayCounts));
  const busiestDay = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][busiestDayIndex];

  // 4. Bulan terbaik (bulan dengan total task terbanyak)
  const monthCounts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  Object.entries(data).forEach(([dateStr, count]) => {
    const month = new Date(dateStr).getMonth();
    monthCounts[month] += count;
  });
  const bestMonthIndex = monthCounts.indexOf(Math.max(...monthCounts));
  const bestMonth = new Date(2026, bestMonthIndex).toLocaleString('id-ID', { month: 'long', year: 'numeric' });

  // 5. Total minggu
  const totalWeeks = weeks.length;

  return (
    <div className="gh-cal-wrapper">
      <div className="gh-cal-total">
        {totalCount} task selesai dalam setahun terakhir
      </div>
      <div className="gh-cal-outer">
        {/* Day-of-week labels */}
        <div className="gh-cal-day-labels">
          {DAY_LABELS.map((d) => (
            <div key={d} className="gh-cal-day-label">
              {d}
            </div>
          ))}
        </div>

        {/* Month labels + fluid grid */}
        <div className="gh-cal-right">
          <div className="gh-cal-months">
            {monthLabels.map((m, i) => (
              <div key={i} className="gh-cal-month-label" style={{ left: `${m.pct}%` }}>
                {m.label}
              </div>
            ))}
          </div>
          <div className="gh-cal-grid">
            {weeks.map((week, wi) => (
              <div key={wi} className="gh-cal-week">
                {week.map((day, di) =>
                  day === null ? (
                    <div key={di} className="gh-cal-cell gh-cal-cell-empty" />
                  ) : (
                    <div
                      key={di}
                      className={`gh-cal-cell${day.dateStr === todayStr ? ' gh-cal-cell-today' : ''}`}
                      style={{ background: getColor(day.count, day.dateStr === todayStr) }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({ x: rect.left + rect.width / 2, y: rect.top, ...day });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="gh-cal-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <strong>{tooltip.count} task selesai</strong> pada {tooltip.dateStr}
          {tooltip.dateStr === todayStr && <span className="gh-cal-today-badge"> (hari ini)</span>}
        </div>
      )}

      {/* Legend */}
      <div className="gh-cal-legend">
        <span className="gh-cal-legend-text">Kurang</span>
        {['#EEF0F3', '#ACEEBB', '#4AC26B', '#2DA44E', '#116329'].map((c, i) => (
          <div key={i} className="gh-cal-legend-cell" style={{ background: c }} />
        ))}
        <span className="gh-cal-legend-text">Lebih</span>
      </div>

       {/* Stats Footer - 5 ITEM */}
      <div className="gh-cal-stats">
        <div className="gh-stat">
          <div className="gh-stat-label">Hari aktif</div>
          <div className="gh-stat-value">{activeDays} hari</div>
        </div>
        <div className="gh-stat">
          <div className="gh-stat-label">Streak terbaik</div>
          <div className="gh-stat-value">{bestStreak} hari</div>
        </div>
        <div className="gh-stat">
          <div className="gh-stat-label">Hari tersibuk</div>
          <div className="gh-stat-value">{busiestDay}</div>
        </div>
        <div className="gh-stat">
          <div className="gh-stat-label">Bulan terbaik</div>
          <div className="gh-stat-value">{bestMonth}</div>
        </div>
        <div className="gh-stat">
          <div className="gh-stat-label">Total minggu</div>
          <div className="gh-stat-value">{totalWeeks} minggu</div>
        </div>
      </div>

    </div>
  );
}

export default function Analytics() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const hasInitiatedLoad = useRef(false); // Prevent double loading in StrictMode
  const [employeeStats, setEmployeeStats] = useState([]);
  const [summary, setSummary] = useState({
    totalEmployees: 0,
    totalUsers:0,
    avgBehaviorScore: 0,
    avgCompletionRate: 0,
    avgDurationMs: 0,
    totalDistanceKm: 0,
    avgDistanceKm: 0,
    totalTasksDone: 0,
    totalReports: 0,
  });
  const [weeklyReports, setWeeklyReports] = useState([0, 0, 0, 0, 0, 0, 0]);
  const [dailyTaskActivity, setDailyTaskActivity] = useState({});
  const [sortBy, setSortBy] = useState('score'); // score | completion | distance | duration
  const [sortDir, setSortDir] = useState('desc');
  const [filterDate, setFilterDate] = useState('all'); // all | week | month
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  useEffect(() => {
    if (hasInitiatedLoad.current) return;
    hasInitiatedLoad.current = true;
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [assignmentsData, usersData, reportsData, locationsData] = await Promise.all([
        getAssignments(),
        getUsers(),
        getReports({ limit: 500, sort: 'createdAt:desc' }),
        getAllLocations({ limit: 5000 }),
      ]);

      const takenTasks = assignmentsData.takenTasks || [];
      const users = usersData.users || [];
      const allReports = reportsData.reports || [];
      const allLocations = locationsData.locations || [];

      // ── Group locations by takenTaskId + userId ──────────────────────────────
      // locationMap: `${takenTaskId}::${userId}` → sorted array of location points
      const locationMap = {};
      allLocations.forEach((loc) => {
        const key = `${loc.takenTaskId}::${loc.userId}`;
        if (!locationMap[key]) locationMap[key] = [];
        locationMap[key].push(loc);
      });
      // Sort each group ascending by recordedAt
      Object.keys(locationMap).forEach((k) => {
        locationMap[k].sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
      });

      // ── Group reports by userId ──────────────────────────────────────────────
      const reportsByUser = {};
      allReports.forEach((r) => {
        if (!reportsByUser[r.userId]) reportsByUser[r.userId] = [];
        reportsByUser[r.userId].push(r);
      });

      // ── Weekly reports (Sun‒Sat) ──────────────────────────────────────────────
      const weekly = [0, 0, 0, 0, 0, 0, 0];
      allReports.forEach((r) => {
        weekly[new Date(r.createdAt).getDay()]++;
      });
      setWeeklyReports(weekly);

      // ── Daily task completion heatmap ──────────────────────────────────────
      const daily = {};
      const toLocalDate = (d) => {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      takenTasks.forEach((tt) => {
        // Use overall status 'completed' (set when all users finish)
        if (tt.status !== 'completed') return;
        // endTime is explicitly set on completion; fall back through other date fields
        const dateRaw = tt.endTime || tt.updatedAt || tt.date || tt.createdAt;
        if (!dateRaw) return;
        const dateStr = toLocalDate(new Date(dateRaw));
        daily[dateStr] = (daily[dateStr] || 0) + 1;
      });
      setDailyTaskActivity(daily);

      // ── Per-employee stats ────────────────────────────────────────────────────
      const statsMap = {}; // userId → stats object

      takenTasks.forEach((tt) => {
        const userStatuses = tt.user_statuses || tt.userStatuses;
        if (!userStatuses) return;

        let statusesObj;
        try {
          statusesObj = typeof userStatuses === 'string' ? JSON.parse(userStatuses) : userStatuses;
        } catch {
          return;
        }

        Object.entries(statusesObj).forEach(([userId, status]) => {
          if (!statsMap[userId]) {
            const user = users.find((u) => u.id === userId);
            statsMap[userId] = {
              userId,
              name: user?.name || userId,
              email: user?.email || '',
              totalTasks: 0,
              completedTasks: 0,
              inProgressTasks: 0,
              pendingTasks: 0,
              totalReports: 0,
              totalDistanceKm: 0,
              totalDurationMs: 0,
              taskDurations: [], // array of ms per task for distribution
              taskDistances: [], // array of km per task
              taskTitles: [],    // task title per entry (parallel to taskDistances)
              completedWithLocations: 0,
            };
          }

          const s = statsMap[userId];
          s.totalTasks++;
          if (status === 'completed') s.completedTasks++;
          else if (status === 'in_progress') s.inProgressTasks++;
          else s.pendingTasks++;

          // Location-based metrics (same calculation as mobile)
          const locKey = `${tt.takenTaskId}::${userId}`;
          const locs = locationMap[locKey];
          if (locs && locs.length >= 2) {
            // Distance = sum of consecutive Haversine
            let dist = 0;
            for (let i = 1; i < locs.length; i++) {
              dist += haversineKm(
                parseFloat(locs[i - 1].latitude), parseFloat(locs[i - 1].longitude),
                parseFloat(locs[i].latitude), parseFloat(locs[i].longitude),
              );
            }
            // Duration = first recordedAt → last recordedAt
            const durationMs =
              new Date(locs[locs.length - 1].recordedAt) - new Date(locs[0].recordedAt);

            s.totalDistanceKm += dist;
            s.totalDurationMs += durationMs;
            s.taskDurations.push(durationMs);
            s.taskDistances.push(parseFloat(dist.toFixed(3)));
            s.taskTitles.push(tt.task?.title || tt.task?.name || `Tugas ${s.taskDistances.length}`);
            if (status === 'completed') s.completedWithLocations++;
          }
        });

        // Reports for this taken task per user
        Object.keys(statusesObj).forEach((userId) => {
          const taskReports = allReports.filter(
            (r) => r.takenTask?.takenTaskId === tt.takenTaskId && r.userId === userId,
          );
          if (statsMap[userId]) statsMap[userId].totalReports += taskReports.length;
        });
      });

      // Deduplicate report count (already counted per takenTask above might double)
      // Reset and recount from reportsByUser
      Object.keys(statsMap).forEach((uid) => {
        statsMap[uid].totalReports = (reportsByUser[uid] || []).length;
      });

      // ── Compute derived metrics ───────────────────────────────────────────────
      const employeeList = Object.values(statsMap)
        .filter((s) => s.totalTasks > 0)
        .map((s) => {
          const completionRate = s.totalTasks > 0 ? Math.round((s.completedTasks / s.totalTasks) * 100) : 0;
          const reportRate = s.completedTasks > 0 ? Math.min(100, Math.round((s.totalReports / Math.max(s.completedTasks, 1)) * 100)) : 0;
          const activityRate = s.totalDistanceKm > 0 ? Math.min(100, Math.round(s.totalDistanceKm * 5)) : 0; // normalize distance to activity %
          const behaviorScore = computeBehaviorScore(completionRate, reportRate, activityRate);
          const avgDurationMs = s.taskDurations.length > 0
            ? s.taskDurations.reduce((a, b) => a + b, 0) / s.taskDurations.length
            : 0;
          const avgDistanceKm = s.taskDistances.length > 0
            ? s.taskDistances.reduce((a, b) => a + b, 0) / s.taskDistances.length
            : 0;

          return {
            ...s,
            completionRate,
            reportRate,
            activityRate,
            behaviorScore,
            avgDurationMs,
            avgDistanceKm: parseFloat(avgDistanceKm.toFixed(2)),
            totalDistanceKm: parseFloat(s.totalDistanceKm.toFixed(2)),
          };
        });

      setEmployeeStats(employeeList);

      // ── Summary ────────────────────────────────────────────────────────────────
      const totalEmp = employeeList.length || 1;
      setSummary({
        totalEmployees: employeeList.length,
        totalUsers: users.length,
        avgBehaviorScore: Math.round(employeeList.reduce((a, e) => a + e.behaviorScore, 0) / totalEmp),
        avgCompletionRate: Math.round(employeeList.reduce((a, e) => a + e.completionRate, 0) / totalEmp),
        avgDurationMs: employeeList.reduce((a, e) => a + e.avgDurationMs, 0) / totalEmp,
        totalDistanceKm: parseFloat(employeeList.reduce((a, e) => a + e.totalDistanceKm, 0).toFixed(1)),
        avgDistanceKm: parseFloat((employeeList.reduce((a, e) => a + e.avgDistanceKm, 0) / totalEmp).toFixed(2)),
        totalTasksDone: employeeList.reduce((a, e) => a + e.completedTasks, 0),
        totalReports: employeeList.reduce((a, e) => a + e.totalReports, 0),
      });
    } catch (err) {
      console.error('Analytics fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Sorted & displayed employee list ──────────────────────────────────────────
  const sortedEmployees = useMemo(() => {
    const arr = [...employeeStats];
    arr.sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case 'score':       va = a.behaviorScore;    vb = b.behaviorScore;    break;
        case 'completion':  va = a.completionRate;   vb = b.completionRate;   break;
        case 'distance':    va = a.totalDistanceKm;  vb = b.totalDistanceKm;  break;
        case 'duration':    va = a.totalDurationMs;  vb = b.totalDurationMs;  break;
        case 'reports':     va = a.totalReports;     vb = b.totalReports;     break;
        default:            va = a.behaviorScore;    vb = b.behaviorScore;
      }
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return arr;
  }, [employeeStats, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortBy(col); setSortDir('desc'); }
  };

  const sortIcon = (col) => {
    if (sortBy !== col) return <span className="sort-icon neutral">↕</span>;
    return <span className="sort-icon active">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  // ── Distribution helpers ───────────────────────────────────────────────────────
  const durationBuckets = useMemo(() => {
    // Buckets: 0-1h, 1-2h, 2-4h, 4-8h, 8h+
    const buckets = [0, 0, 0, 0, 0];
    const labels = ['<1j', '1-2j', '2-4j', '4-8j', '>8j'];
    employeeStats.forEach((e) => {
      e.taskDurations.forEach((ms) => {
        const h = ms / (1000 * 60 * 60);
        if (h < 1) buckets[0]++;
        else if (h < 2) buckets[1]++;
        else if (h < 4) buckets[2]++;
        else if (h < 8) buckets[3]++;
        else buckets[4]++;
      });
    });
    return { buckets, labels };
  }, [employeeStats]);

  const distanceBuckets = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0];
    const labels = ['<1km', '1-5km', '5-10km', '10-25km', '>25km'];
    employeeStats.forEach((e) => {
      e.taskDistances.forEach((km) => {
        if (km < 1) buckets[0]++;
        else if (km < 5) buckets[1]++;
        else if (km < 10) buckets[2]++;
        else if (km < 25) buckets[3]++;
        else buckets[4]++;
      });
    });
    return { buckets, labels };
  }, [employeeStats]);

  const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  if (loading) {
    return (
      <div className="main-content an-page">
        <div className="an-loading">
          <div className="an-spinner"></div>
          <p>Memuat data analitik karyawan...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content an-page">
      {/* ── Header ── */}
      <header className="content-header">
        <div>
          <h1>Employee Analytics</h1>
          <span className="dashboard-subtitle">Behavior & performance deep-dive</span>
        </div>
        <button className="an-refresh-btn" onClick={fetchData}>↻ Refresh</button>
      </header>

      {/* ── Summary cards ── */}
      <div className="an-summary-grid">
        {/* Card 1 - Karyawan Aktif (DARK) */}
        <div className="an-summary-card an-summary-card-dark">
          <div className="an-summary-icon-wrapper an-summary-icon-team">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="22" 
              height="22" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <path d="M16 3.128a4 4 0 0 1 0 7.744" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <circle cx="9" cy="7" r="4" />
            </svg>
          </div>
          <div>
            <div className="an-summary-value">{summary.totalEmployees}</div>
            <div className="an-summary-title">Karyawan Aktif</div>
            <div className="an-summary-subtitle">dari {summary.totalUsers} total karyawan</div>
          </div>
        </div>

        {/* Card 2 - Avg Behavior Score */}
        <div className="an-summary-card">
          <div className="an-summary-icon-wrapper an-summary-icon-trend">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="22" 
              height="22" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="M16 7h6v6" />
              <path d="m22 7-8.5 8.5-5-5L2 17" />
            </svg>
          </div>
          <div>
            <div className="an-summary-value" style={{ color: scoreColor(summary.avgBehaviorScore) }}>
              {summary.avgBehaviorScore}
            </div>
            <div className="an-summary-title">Avg Behavior Score</div>
            <div className="an-summary-subtitle">rata-rata tim keseluruhan</div>
          </div>
        </div>

        {/* Card 3 - Avg Durasi / Tugas */}
        <div className="an-summary-card an-summary-card-clock">
          <div className="an-summary-icon-wrapper an-summary-icon-clock">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="22" 
              height="22" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6h4" />
            </svg>
          </div>
          <div>
            <div className="an-summary-value">{formatDurationShort(summary.avgDurationMs)}</div>
            <div className="an-summary-title">Avg Durasi Tugas</div>
            <div className="an-summary-subtitle">per penugasan aktif</div>
          </div>
        </div>

        {/* Card 4 - Avg Jarak Tim */}
        <div className="an-summary-card an-summary-card-navigation">
          <div className="an-summary-icon-wrapper an-summary-icon-navigation">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="22" 
              height="22" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <polygon points="12 2 19 21 12 17 5 21 12 2" />
            </svg>
          </div>
          <div>
            <div className="an-summary-value">{summary.avgDistanceKm} km</div>
            <div className="an-summary-title">Avg Jarak Tim</div>
            <div className="an-summary-subtitle">jarak tempuh per tugas</div>
          </div>
        </div>

        {/* Card 5 - Total Laporan */}
        <div className="an-summary-card an-summary-card-doc">
          <div className="an-summary-icon-wrapper an-summary-icon-doc">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="22" 
              height="22" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
              <path d="M14 2v5a1 1 0 0 0 1 1h5" />
              <path d="M10 9H8" />
              <path d="M16 13H8" />
              <path d="M16 17H8" />
            </svg>
          </div>
          <div>
            <div className="an-summary-value">{summary.totalReports}</div>
            <div className="an-summary-title">Total Laporan</div>
            <div className="an-summary-subtitle">laporan bulan ini</div>
          </div>
        </div>
      </div>

      {/* ── Charts row ── */}
        <div className="an-charts-row">

          {/* 1. Behavior Score Distribution (Donut) */}
          <div className="an-chart-card">
            <div className="an-chart-header">
              <div className="an-chart-icon-wrapper an-chart-icon-green">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 7h6v6" />
                  <path d="m22 7-8.5 8.5-5-5L2 17" />
                </svg>
              </div>
              <div>
                <div className="an-chart-title">Sebaran Behavior Score</div>
                <div className="an-chart-note">Distribusi skor karyawan</div>
              </div>
            </div>
            
            <div className="an-score-dist">
              {(() => {
                const excellent = employeeStats.filter((e) => e.behaviorScore >= 80).length;
                const good      = employeeStats.filter((e) => e.behaviorScore >= 60 && e.behaviorScore < 80).length;
                const fair      = employeeStats.filter((e) => e.behaviorScore >= 40 && e.behaviorScore < 60).length;
                const poor      = employeeStats.filter((e) => e.behaviorScore < 40).length;
                const total = employeeStats.length || 1;
                const segs = [
                  { label: 'Excellent (≥80)', value: excellent, color: '#10B981' },
                  { label: 'Good (60–79)',    value: good,      color: '#3B82F6' },
                  { label: 'Fair (40–59)',    value: fair,      color: '#F59E0B' },
                  { label: 'Poor (<40)',      value: poor,      color: '#EF4444' },
                ];
                return (
                  <div className="an-score-dist-inner">
                    <DonutChart segments={segs} size={110} />
                    <div className="an-score-dist-legend">
  {segs.map((s) => {
    const pct = Math.round((s.value / total) * 100);
    return (
        <div key={s.label} className="an-legend-row">
                            <span className="an-legend-dot" style={{ background: s.color }}></span>
                            <span className="an-legend-label">{s.label}</span>
                            <span className="an-legend-count">{s.value}</span>
                            <span 
                              className="an-legend-pct-badge" 
                              style={{ 
                                background: `${s.color}15`,  // 15 = opacity 8% hex
                                color: s.color 
                              }}
                            >
                              {pct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

        {/* 2. Task Duration Distribution (Bar - Orange) */}
          <div className="an-chart-card">
            <div className="an-chart-header">
              <div className="an-chart-icon-wrapper an-chart-icon-orange">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6h4" />
                </svg>
              </div>
              <div>
                <div className="an-chart-title">Distribusi Durasi Tugas</div>
                <div className="an-chart-note">Berdasarkan waktu tracking GPS</div>
              </div>
            </div>
            <MiniBarChart
              data={durationBuckets.buckets}
              labels={durationBuckets.labels}
              color="#F7AA53"
              height={90}
            />

            {/* Keterangan di bawah - HAPUS YANG DUPLIKAT */}
            <div className="an-chart-summary">
              <span className="an-summary-label">Durasi paling umum</span>
              <span className="an-summary-value" style={{ color: '#F7AA53' }}>
                {getMostCommonLabel(durationBuckets.buckets, durationBuckets.labels)}
              </span>
            </div>
          </div>

          {/* 3. Distance Distribution (Bar - Ungu) */}
          <div className="an-chart-card">
            <div className="an-chart-header">
              <div className="an-chart-icon-wrapper an-chart-icon-purple">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 19 21 12 17 5 21 12 2" />
                </svg>
              </div>
              <div>
                <div className="an-chart-title">Distribusi Jarak Tugas</div>
                <div className="an-chart-note">Dihitung via Haversine antar titik</div>
              </div>
            </div>
            <MiniBarChart
              data={distanceBuckets.buckets}
              labels={distanceBuckets.labels}
              color="#7C3AED"
              height={90}
            />
            <div className="an-chart-summary">
              <span className="an-summary-label">Rentang paling umum</span>
              <span className="an-summary-value" style={{ color: '#6366F1' }}>
                {getMostCommonLabel(distanceBuckets.buckets, distanceBuckets.labels)}
              </span>
            </div>
          </div>

          {/* 4. Weekly Report Activity (Bar - Biru) */}
          <div className="an-chart-card">
            <div className="an-chart-header">
              <div className="an-chart-icon-wrapper an-chart-icon-blue">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
                  <path d="M14 2v5a1 1 0 0 0 1 1h5" />
                  <path d="M10 9H8" />
                  <path d="M16 13H8" />
                  <path d="M16 17H8" />
                </svg>
              </div>
              <div>
                <div className="an-chart-title">Laporan per Hari</div>
                <div className="an-chart-note">Hari paling aktif submisi</div>
              </div>
            </div>
            <MiniBarChart
              data={weeklyReports}
              labels={DAYS}
              color="#3B82F6"
              height={90}
            />
            
            {/* PINDAH KE DALAM CARD */}
            <div className="an-chart-summary">
              <span className="an-summary-label">Total bulan ini</span>
              <span className="an-summary-value" style={{ color: '#3B82F6' }}>
                {sumArray(weeklyReports)} laporan
              </span>
            </div>
          </div>
        </div>
      {/* ── GitHub-style yearly task calendar ── */}
        <div className="an-section-card">
          <div className="an-section-header">
            <div className="an-section-icon-wrapper an-section-icon-green">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-git-commit-horizontal-icon lucide-git-commit-horizontal"><circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/></svg>
            </div>
            <div>
              <div className="an-section-title">Aktivitas Harian Tim</div>
              <div className="an-section-subtitle">Task selesai dalam setahun terakhir</div>
            </div>
          </div>

          <GitHubCalendar data={dailyTaskActivity} />
        </div>

      {/* ── Employee leaderboard table ── */}
      <div className="an-section-card an-table-section">
        <div className="an-chart-header">
          {/* Pembungkus Judul & Icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Icon Trophy */}
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="20" 
              height="20" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="lucide lucide-trophy-icon lucide-trophy"
              style={{ color: '#FFB800' }} /* Warna emas biar match sama tema leaderboard */
            >
              <path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978"/>
              <path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978"/>
              <path d="M18 9h1.5a1 1 0 0 0 0-5H18"/>
              <path d="M4 22h16"/>
              <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/>
              <path d="M6 9H4.5a1 1 0 0 1 0-5H6"/>
            </svg>
            <span className="an-chart-title">Leaderboard Karyawan</span>
          </div>

          {/* Badge Jumlah Karyawan */}
          <div className="an-employee-count">
            <strong>{sortedEmployees.length}</strong> karyawan
          </div>
        </div>
        <div className="an-table-wrapper">
          <table className="an-table">
            <thead>
              <tr>
                <th className="an-th-rank">#</th>
                <th className="an-th-name">Karyawan</th>
                <th className="an-th-sortable" onClick={() => toggleSort('score')}>
                  Behavior Score {sortIcon('score')}
                </th>
                <th className="an-th-sortable" onClick={() => toggleSort('completion')}>
                  Completion {sortIcon('completion')}
                </th>
                <th className="an-th-sortable" onClick={() => toggleSort('reports')}>
                  Laporan {sortIcon('reports')}
                </th>
                <th className="an-th-sortable" onClick={() => toggleSort('distance')}>
                  Total Jarak {sortIcon('distance')}
                </th>
                <th className="an-th-sortable" onClick={() => toggleSort('duration')}>
                  Total Durasi {sortIcon('duration')}
                </th>
                <th>Tugas</th>
                <th>Avg Jarak/Tugas</th>
                <th>Avg Durasi/Tugas</th>
              </tr>
            </thead>
            <tbody>
              {sortedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={10} className="an-empty-row">Belum ada data karyawan</td>
                </tr>
              ) : (
                sortedEmployees.map((emp, idx) => (
                  <React.Fragment key={emp.userId}>
                    <tr
                      className={`an-tr ${selectedEmployee === emp.userId ? 'an-tr-selected' : ''}`}
                      onClick={() =>
                        setSelectedEmployee(selectedEmployee === emp.userId ? null : emp.userId)
                      }
                    >
                      <td className="an-td-rank">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                      </td>
                      <td className="an-td-name">
                        <div className="an-emp-name">{emp.name}</div>
                        <div className="an-emp-email">{emp.email}</div>
                      </td>
                      <td>
                        <div className="an-score-cell">
                          <div className="an-score-bar-track">
                            <div
                              className="an-score-bar-fill"
                              style={{ width: `${emp.behaviorScore}%`, background: scoreColor(emp.behaviorScore) }}
                            />
                          </div>
                          <span className="an-score-num" style={{ color: scoreColor(emp.behaviorScore) }}>
                            {emp.behaviorScore}
                          </span>
                          <span className="an-score-tag" style={{ color: scoreColor(emp.behaviorScore) }}>
                            {scoreLabel(emp.behaviorScore)}
                          </span>
                        </div>
                      </td>
                      <td className="an-td-center">
                        <span className="an-pct" style={{ color: emp.completionRate >= 70 ? '#34c759' : emp.completionRate >= 40 ? '#ff9500' : '#ff3b30' }}>
                          {emp.completionRate}%
                        </span>
                         <span className="an-sub" style={{ color: 'rgba(0, 0, 0, 0.4)', display: 'block', marginTop: '2px' }}>
                          {emp.completedTasks}/{emp.totalTasks}
                        </span>
                      </td>
                      <td className="an-td-center">{emp.totalReports}</td>
                      <td className="an-td-center">{emp.totalDistanceKm} km</td>
                      <td className="an-td-center">{formatDuration(emp.totalDurationMs)}</td>
                      <td>
                        <div className="an-task-pills">
                          {emp.completedTasks > 0 && <span className="an-pill green">{emp.completedTasks} selesai</span>}
                          {emp.inProgressTasks > 0 && <span className="an-pill blue">{emp.inProgressTasks} aktif</span>}
                          {emp.pendingTasks > 0 && <span className="an-pill gray">{emp.pendingTasks} pending</span>}
                        </div>
                      </td>
                      <td className="an-td-center">{emp.avgDistanceKm} km</td>
                      <td className="an-td-center">{formatDuration(emp.avgDurationMs)}</td>
                    </tr>

                    {/* Expanded detail row */}
                    {selectedEmployee === emp.userId && (
                      <tr className="an-detail-row">
                        <td colSpan={10}>
                          <div className="an-detail-panel">
                            <div className="an-detail-section">
                              <div className="an-detail-title">Breakdown Score</div>
                              <div className="an-detail-scores">
                                <div className="an-detail-score-item">
                                  <span>Completion Rate</span>
                                  <div className="an-detail-bar-track">
                                    <div className="an-detail-bar-fill" style={{ width: `${emp.completionRate}%`, background: '#34c759' }} />
                                  </div>
                                  <span>{emp.completionRate}%</span>
                                </div>
                                <div className="an-detail-score-item">
                                  <span>Report Rate</span>
                                  <div className="an-detail-bar-track">
                                    <div className="an-detail-bar-fill" style={{ width: `${emp.reportRate}%`, background: '#007AFF' }} />
                                  </div>
                                  <span>{emp.reportRate}%</span>
                                </div>
                                <div className="an-detail-score-item">
                                  <span>Activity Rate</span>
                                  <div className="an-detail-bar-track">
                                    <div className="an-detail-bar-fill" style={{ width: `${emp.activityRate}%`, background: '#a855f7' }} />
                                  </div>
                                  <span>{emp.activityRate}%</span>
                                </div>
                              </div>
                            </div>

                            <div className="an-detail-section">
                              <div className="an-detail-title">Distribusi Durasi Tugas</div>
                              {emp.taskDurations.length === 0 ? (
                                <p className="an-detail-empty">Belum ada data tracking GPS</p>
                              ) : (
                                <MiniBarChart
                                  data={(() => {
                                    const b = [0, 0, 0, 0, 0];
                                    emp.taskDurations.forEach((ms) => {
                                      const h = ms / (1000 * 60 * 60);
                                      if (h < 1) b[0]++; else if (h < 2) b[1]++; else if (h < 4) b[2]++; else if (h < 8) b[3]++; else b[4]++;
                                    });
                                    return b;
                                  })()}
                                  labels={['<1j', '1-2j', '2-4j', '4-8j', '>8j']}
                                  color="#a855f7"
                                  height={60}
                                />
                              )}
                            </div>

                            <div className="an-detail-section">
                              <div className="an-detail-title">Jarak per Tugas (km)</div>
                              {emp.taskDistances.length === 0 ? (
                                <p className="an-detail-empty">Belum ada data tracking GPS</p>
                              ) : (
                                <div className="an-km-list">
                                  {emp.taskDistances.slice(0, 10).map((km, i) => (
                                    <div key={i} className="an-km-item">
                                      <span className="an-km-label" title={emp.taskTitles[i]}>
                                        {emp.taskTitles[i] || `Tugas ${i + 1}`}
                                      </span>
                                      <div className="an-km-bar-track">
                                        <div
                                          className="an-km-bar-fill"
                                          style={{ width: `${Math.min(100, (km / Math.max(...emp.taskDistances, 1)) * 100)}%`, background: '#007AFF' }}
                                        />
                                      </div>
                                      <span className="an-km-val">{km.toFixed(2)} km</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Score formula note ── */}
      {/* <div className="an-formula-note">
        <span>📐</span>
        <span>
          <strong>Behavior Score</strong> = Completion Rate × 0.45 + Report Rate × 0.35 + Activity Rate × 0.20
          &nbsp;|&nbsp;
          <strong>Jarak</strong> dihitung via Haversine (identik dengan mobile)
          &nbsp;|&nbsp;
          <strong>Durasi</strong> = recordedAt pertama → terakhir per tugas
        </span>
      </div> */}
    </div>
  );
}
