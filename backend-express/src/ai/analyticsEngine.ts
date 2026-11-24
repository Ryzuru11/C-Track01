import {
  detectRouteAnomaly,
  getDeviationAnalytics,
  getDistanceSummary,
  getIdleTime,
  getTrackingLogs,
} from '../services/trackingService';

export type AnalyticsScope = {
  month?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
};

const getCurrentMonth = () => new Date().toISOString().slice(0, 7);
const getCurrentDate = () => new Date().toISOString().slice(0, 10);

const monthRange = (month: string) => {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
};

export const runAnalyticsEngine = async (
  question: string,
  userId: string,
  scope: AnalyticsScope
) => {
  const normalizedQuestion = question.toLowerCase();
  const month = scope.month || getCurrentMonth();
  const date = scope.date || getCurrentDate();
  const range = scope.startDate && scope.endDate ? scope : monthRange(month);

  const logs = await getTrackingLogs(userId, range.startDate!, range.endDate!);

  const [deviation, distance, idle, routeAnomaly] = await Promise.all([
    getDeviationAnalytics(userId, month),
    getDistanceSummary(userId, date),
    getIdleTime(userId, range.startDate!, range.endDate!),
    detectRouteAnomaly(userId, date),
  ]);

  const asksSpecificMetric =
    normalizedQuestion.includes('deviation') ||
    normalizedQuestion.includes('deviasi') ||
    normalizedQuestion.includes('idle') ||
    normalizedQuestion.includes('distance') ||
    normalizedQuestion.includes('jarak') ||
    normalizedQuestion.includes('route') ||
    normalizedQuestion.includes('rute') ||
    normalizedQuestion.includes('anomali') ||
    normalizedQuestion.includes('anomaly');

  const selectedSignals = {
    includeDeviation:
      normalizedQuestion.includes('deviation') || normalizedQuestion.includes('deviasi') || !asksSpecificMetric,
    includeIdle: normalizedQuestion.includes('idle') || !asksSpecificMetric,
    includeDistance:
      normalizedQuestion.includes('distance') ||
      normalizedQuestion.includes('jarak') ||
      normalizedQuestion.includes('route') ||
      !asksSpecificMetric,
    includeRoute:
      normalizedQuestion.includes('route') ||
      normalizedQuestion.includes('rute') ||
      normalizedQuestion.includes('anomali') ||
      normalizedQuestion.includes('anomaly') ||
      !asksSpecificMetric,
  };

  return {
    kind: 'analytics_summary',
    payload: {
      userId,
      month,
      date,
      totalLogs: logs.totalLogs,
      deviation: selectedSignals.includeDeviation ? deviation : undefined,
      idle: selectedSignals.includeIdle ? idle : undefined,
      distance: selectedSignals.includeDistance ? distance : undefined,
      routeAnomaly: selectedSignals.includeRoute ? routeAnomaly : undefined,
    },
  };
};
