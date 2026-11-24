import { getRedisClient } from '../config/redis';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type MemoryBucket = {
  facts: string[];
  recentTopics: string[];
  updatedAt: string;
};

export type ConversationMemory = {
  scope: 'GLOBAL' | 'ROOM_SPECIFIC' | 'HYBRID';
  global: MemoryBucket;
  room: MemoryBucket;
};

const MEMORY_TTL_SECONDS = 60 * 60 * 24 * 30;
const memoryFallback = new Map<string, { value: MemoryBucket; expiresAt: number }>();

const roomMemoryKey = (userId: string, roomId?: string) =>
  `ai:memory:user:${userId}:room:${roomId || 'default'}`;

const globalMemoryKey = (userId: string) => `ai:memory:user:${userId}:global`;

const uniqueTrimmed = (items: string[], maxItems: number) => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) continue;
    const signature = normalized.toLowerCase();
    if (seen.has(signature)) continue;
    seen.add(signature);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }

  return output;
};

const extractFacts = (messages: ChatMessage[]) => {
  const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content.toLowerCase());
  const facts: string[] = [];

  for (const content of userMessages) {
    const nameMatch = content.match(/nama\s+saya\s+([a-zA-Z\s]{2,30})/i);
    if (nameMatch) {
      facts.push(`Nama pengguna: ${nameMatch[1].trim()}`);
    }

    const roleMatch = content.match(/saya\s+(admin|superadmin|employee|karyawan|operator)/i);
    if (roleMatch) {
      facts.push(`Peran pengguna: ${roleMatch[1].trim()}`);
    }

    const focusMatch = content.match(/fokus\s+saya\s+(.{3,80})/i);
    if (focusMatch) {
      facts.push(`Fokus pengguna: ${focusMatch[1].trim()}`);
    }
  }

  return uniqueTrimmed(facts, 12);
};

const extractTopics = (messages: ChatMessage[]) => {
  const userMessages = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content.trim().slice(0, 160))
    .filter((text) => text.length > 0)
    .slice(-10);

  return uniqueTrimmed(userMessages.reverse(), 10);
};

const readFallbackMemory = (key: string): MemoryBucket | null => {
  const item = memoryFallback.get(key);
  if (!item || item.expiresAt < Date.now()) {
    if (item) memoryFallback.delete(key);
    return null;
  }
  return item.value;
};

const getMemoryBucket = async (key: string): Promise<MemoryBucket | null> => {
  const redis = getRedisClient();

  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MemoryBucket;
    } catch {
      return null;
    }
  }

  return readFallbackMemory(key);
};

const saveMemoryBucket = async (key: string, value: MemoryBucket) => {
  const redis = getRedisClient();
  if (redis) {
    await redis.set(key, JSON.stringify(value), 'EX', MEMORY_TTL_SECONDS);
    return;
  }

  memoryFallback.set(key, {
    value,
    expiresAt: Date.now() + MEMORY_TTL_SECONDS * 1000,
  });
};

const mergeMemoryBucket = (previous: MemoryBucket | null, freshFacts: string[], freshTopics: string[]) => {
  return {
    facts: uniqueTrimmed([...(previous?.facts || []), ...freshFacts], 14),
    recentTopics: uniqueTrimmed([...(previous?.recentTopics || []), ...freshTopics], 14),
    updatedAt: new Date().toISOString(),
  } satisfies MemoryBucket;
};

const determineMemoryScope = (question: string, intent?: string): ConversationMemory['scope'] => {
  const normalized = question.toLowerCase();

  const roomSpecificHints = [
    'yang tadi',
    'sebelumnya',
    'itu tadi',
    'di room ini',
    'chat ini',
    'konteks ini',
    'lanjutin',
    'detail itu',
  ];

  const globalHints = [
    'fitur',
    'cara kerja',
    'bagaimana sistem',
    'aplikasi',
    'ctrack',
    'kebijakan',
    'role',
    'permission',
    'umumnya',
    'secara umum',
  ];

  const hasRoomHint = roomSpecificHints.some((token) => normalized.includes(token));
  const hasGlobalHint = globalHints.some((token) => normalized.includes(token));

  if (intent === 'ANALYTICS' || hasRoomHint) {
    return 'ROOM_SPECIFIC';
  }

  if (hasGlobalHint || intent === 'SYSTEM' || intent === 'GENERAL') {
    return 'GLOBAL';
  }

  return 'HYBRID';
};

export const upsertConversationMemory = async (input: {
  userId: string;
  roomId?: string;
  conversation: ChatMessage[];
  latestQuestion: string;
  intent?: string;
}): Promise<ConversationMemory> => {
  const roomKey = roomMemoryKey(input.userId, input.roomId);
  const globalKey = globalMemoryKey(input.userId);

  const [previousRoom, previousGlobal] = await Promise.all([
    getMemoryBucket(roomKey),
    getMemoryBucket(globalKey),
  ]);

  const freshFacts = extractFacts(input.conversation);
  const freshTopics = extractTopics([
    ...input.conversation,
    { role: 'user', content: input.latestQuestion },
  ]);

  const roomMemory = mergeMemoryBucket(previousRoom, freshFacts, freshTopics);
  const globalMemory = mergeMemoryBucket(previousGlobal, freshFacts, freshTopics);

  await Promise.all([saveMemoryBucket(roomKey, roomMemory), saveMemoryBucket(globalKey, globalMemory)]);

  return {
    scope: determineMemoryScope(input.latestQuestion, input.intent),
    global: globalMemory,
    room: roomMemory,
  };
};
