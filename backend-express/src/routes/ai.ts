import { Router } from 'express';
import { runCTrackAgent } from '../ai/agent';
import { CTRACK_AI_SYSTEM_PROMPT } from '../ai/systemPrompt';
import { retrieveKnowledge } from '../ai/rag';
import { getToolManifest } from '../ai/tools';
import { ALL_AI_MODELS, AI_MODEL_LIMITS, AIModelName } from '../ai/config/modelLimits';
import { getAllModelUsageStats, getModelLimitStatus } from '../ai/monitor/modelUsage';
import { getAIUsageSnapshot } from '../ai/usageTracker';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, requireWeb } from '../middleware/permissions';
import { can } from '../rbac/access';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'AI service running',
  });
});

// Diagnostics expose prompts and limits: superadmin only (roles.manage)
router.get('/diagnostics', authenticate, requireWeb, requirePermission('roles.manage'), async (_req, res) => {
  const hasProviderKeys = Boolean(
    process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY
  );

  res.json({
    status: 'ok',
    pipelineVersion: 'ai-llama-default-gemini-fallback-v5',
    supportedModels: ALL_AI_MODELS,
    hasProviderKeys,
    systemPromptPreview: CTRACK_AI_SYSTEM_PROMPT.slice(0, 160),
  });
});

router.get('/tools', authenticate, requireWeb, requirePermission('roles.manage'), async (req: AuthRequest, res) => {
  res.json({
    tools: getToolManifest(req.user),
  });
});

router.post('/retrieval', authenticate, requireWeb, requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const query = String(req.body?.query || '').trim();
    if (!query) {
      throw new AppError('query is required', 400);
    }

    const topK = Number(req.body?.topK || 4);
    const result = await retrieveKnowledge(query, topK);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/prompts/system', authenticate, requireWeb, requirePermission('roles.manage'), async (_req, res) => {
  res.json({
    systemPrompt: CTRACK_AI_SYSTEM_PROMPT,
  });
});

// Used by the AI Assistant page (model picker & quota display)
router.get('/model-limits', authenticate, requireWeb, requirePermission('ai.use'), async (_req, res, next) => {
  try {
    const models = await Promise.all(
      ALL_AI_MODELS.map(async (name) => {
        const modelName = name as AIModelName;
        const status = await getModelLimitStatus(modelName, 0);
        return {
          name: modelName,
          requests_today: status.requestsDay,
          remaining_requests: status.remainingRequestsDay,
          limit: AI_MODEL_LIMITS[modelName],
          blockedBy: status.blockedBy || null,
        };
      })
    );

    res.json({ models });
  } catch (error) {
    next(error);
  }
});

router.get('/usage-stats', authenticate, requireWeb, requirePermission('ai.use'), async (_req, res, next) => {
  try {
    const usage = await getAllModelUsageStats();
    res.json({
      generatedAt: usage.generatedAt,
      models: usage.models.map((item: any) => ({
        model: item.model,
        requests_per_minute: item.requestsMinute,
        requests_per_day: item.requestsDay,
        tokens_used: item.tokensDay,
        remaining_quota: {
          requests_day: item.remainingRequestsDay,
          requests_minute: item.remainingRequestsMinute,
          tokens_minute: item.remainingTokensMinute,
        },
        usage_percentage: {
          requests: item.requestUsagePercent,
          tokens: item.tokenUsagePercent,
        },
        blockedBy: item.blockedBy || null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/usage', authenticate, requireWeb, requirePermission('ai.use'), async (_req, res, next) => {
  try {
    const usage = await getAIUsageSnapshot();

    res.json({
      requests_today: usage.requests_today,
      quota_remaining: usage.quota_remaining,
      quota_limit: usage.quota_limit,
      tokens_used: usage.tokens_used,
      model_used: usage.model_used,
      date: usage.date,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/agent', authenticate, requireWeb, requirePermission('ai.use'), async (req: AuthRequest, res, next) => {
  try {
    const question = String(req.body?.question || req.body?.message || '').trim();
    if (!question) {
      throw new AppError('question or message is required', 400);
    }

    console.log('[AI] /agent request received', {
      userId: req.user?.userId,
      requestedUserId: req.body?.userId,
      hasQuestion: Boolean(question),
      preferredModel: req.body?.preferredModel,
    });

    const preferredModelRaw = req.body?.preferredModel ? String(req.body.preferredModel) : undefined;
    const preferredModel =
      preferredModelRaw && ALL_AI_MODELS.includes(preferredModelRaw as AIModelName)
        ? (preferredModelRaw as AIModelName)
        : undefined;

    const requestedUserId = req.body?.userId ? String(req.body.userId) : req.user?.userId;

    if (!requestedUserId) {
      throw new AppError('userId is required', 400);
    }

    // Analytics about another user is Employee Analytics data
    const allowAnalytics = can(req.user, 'analytics.view');
    if (requestedUserId !== req.user?.userId && !allowAnalytics) {
      throw new AppError('Insufficient permissions', 403);
    }

    const result = await runCTrackAgent({
      question,
      userId: requestedUserId,
      roomId: req.body?.roomId ? String(req.body.roomId) : undefined,
      preferredModel,
      allowAnalytics,
      context: {
        month: req.body?.month,
        date: req.body?.date,
        startDate: req.body?.startDate,
        endDate: req.body?.endDate,
      },
      conversation: Array.isArray(req.body?.conversation) ? req.body.conversation : [],
    });

    res.json({
      success: true,
      data: result.answer,
      question,
      answer: result.answer,
      intent: result.intent,
      usedAI: result.usedAI,
      fromCache: result.fromCache,
      source: result.source,
      analyticsContext: result.analyticsContext,
      rawResult: result.rawResult,
      queue: result.queue,
      ragContext: result.ragContext,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
