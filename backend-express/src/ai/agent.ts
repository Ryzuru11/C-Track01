import { runAnalyticsEngine } from './analyticsEngine';
import { buildAIContext, buildAnalyticsSummary } from './contextBuilder';
import {
  createAiCacheKey,
  getCachedAiAnswer,
  setCachedAiAnswer,
} from '../services/redisCacheService';
import { enqueueAIReasoning, getAIQueueStatus } from './queue';
import { detectIntent, IntentType } from './intentDetection';
import { FrameworkOutput } from './framework';
import { isOperationalDataQuestion } from './dataRetriever';

type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type AgentRequest = {
  question: string;
  userId: string;
  roomId?: string;
  preferredModel?: string;
  /** false = caller lacks analytics.view, so the employee analytics engine is skipped */
  allowAnalytics?: boolean;
  context?: {
    month?: string;
    date?: string;
    startDate?: string;
    endDate?: string;
  };
  conversation?: ConversationMessage[];
};

type AgentResponse = {
  answer: string;
  intent: IntentType;
  usedAI: boolean;
  fromCache: boolean;
  source: 'backend-analysis' | 'ai' | 'rule-based';
  analyticsContext: Record<string, unknown>;
  rawResult?: unknown;
  ragContext: FrameworkOutput['ragContext'];
  queue: ReturnType<typeof getAIQueueStatus>;
};

export const runCTrackAgent = async (request: AgentRequest): Promise<AgentResponse> => {
  const intent = detectIntent(request.question);
  const shouldBypassCache = isOperationalDataQuestion(request.question);

  let analyticsPayload: Record<string, unknown> | undefined;
  if (intent === 'ANALYTICS' && request.allowAnalytics !== false) {
    const analytics = await runAnalyticsEngine(request.question, request.userId, request.context ?? {});
    analyticsPayload = analytics.payload as Record<string, unknown>;
  }

  const analyticsSummary = analyticsPayload ? buildAnalyticsSummary(analyticsPayload as any) : undefined;

  const analyticsContext = buildAIContext({
    intent,
    userId: request.userId,
    scope: request.context ?? {},
    analyticsSummary,
  });

  const cacheKey = createAiCacheKey(request.question, request.userId, {
    roomId: request.roomId,
    month: request.context?.month,
    date: request.context?.date,
    startDate: request.context?.startDate,
    endDate: request.context?.endDate,
    preferredModel: request.preferredModel,
    conversationTail: (request.conversation || [])
      .slice(-8)
      .map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 120) })),
    context: analyticsContext,
  });

  const cached = shouldBypassCache ? null : await getCachedAiAnswer(cacheKey);
  if (!shouldBypassCache && cached && cached.source === 'ai') {
    return {
      answer: cached.answer,
      intent,
      usedAI: false,
      fromCache: true,
      source: cached.source,
      analyticsContext: cached.analyticsContext,
      rawResult: analyticsPayload,
      ragContext: [],
      queue: getAIQueueStatus(),
    };
  }

  try {
    const frameworkResult = await enqueueAIReasoning({
      question: request.question,
      userId: request.userId,
      roomId: request.roomId,
      compactContext: analyticsContext,
      conversation: request.conversation ?? [],
      intent,
      preferredModel: request.preferredModel,
      retrievalTopK: 3,
    });

    if (!shouldBypassCache && frameworkResult.source === 'ai') {
      await setCachedAiAnswer(cacheKey, {
        answer: frameworkResult.answer,
        analyticsContext,
        source: frameworkResult.source,
        generatedAt: new Date().toISOString(),
      });
    }

    return {
      answer: frameworkResult.answer,
      intent,
      usedAI: frameworkResult.source === 'ai' && !frameworkResult.fromServiceCache,
      fromCache: !shouldBypassCache && Boolean(frameworkResult.fromServiceCache),
      source: frameworkResult.source,
      analyticsContext,
      rawResult: analyticsPayload,
      ragContext: frameworkResult.ragContext,
      queue: getAIQueueStatus(),
    };
  } catch (error) {
    const normalizedError = error as { message?: string };
    console.error('[AI Agent] Failed to generate AI response:', normalizedError?.message || error);

    return {
      answer:
        'Maaf, layanan AI sedang tidak tersedia sementara. Silakan coba lagi sebentar lagi.',
      intent,
      usedAI: false,
      fromCache: false,
      source: 'rule-based',
      analyticsContext,
      rawResult: analyticsPayload,
      ragContext: [],
      queue: getAIQueueStatus(),
    };
  }
};
