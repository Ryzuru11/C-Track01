import { ALL_AI_MODELS, AIModelName } from '../config/modelLimits';
import { getModelLimitStatus } from '../monitor/modelUsage';

type RouterInput = {
  question: string;
  compactContext: Record<string, unknown>;
  intent?: string;
  preferredModel?: string;
};

type TaskType = 'simple' | 'long_context' | 'analytics_reasoning';

const estimateTokenUsage = (question: string, context: Record<string, unknown>) => {
  const rawSize = `${question}\n${JSON.stringify(context)}`.length;
  return Math.ceil(rawSize / 4);
};

const classifyTaskType = (input: RouterInput): TaskType => {
  const serializedContext = JSON.stringify(input.compactContext);
  const contextChars = serializedContext.length;
  const questionChars = input.question.length;

  const normalizedQuestion = input.question.toLowerCase();

  if (contextChars > 8000 || questionChars > 3000) {
    return 'long_context';
  }

  if (
    input.intent === 'ANALYTICS' ||
    normalizedQuestion.includes('why') ||
    normalizedQuestion.includes('explain') ||
    normalizedQuestion.includes('kenapa') ||
    normalizedQuestion.includes('mengapa') ||
    normalizedQuestion.includes('analisis') ||
    normalizedQuestion.includes('deviation') ||
    normalizedQuestion.includes('deviasi')
  ) {
    return 'analytics_reasoning';
  }

  return 'simple';
};

const priorityByTask: Record<TaskType, AIModelName[]> = {
  simple: ['llama-3.1-8b-instant', 'deepseek-chat', 'gemini-2.5-flash'],
  long_context: ['llama-3.1-8b-instant', 'deepseek-chat', 'gemini-2.5-flash'],
  analytics_reasoning: ['llama-3.1-8b-instant', 'deepseek-chat', 'gemini-2.5-flash'],
};

export const selectAIModel = async (input: RouterInput) => {
  const taskType = classifyTaskType(input);
  const estimatedTokens = estimateTokenUsage(input.question, input.compactContext);

  const defaultCandidates = priorityByTask[taskType];
  const preferredModel =
    input.preferredModel && ALL_AI_MODELS.includes(input.preferredModel as AIModelName)
      ? (input.preferredModel as AIModelName)
      : undefined;

  const candidates = preferredModel
    ? [preferredModel, ...defaultCandidates.filter((model) => model !== preferredModel)]
    : defaultCandidates;

  const checks = await Promise.all(
    candidates.map(async (model) => ({
      model,
      status: await getModelLimitStatus(model, estimatedTokens),
    }))
  );

  const selected = checks.find((item) => item.status.allowed);
  if (!selected) {
    const primary = checks[0];
    return {
      taskType,
      estimatedTokens,
      selectedModel: primary.model,
      guard: {
        allowed: false,
        reason: 'all_models_limited',
        statuses: checks.map((item) => item.status),
      },
    };
  }

  return {
    taskType,
    estimatedTokens,
    selectedModel: selected.model,
    guard: {
      allowed: true,
      reason: selected.model === candidates[0] ? 'primary_model_available' : 'fallback_model_selected',
      statuses: checks.map((item) => item.status),
    },
  };
};
