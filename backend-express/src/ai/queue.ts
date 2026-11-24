const { Queue, QueueEvents, Worker } = require('bullmq');
import { getBullMqConnection } from '../config/redis';
import { runRagFramework, FrameworkOutput } from './framework';

type QueuePayload = {
  question: string;
  userId: string;
  roomId?: string;
  compactContext: Record<string, unknown>;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  intent?: string;
  preferredModel?: string;
  retrievalTopK?: number;
};

let aiQueue: any = null;
let aiQueueEvents: any = null;
let aiWorker: any = null;
let queueEnabled = false;

const QUEUE_NAME = 'ai-processing';

const ensureQueue = async () => {
  if (aiQueue && aiQueueEvents && aiWorker) return true;

  const connection = getBullMqConnection();
  if (!connection) {
    queueEnabled = false;
    return false;
  }

  aiQueue = new Queue(QUEUE_NAME, { connection });
  aiQueueEvents = new QueueEvents(QUEUE_NAME, { connection: connection.duplicate() });
  await aiQueueEvents.waitUntilReady();

  aiWorker = new Worker(
    QUEUE_NAME,
    async (job: any) => {
      return runRagFramework({
        question: job.data.question,
        userId: job.data.userId,
        roomId: job.data.roomId,
        compactContext: job.data.compactContext,
        conversation: job.data.conversation,
        intent: job.data.intent,
        preferredModel: job.data.preferredModel,
        retrievalTopK: job.data.retrievalTopK,
      });
    },
    {
      connection: connection.duplicate(),
      concurrency: 1,
    }
  );

  aiWorker.on('failed', (job: any, error: unknown) => {
    const normalizedError = error as { message?: string };
    console.error(`[AI Queue] Job ${job?.id} failed:`, normalizedError?.message || error);
  });

  queueEnabled = true;
  return true;
};

export const enqueueAIReasoning = async (payload: QueuePayload): Promise<FrameworkOutput> => {
  const ready = await ensureQueue();
  if (!ready || !aiQueue || !aiQueueEvents) {
    return runRagFramework({
      question: payload.question,
      userId: payload.userId,
      roomId: payload.roomId,
      compactContext: payload.compactContext,
      conversation: payload.conversation,
      intent: payload.intent,
      preferredModel: payload.preferredModel,
      retrievalTopK: payload.retrievalTopK,
    });
  }

  const job = await aiQueue.add('reasoning', payload, {
    attempts: 2,
    removeOnComplete: 100,
    removeOnFail: 100,
    backoff: {
      type: 'exponential',
      delay: 500,
    },
  });

  return job.waitUntilFinished(aiQueueEvents, 45_000) as Promise<FrameworkOutput>;
};

export type AIQueueResult = FrameworkOutput;

export const getAIQueueStatus = () => ({
  queueName: QUEUE_NAME,
  enabled: queueEnabled,
});
