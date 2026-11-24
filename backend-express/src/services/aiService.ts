import { Groq } from 'groq-sdk';
import { selectAIModel } from '../ai/router/geminiRouter';
import { trackModelUsage } from '../ai/monitor/modelUsage';
import { CTRACK_AI_SYSTEM_PROMPT } from '../ai/systemPrompt';
import { buildAiCacheKey, getAiCache, setAiCache } from '../ai/cache';
import { checkDailyQuota } from '../ai/quotaGuard';
import { trackAIUsage } from '../ai/usageTracker';
import { AIModelName } from '../ai/config/modelLimits';
import { isOperationalDataQuestion } from '../ai/dataRetriever';
import { ConversationMemory } from '../ai/conversationMemory';

type AIServiceInput = {
  question: string;
  compactContext: Record<string, unknown>;
  knowledgeContext: Array<{ title: string; content: string }>;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  memoryContext?: ConversationMemory;
  intent?: string;
  preferredModel?: string;
};

export type AIServiceResult =
  | {
      type: 'success';
      answer: string;
      fromCache: boolean;
      modelUsed: string;
      tokensUsed: number;
    }
  | {
      type: 'quota_exceeded';
      message: string;
      fromCache: boolean;
      cachedAnswer?: string;
    };

const resolveProviderKeys = () => {
  return (
    {
      deepseek: (process.env.DEEPSEEK_API_KEY || '').trim(),
      groq: (process.env.GROQ_API_KEY || '').trim(),
      gemini: (process.env.GEMINI_API_KEY || '').trim(),
    }
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const compressContext = (context: Record<string, unknown>) => {
  const importantFields = [
    'app',
    'description',
    'metrics',
    'intent',
    'userId',
    'period',
    'analytics',
  ];

  const compact: Record<string, unknown> = {};
  for (const key of importantFields) {
    if (context[key] !== undefined) {
      compact[key] = context[key];
    }
  }

  return compact;
};

export const generateAnalyticsExplanation = async (input: AIServiceInput): Promise<AIServiceResult> => {
  const providerKeys = resolveProviderKeys();
  if (!providerKeys.deepseek && !providerKeys.groq && !providerKeys.gemini) {
    throw new Error(
      'AI provider key is not configured. Set GROQ_API_KEY, DEEPSEEK_API_KEY, or GEMINI_API_KEY'
    );
  }

  const compactContext = compressContext(input.compactContext);
  const shouldBypassCache = isOperationalDataQuestion(input.question);

  const cacheKey = buildAiCacheKey(input.question, {
    intent: input.intent,
    preferredModel: input.preferredModel,
    period: compactContext.period,
    analytics: compactContext.analytics,
    knowledgeTitles: input.knowledgeContext.slice(0, 3).map((item) => item.title),
    conversationTail: (input.conversation || []).slice(-8).map((item) => `${item.role}:${item.content.slice(0, 80)}`),
    memoryScope: input.memoryContext?.scope,
    globalFacts: (input.memoryContext?.global.facts || []).slice(0, 6),
    globalTopics: (input.memoryContext?.global.recentTopics || []).slice(0, 6),
    roomFacts: (input.memoryContext?.room.facts || []).slice(0, 6),
    roomTopics: (input.memoryContext?.room.recentTopics || []).slice(0, 6),
  });
  const cached = shouldBypassCache ? null : await getAiCache(cacheKey);
  if (!shouldBypassCache && cached) {
    return {
      type: 'success',
      answer: cached.answer,
      fromCache: true,
      modelUsed: cached.modelUsed || 'cache',
      tokensUsed: 0,
    };
  }

  const quota = await checkDailyQuota();
  if (!quota.allowed) {
    return {
      type: 'quota_exceeded',
      message: quota.message,
      fromCache: false,
    };
  }

  const route = await selectAIModel({
    question: input.question,
    compactContext,
    intent: input.intent,
    preferredModel: input.preferredModel,
  });

  if (!route.guard.allowed) {
    return {
      type: 'quota_exceeded',
      message: 'AI quota hari ini sudah habis.',
      fromCache: false,
    };
  }

  let model = route.selectedModel as AIModelName;

  const modelAvailability: Record<AIModelName, boolean> = {
    'llama-3.1-8b-instant': Boolean(providerKeys.groq),
    'deepseek-chat': Boolean(providerKeys.deepseek),
    'gemini-2.5-flash': Boolean(providerKeys.gemini),
  };

  if (!modelAvailability[model]) {
    const fallbackOrder: AIModelName[] = [
      'llama-3.1-8b-instant',
      'deepseek-chat',
      'gemini-2.5-flash',
    ];

    const availableFallback = fallbackOrder.find((candidate) => modelAvailability[candidate]);
    if (!availableFallback) {
      throw new Error('No AI provider key configured for available models');
    }

    model = availableFallback;
  }

  const promptPayload = {
    intent: input.intent || compactContext.intent || 'GENERAL',
    appContext: compactContext,
    conversation: (input.conversation || []).slice(-12),
    memory: {
      scope: input.memoryContext?.scope || 'HYBRID',
      global: {
        facts: (input.memoryContext?.global.facts || []).slice(0, 10),
        recentTopics: (input.memoryContext?.global.recentTopics || []).slice(0, 10),
        updatedAt: input.memoryContext?.global.updatedAt,
      },
      room: {
        facts: (input.memoryContext?.room.facts || []).slice(0, 10),
        recentTopics: (input.memoryContext?.room.recentTopics || []).slice(0, 10),
        updatedAt: input.memoryContext?.room.updatedAt,
      },
    },
    userQuestion: input.question,
    referenceKnowledge: input.knowledgeContext.slice(0, 6),
    instructions:
      'Provide a natural conversational response in user language. Use memory.scope to pick context: GLOBAL => prioritize global memory across all rooms, ROOM_SPECIFIC => prioritize room memory and current room conversation, HYBRID => combine both but keep room references bounded to room memory. For count/stat questions, answer directly with the requested number in the first sentence. Keep response to the point (max 3 short paragraphs). Only mention distance/idle/deviation if explicitly asked. Synthesize user question with retrieved data and explain concise conclusion first, then supporting numbers. For general/system intent, answer naturally without forcing analytics. Never fabricate unavailable values; if data is missing, say it clearly.',
  };

  const maxAttempts = 3;
  const isQuotaError = (message: string) =>
    /quota|requests per day|rpd|resource has been exhausted|rate limit/i.test(message);

  const buildMessages = () => {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: `${CTRACK_AI_SYSTEM_PROMPT}\n\nUse global memory for app-wide/general discussions across rooms, and use same-room memory for specific follow-up references. Always prioritize retrieved live/backend data over assumptions.`,
      },
      ...(input.conversation || []).slice(-12).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: 'user',
        content: [
          'Gunakan konteks berikut untuk menjawab user secara natural dalam bahasa user.',
          JSON.stringify(promptPayload),
        ].join('\n\n'),
      },
    ];

    return messages;
  };

  const invokeDeepSeek = async () => {
    if (!providerKeys.deepseek) {
      throw new Error('DeepSeek API key is missing');
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerKeys.deepseek}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: buildMessages(),
        temperature: 0.45,
        max_tokens: 420,
        top_p: 1,
        stream: false,
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`DeepSeek request failed: ${response.status} ${text}`);
    }

    const payload = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const content = payload.choices?.[0]?.message?.content?.trim() || '';
    const tokens = Number(payload.usage?.total_tokens || 0) || route.estimatedTokens;

    return { content, tokens };
  };

  const invokeGroqLlama = async () => {
    if (!providerKeys.groq) {
      throw new Error('Groq API key is missing');
    }

    const groq = new Groq({ apiKey: providerKeys.groq });

    const stream = await groq.chat.completions.create({
      messages: buildMessages(),
      model: 'llama-3.1-8b-instant',
      temperature: 1,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: true,
      stop: null,
    });

    let content = '';
    for await (const chunk of stream as any) {
      content += chunk?.choices?.[0]?.delta?.content || '';
    }

    return {
      content: content.trim(),
      tokens: route.estimatedTokens,
    };
  };

  const invokeGeminiFlash = async () => {
    if (!providerKeys.gemini) {
      throw new Error('Gemini API key is missing');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${providerKeys.gemini}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: CTRACK_AI_SYSTEM_PROMPT,
              },
            ],
          },
          contents: [
            {
              parts: [
                {
                  text: [
                    'Gunakan konteks berikut untuk menjawab user secara natural dalam bahasa user.',
                    JSON.stringify(promptPayload),
                  ].join('\n\n'),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.45,
            maxOutputTokens: 420,
            topP: 1,
          },
        }),
      }
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini request failed: ${response.status} ${text}`);
    }

    const payload = JSON.parse(text) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { totalTokenCount?: number };
    };

    const content = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();
    const tokens = Number(payload.usageMetadata?.totalTokenCount || 0) || route.estimatedTokens;

    return {
      content: content || '',
      tokens,
    };
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result =
        model === 'deepseek-chat'
          ? await invokeDeepSeek()
          : model === 'gemini-2.5-flash'
            ? await invokeGeminiFlash()
            : await invokeGroqLlama();

      if (!result.content) {
        throw new Error(`${model} returned empty content`);
      }

      const tokensUsed = Number(result.tokens || 0) || route.estimatedTokens;

      await trackModelUsage(model, tokensUsed);
      await trackAIUsage({ modelUsed: model, tokensUsed });

      if (!shouldBypassCache) {
        await setAiCache(cacheKey, {
          answer: result.content,
          source: 'ai',
          modelUsed: model,
          generatedAt: new Date().toISOString(),
        });
      }

      return {
        type: 'success',
        answer: result.content,
        fromCache: false,
        modelUsed: model,
        tokensUsed,
      };
    } catch (error) {
      const message = (error as { message?: string })?.message || String(error);

      if (isQuotaError(message)) {
        return {
          type: 'quota_exceeded',
          message: 'AI quota hari ini sudah habis.',
          fromCache: false,
        };
      }

      if (attempt < maxAttempts) {
        await sleep(400 * attempt);
        continue;
      }

      throw new Error(message);
    }
  }

  throw new Error('AI provider request exhausted retries');
};
