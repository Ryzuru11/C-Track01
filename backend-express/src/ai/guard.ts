export type QuestionIntent = 'data_query' | 'analytics' | 'explanation';

const explanationKeywords = [
  'why',
  'explain',
  'reason',
  'cause',
  'bagaimana',
  'kenapa',
  'mengapa',
  'jelaskan',
  'rekomendasi',
];

const dataKeywords = ['list', 'raw', 'log', 'history', 'detail', 'record', 'point'];

const analyticsKeywords = [
  'deviation',
  'deviasi',
  'kinerja',
  'performance',
  'idle',
  'distance',
  'route',
  'efficiency',
  'summary',
  'ringkasan',
  'anomaly',
  'anomali',
];

const hasAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

export const classifyQuestionIntent = (question: string): QuestionIntent => {
  const normalized = question.trim().toLowerCase();

  if (hasAny(normalized, explanationKeywords)) return 'explanation';
  if (hasAny(normalized, dataKeywords)) return 'data_query';
  if (hasAny(normalized, analyticsKeywords)) return 'analytics';

  return 'explanation';
};

export const shouldCallAI = (intent: QuestionIntent) => intent === 'explanation';
