type KnowledgeDocument = {
  id: string;
  title: string;
  tags: string[];
  content: string;
};

type IndexedChunk = {
  id: string;
  title: string;
  tags: string[];
  content: string;
  embedding: number[];
};

const EMBEDDING_DIMENSIONS = 128;

const KNOWLEDGE_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: 'kpi-definitions',
    title: 'CTrack KPI Definitions',
    tags: ['kpi', 'deviation', 'duration', 'distance', 'idle', 'route_efficiency'],
    content:
      'expected_duration is the planned task duration from task start_time and end_time. actual_duration is measured from taken_task execution window or ordered tracking logs when explicit timestamps are missing. deviation_time equals actual_duration minus expected_duration. positive deviation means overrun, negative deviation means faster completion. distance_traveled is sum of haversine distance across chronological GPS points. idle_time is cumulative period where estimated speed remains below low-speed threshold. route_efficiency equals direct_distance / traveled_distance and approaches 1.0 when route is efficient.',
  },
  {
    id: 'deviation-rules',
    title: 'Deviation Analysis Rules',
    tags: ['deviation', 'analysis', 'rules'],
    content:
      'When explaining high deviation, evaluate expected_duration, actual_duration, idle_time ratio, route_efficiency, and abnormal distance against baseline. highlight task-level outliers where absolute deviation exceeds 30 percent of expected duration. classify likely causes: prolonged idle segments, route detours, traffic/field constraints, delayed start, or incomplete tracking windows.',
  },
  {
    id: 'anomaly-rules',
    title: 'Route and Idle Anomaly Rules',
    tags: ['anomaly', 'route', 'idle', 'detection'],
    content:
      'Flag route anomaly when route_efficiency below 0.55 with sufficient points. flag idle anomaly when idle_time exceeds 120 minutes in one day or idle_ratio exceeds 0.25 of active window. flag distance anomaly when daily distance z-score is greater than 2 against 14-day baseline. include reasons and confidence notes in explanation.',
  },
  {
    id: 'assistant-policy',
    title: 'Assistant Data Policy',
    tags: ['policy', 'tool-use', 'safety'],
    content:
      'Assistant must not invent numbers. if data is unavailable, state limitation and request missing scope. prioritize tool outputs over assumptions. always provide reproducible metrics from returned JSON. preserve analytical traceability by citing metric names from tool output.',
  },
];

const normalizeText = (text: string): string => text.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ');

const tokenize = (text: string): string[] =>
  normalizeText(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);

const pseudoEmbedding = (text: string, dim: number = EMBEDDING_DIMENSIONS): number[] => {
  const vector = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);

  if (tokens.length === 0) return vector;

  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash +=
        (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    const index = Math.abs(hash) % dim;
    vector[index] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;

  return vector.map((value) => value / magnitude);
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
};

class InMemoryVectorStore {
  private chunks: IndexedChunk[] = [];
  private initialized = false;

  async initialize() {
    if (this.initialized) return;

    this.chunks = KNOWLEDGE_DOCUMENTS.map((doc) => ({
      ...doc,
      embedding: pseudoEmbedding(`${doc.title} ${doc.tags.join(' ')} ${doc.content}`),
    }));

    this.initialized = true;
  }

  async search(query: string, topK: number = 4) {
    await this.initialize();

    const queryEmbedding = pseudoEmbedding(query);

    const ranked = this.chunks
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((chunk) => ({
        id: chunk.id,
        title: chunk.title,
        tags: chunk.tags,
        score: Number(chunk.score.toFixed(4)),
        content: chunk.content,
      }));

    return ranked;
  }
}

const vectorStore = new InMemoryVectorStore();

export const retrieveKnowledge = async (query: string, topK: number = 4) => {
  const matches = await vectorStore.search(query, topK);
  return {
    query,
    topK,
    matches,
  };
};
