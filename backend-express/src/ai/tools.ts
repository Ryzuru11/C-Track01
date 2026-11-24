import {
  detectRouteAnomaly,
  getDeviationAnalytics,
  getDistanceSummary,
  getIdleTime,
  getTrackingLogs,
} from '../services/trackingService';
import { can, AccessSubject } from '../rbac/access';

type ToolCallArguments = Record<string, unknown>;

type ToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
};

const normalizeArguments = (args: unknown): ToolCallArguments => {
  if (!args) return {};
  if (typeof args === 'string') {
    try {
      return JSON.parse(args) as ToolCallArguments;
    } catch {
      throw new Error('Invalid JSON tool arguments');
    }
  }
  if (typeof args === 'object') return args as ToolCallArguments;
  throw new Error('Unsupported tool argument payload');
};

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing or invalid argument: ${field}`);
  }
  return value.trim();
};

export const CTRACK_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'getTrackingLogs',
    description: 'Retrieve detailed tracking logs for a user in a date range',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User UUID' },
        startDate: { type: 'string', description: 'ISO date/time start boundary' },
        endDate: { type: 'string', description: 'ISO date/time end boundary' },
      },
      required: ['userId', 'startDate', 'endDate'],
    },
  },
  {
    name: 'getDeviationAnalytics',
    description: 'Get monthly deviation analytics against expected task duration',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User UUID' },
        month: { type: 'string', description: 'Month in YYYY-MM format' },
      },
      required: ['userId', 'month'],
    },
  },
  {
    name: 'getDistanceSummary',
    description: 'Get distance traveled summary and route efficiency for a date',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User UUID' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      },
      required: ['userId', 'date'],
    },
  },
  {
    name: 'getIdleTime',
    description: 'Get idle time statistics for a user in a date range',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User UUID' },
        startDate: { type: 'string', description: 'ISO date/time start boundary' },
        endDate: { type: 'string', description: 'ISO date/time end boundary' },
      },
      required: ['userId', 'startDate', 'endDate'],
    },
  },
  {
    name: 'detectRouteAnomaly',
    description: 'Detect route anomalies for a user on a specific date',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User UUID' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      },
      required: ['userId', 'date'],
    },
  },
];

// Permission required to use each tool (RBAC v2): tracking data vs employee analytics
const TOOL_PERMISSIONS: Record<string, string> = {
  getTrackingLogs: 'monitoring.view_locations',
  detectRouteAnomaly: 'monitoring.view_locations',
  getDeviationAnalytics: 'analytics.view',
  getDistanceSummary: 'analytics.view',
  getIdleTime: 'analytics.view',
};

export const getToolManifest = (subject?: Pick<AccessSubject, 'role' | 'permissions'>) =>
  subject
    ? CTRACK_TOOL_DEFINITIONS.filter((tool) => can(subject, TOOL_PERMISSIONS[tool.name]))
    : CTRACK_TOOL_DEFINITIONS;

export const executeToolCall = async (name: string, rawArgs: unknown) => {
  const args = normalizeArguments(rawArgs);

  switch (name) {
    case 'getTrackingLogs':
      return getTrackingLogs(
        requireString(args.userId, 'userId'),
        requireString(args.startDate, 'startDate'),
        requireString(args.endDate, 'endDate')
      );

    case 'getDeviationAnalytics':
      return getDeviationAnalytics(
        requireString(args.userId, 'userId'),
        requireString(args.month, 'month')
      );

    case 'getDistanceSummary':
      return getDistanceSummary(
        requireString(args.userId, 'userId'),
        requireString(args.date, 'date')
      );

    case 'getIdleTime':
      return getIdleTime(
        requireString(args.userId, 'userId'),
        requireString(args.startDate, 'startDate'),
        requireString(args.endDate, 'endDate')
      );

    case 'detectRouteAnomaly':
      return detectRouteAnomaly(
        requireString(args.userId, 'userId'),
        requireString(args.date, 'date')
      );

    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
};
