# CTrack AI Copilot Optimization Architecture

## 1) New 3-Stage Pipeline

```text
User Question
   |
   v
AI Guard (intent classifier)
   |
   +--> data_query      -> DB response (no AI)
   +--> analytics       -> backend analysis (no AI)
   +--> explanation     -> compact context -> cache -> queue -> AI
```

```text
Explanation path:
Question
  -> Analytics Engine (DB queries + KPI calculations)
  -> Context Builder (small structured metrics only)
  -> Redis Cache lookup (6h)
  -> BullMQ queue (ai-processing, sequential)
  -> AI Service (short prompt + retry)
  -> Cache store + API response
```

## 2) Runtime Components

- `src/ai/guard.ts` → intent classification + AI-call guard
- `src/ai/analyticsEngine.ts` → rule-based analytics stage
- `src/ai/contextBuilder.ts` → compact AI input builder
- `src/ai/agent.ts` → pipeline orchestrator
- `src/services/aiService.ts` → model call, retry, prompt compression
- `src/services/redisCacheService.ts` → cache (`ai:question_hash:*`, TTL 6 hours)
- `src/ai/queue.ts` → BullMQ queue (`ai-processing`, concurrency 1)
- `src/config/redis.ts` → Redis connection helpers

## 3) Optimization Rules Enforced

1. Raw GPS logs are never sent to AI.
2. Only summarized analytics metrics are sent to AI.
3. Repeated explanation questions use Redis cache.
4. Data and analytics intents are answered without AI.
5. AI is called only for explanation intent.

## 4) Optimized Prompt

System prompt in `src/ai/systemPrompt.ts`:

```text
You are an analytics assistant for a tracking system.
Explain the cause of deviation based on the provided metrics.
Do not invent data.
```

## 5) Context Sent to AI (Example)

```json
{
  "intent": "explanation",
  "userId": "A",
  "period": { "month": "2026-03", "date": "2026-03-16" },
  "expected_duration": 120,
  "actual_duration": 158,
  "deviation_time": 38,
  "idle_time": 18,
  "distance_traveled": 320,
  "route_efficiency": 0.63,
  "anomaly_count": 2,
  "top_anomalies": [
    { "task": "Site Visit", "deviation": 22, "idle": 9, "flags": ["deviation_outlier"] }
  ]
}
```

## 6) Cache and Queue Design

- **Cache key**: `ai:question_hash:<sha256>`
- **Cache TTL**: 6 hours
- **Queue**: `ai-processing`
- **Queue policy**: sequential processing (`concurrency: 1`), retry with exponential backoff

## 7) API Endpoints

Base path: `/api/ai` (admin/superadmin)

- `POST /api/ai/agent`
- `GET /api/ai/tools`
- `POST /api/ai/retrieval`
- `GET /api/ai/prompts/system`

## 8) `/api/ai/agent` Response Shape (Optimized)

```json
{
  "question": "Why is deviation high this month?",
  "answer": "...",
  "intent": "explanation",
  "usedAI": true,
  "fromCache": false,
  "source": "ai",
  "analyticsContext": { "deviation_time": 38, "idle_time": 18 },
  "rawResult": { "...": "backend analytics payload" },
  "queue": { "queueName": "ai-processing", "enabled": true },
  "ragContext": [{ "title": "CTrack KPI Definitions", "score": 0.81 }]
}
```

## 9) Example Request Flows

### A. Data Query (No AI)
1. User asks for tracking history
2. Intent = `data_query`
3. DB query runs
4. API returns data summary directly

### B. Analytics Query (No AI)
1. User asks for monthly metrics
2. Intent = `analytics`
3. Backend computes KPI summary
4. API returns backend explanation

### C. Explanation Query (AI + Cache + Queue)
1. User asks "Why deviation is high?"
2. Intent = `explanation`
3. Analytics engine + context builder run
4. Redis cache checked
5. On miss: enqueue to BullMQ, call AI service
6. Store answer in Redis (6h)
7. Return explanation

## 10) Environment Variables

Required for full optimized mode:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, default `gpt-4.1-mini`)
- `REDIS_URL` (enables Redis cache + BullMQ queue)

If `REDIS_URL` is not set, cache/queue fallback is in-memory and inline.

## 11) Multi-Model Gemini Router

Supported models:

- `gemini-2.5-flash` → default chat/simple questions
- `gemini-1.5-flash` → long context inputs
- `gemini-2.5-pro` → analytics reasoning/explanations

Core modules:

- `src/ai/router/geminiRouter.ts`
- `src/ai/monitor/modelUsage.ts`
- `src/ai/config/modelLimits.ts`

Routing flow:

1. classify task type (`simple`, `long_context`, `analytics_reasoning`)
2. check model limits (`rpm`, `rpd`, `tpm`)
3. select primary model or fallback model
4. call Gemini API
5. persist usage counters by model in Redis

New environment variable:

- `GEMINI_API_KEY`

Admin endpoints:

- `GET /api/ai/model-limits`
- `GET /api/ai/usage-stats`
