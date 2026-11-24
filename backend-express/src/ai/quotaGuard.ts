import { getAIUsageSnapshot } from './usageTracker';

export type QuotaGuardResult =
  | {
      type: 'allowed';
      allowed: true;
      dailyRequests: number;
      dailyLimit: number;
      quotaRemaining: number;
    }
  | {
      type: 'quota_exceeded';
      allowed: false;
      dailyRequests: number;
      dailyLimit: number;
      quotaRemaining: number;
      message: string;
    };

export const checkDailyQuota = async (): Promise<QuotaGuardResult> => {
  const usage = await getAIUsageSnapshot();

  if (usage.requests_today >= usage.quota_limit) {
    return {
      type: 'quota_exceeded',
      allowed: false,
      dailyRequests: usage.requests_today,
      dailyLimit: usage.quota_limit,
      quotaRemaining: 0,
      message: 'AI sedang mencapai batas penggunaan hari ini. Silakan coba lagi nanti.',
    };
  }

  return {
    type: 'allowed',
    allowed: true,
    dailyRequests: usage.requests_today,
    dailyLimit: usage.quota_limit,
    quotaRemaining: usage.quota_remaining,
  };
};
