export type IntentType = 'GENERAL' | 'ANALYTICS' | 'SYSTEM';

const analyticsKeywords = [
  'deviasi',
  'deviation',
  'tracking',
  'idle',
  'jarak',
  'distance',
  'route',
  'rute',
  'efficiency',
  'efisiensi',
  'anomali',
  'anomaly',
  'metric',
  'metrik',
  'kinerja',
  'analytics',
  'analitik',
  'user aktif',
  'active user',
  'task aktif',
  'laporan hari ini',
  'report hari ini',
  'in progress',
  'assignment',
];

const systemKeywords = [
  'ctrack',
  'app apa',
  'aplikasi apa',
  'tentang aplikasi',
  'fitur',
  'fungsi',
  'cara pakai',
  'bantuan',
  'help',
  'siapa kamu',
  'apa itu',
];

const hasAny = (text: string, keywords: string[]) => {
  return keywords.some((keyword) => text.includes(keyword));
};

export const detectIntent = (message: string): IntentType => {
  const normalizedMessage = message.trim().toLowerCase();

  if (!normalizedMessage) return 'GENERAL';
  if (hasAny(normalizedMessage, analyticsKeywords)) return 'ANALYTICS';
  if (hasAny(normalizedMessage, systemKeywords)) return 'SYSTEM';

  return 'GENERAL';
};
