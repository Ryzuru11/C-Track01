export type AIModelName =
  | 'deepseek-chat'
  | 'llama-3.1-8b-instant'
  | 'gemini-2.5-flash';

export type ModelLimit = {
  rpm: number;
  rpd: number;
  tpm: number;
};

export const AI_MODEL_LIMITS: Record<AIModelName, ModelLimit> = {
  'llama-3.1-8b-instant': {
    rpm: 30,
    rpd: 1_200,
    tpm: 200_000,
  },
  'deepseek-chat': {
    rpm: 20,
    rpd: 800,
    tpm: 160_000,
  },
  'gemini-2.5-flash': {
    rpm: 10,
    rpd: 250,
    tpm: 200_000,
  },
};

export const ALL_AI_MODELS = Object.keys(
  AI_MODEL_LIMITS
) as AIModelName[];
