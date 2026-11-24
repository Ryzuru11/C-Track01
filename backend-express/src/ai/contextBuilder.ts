import { IntentType } from './intentDetection';

type AnalyticsPayload = {
  userId: string;
  month?: string;
  date?: string;
  deviation?: any;
  idle?: any;
  distance?: any;
  routeAnomaly?: any;
};

type AnalyticsSummary = {
  deviation_time: number;
  idle_time: number;
  distance_traveled: number;
  route_efficiency: number;
  anomaly_count: number;
};

type BuildAIContextInput = {
  intent: IntentType;
  userId: string;
  scope?: {
    month?: string;
    date?: string;
    startDate?: string;
    endDate?: string;
  };
  analyticsSummary?: AnalyticsSummary;
};

export const CTRACK_BASE_CONTEXT = {
  app: 'CTrack',
  description: 'field tracking analytics system',
  metrics: ['deviation_time', 'idle_time', 'distance_traveled', 'route_efficiency'],
};

export const buildAnalyticsSummary = (payload: AnalyticsPayload): AnalyticsSummary => {
  const summary = payload.deviation?.summary;

  return {
    deviation_time: Number(summary?.deviationMinutes ?? 0),
    idle_time: Number(payload.idle?.idleMinutes ?? summary?.idleMinutes ?? 0),
    distance_traveled: Number(payload.distance?.distanceTraveledKm ?? summary?.distanceTraveledKm ?? 0),
    route_efficiency: Number(payload.distance?.routeEfficiency ?? payload.routeAnomaly?.metrics?.routeEfficiency ?? 0),
    anomaly_count: Number(summary?.anomalyCount ?? (payload.routeAnomaly?.anomalyDetected ? 1 : 0)),
  };
};

export const buildAIContext = (input: BuildAIContextInput) => {
  return {
    ...CTRACK_BASE_CONTEXT,
    intent: input.intent,
    userId: input.userId,
    period: {
      month: input.scope?.month,
      date: input.scope?.date,
      startDate: input.scope?.startDate,
      endDate: input.scope?.endDate,
    },
    analytics: input.intent === 'ANALYTICS' && input.analyticsSummary ? input.analyticsSummary : undefined,
  };
};
