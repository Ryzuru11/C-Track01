import { retrieveKnowledge } from './rag';
import { retrieveLiveDataContext } from './dataRetriever';
import { generateAnalyticsExplanation } from '../services/aiService';
import { upsertConversationMemory } from './conversationMemory';

type FrameworkMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type FrameworkInput = {
  question: string;
  userId: string;
  roomId?: string;
  compactContext: Record<string, unknown>;
  conversation?: FrameworkMessage[];
  intent?: string;
  preferredModel?: string;
  retrievalTopK?: number;
};

export type FrameworkOutput = {
  answer: string;
  source: 'ai' | 'rule-based';
  reason?: 'quota_exceeded' | 'service_fallback';
  fromServiceCache?: boolean;
  ragContext: Awaited<ReturnType<typeof retrieveKnowledge>>['matches'];
};

const postProcessResponse = (rawText: string): string => {
  const cleaned = rawText
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^Ringkasan analitik backend:\s*/i, '')
    .trim();

  return cleaned || 'Maaf, saya belum bisa menghasilkan jawaban saat ini.';
};

const buildFallbackAnswer = (input: {
  question: string;
  intent?: string;
  compactContext: Record<string, unknown>;
  knowledge: Awaited<ReturnType<typeof retrieveKnowledge>>['matches'];
  quotaMessage?: string;
}) => {
  const normalizedQuestion = input.question.toLowerCase();
  const analytics = (input.compactContext?.analytics as Record<string, unknown> | undefined) || {};

  if (
    normalizedQuestion.includes('user aktif') ||
    normalizedQuestion.includes('active user') ||
    normalizedQuestion.includes('berapa user') ||
    normalizedQuestion.includes('jumlah user')
  ) {
    const liveDataLine = input.knowledge
      .map((item) => item.content)
      .find((content) => content.includes('active_users='));

    if (liveDataLine) {
      const match = liveDataLine.match(/active_users=(\d+)/);
      if (match) {
        return `Jumlah user aktif saat ini adalah ${match[1]} user (berdasarkan snapshot data backend terbaru).`;
      }
    }
  }

  if (normalizedQuestion.includes('deviasi')) {
    const value = analytics.deviation_time;
    if (typeof value === 'number') {
      return `Deviasi adalah selisih durasi aktual terhadap durasi rencana. Berdasarkan data saat ini, deviasi tercatat sekitar ${value.toFixed(2)} menit.`;
    }
    return 'Deviasi adalah perbedaan antara durasi tugas yang direncanakan dan durasi aktual.';
  }

  if (normalizedQuestion.includes('idle')) {
    const value = analytics.idle_time;
    if (typeof value === 'number') {
      return `Idle time adalah akumulasi waktu kendaraan/pekerja tidak bergerak. Nilai idle saat ini sekitar ${value.toFixed(2)} menit.`;
    }
    return 'Idle time adalah total durasi tidak ada pergerakan yang terdeteksi pada periode kerja.';
  }

  if (input.intent === 'ANALYTICS' && Object.keys(analytics).length > 0) {
    const deviation = Number(analytics.deviation_time ?? 0).toFixed(2);
    const idle = Number(analytics.idle_time ?? 0).toFixed(2);
    const distance = Number(analytics.distance_traveled ?? 0).toFixed(2);
    const efficiency = Number(analytics.route_efficiency ?? 0).toFixed(4);

    return [
      input.quotaMessage || 'AI quota hari ini sudah habis.',
      'Ringkasan backend analytics:',
      `- Deviasi: ${deviation} menit`,
      `- Idle time: ${idle} menit`,
      `- Jarak: ${distance} km`,
      `- Route efficiency: ${efficiency}`,
    ].join('\n');
  }

  const docs = input.knowledge
    .slice(0, 2)
    .map((item) => `- ${item.title}: ${item.content.slice(0, 160)}...`)
    .join('\n');

  if (docs) {
    return [
      input.quotaMessage || 'AI quota hari ini sudah habis.',
      'Berikut konteks yang tersedia dari dokumentasi sistem:',
      docs,
    ].join('\n');
  }

  return input.quotaMessage || 'AI sedang mencapai batas penggunaan hari ini. Silakan coba lagi nanti.';
};

export const runRagFramework = async (input: FrameworkInput): Promise<FrameworkOutput> => {
  const memory = await upsertConversationMemory({
    userId: input.userId,
    roomId: input.roomId,
    conversation: input.conversation || [],
    latestQuestion: input.question,
    intent: input.intent,
  });

  const [retrieval, liveDataContext] = await Promise.all([
    retrieveKnowledge(input.question, Math.max(2, input.retrievalTopK ?? 5)),
    retrieveLiveDataContext(input.question, { intent: input.intent }),
  ]);

  const mergedKnowledge = [
    ...liveDataContext.map((item, index) => ({
      id: `live-${index}`,
      title: item.title,
      tags: ['live-data', 'operational'],
      score: 1,
      content: item.content,
    })),
    ...retrieval.matches,
  ];

  const aiResult = await generateAnalyticsExplanation({
    question: input.question,
    compactContext: input.compactContext,
    knowledgeContext: mergedKnowledge.map((item) => ({
      title: item.title,
      content: item.content,
    })),
    conversation: input.conversation,
    intent: input.intent,
    preferredModel: input.preferredModel,
    memoryContext: memory,
  });

  if (aiResult.type === 'quota_exceeded') {
    return {
      answer: buildFallbackAnswer({
        question: input.question,
        intent: input.intent,
        compactContext: input.compactContext,
        knowledge: mergedKnowledge,
        quotaMessage: aiResult.message,
      }),
      source: 'rule-based',
      reason: 'quota_exceeded',
      fromServiceCache: false,
      ragContext: mergedKnowledge,
    };
  }

  return {
    answer: postProcessResponse(aiResult.answer),
    source: 'ai',
    fromServiceCache: aiResult.fromCache,
    ragContext: mergedKnowledge,
  };
};
