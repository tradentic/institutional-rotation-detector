import {
  CoTSession,
  createAnalysisSession,
  createClient as createBaseClient,
  createCodeSession,
  createFastSession,
  createOpenAiClientFromEnv,
  restoreSession,
  type AIClient,
  type ClientConfig,
} from '@libs/openai-client';
import { RedisRateLimiter } from './redisRateLimiter';
import { RedisApiCache } from './redisApiCache';

let sharedHttpClient: ReturnType<typeof createOpenAiClientFromEnv> | null = null;

function getHttpClient() {
  if (!sharedHttpClient) {
    const maxRps = Number(process.env.MAX_RPS_OPENAI ?? '10');
    const rateLimiter = new RedisRateLimiter({
      identifier: 'openai-api',
      maxPerSecond: maxRps,
      namespace: 'ratelimit',
      failOpen: true,
    });
    const cache = new RedisApiCache({ namespace: 'openai', failOpen: true });
    sharedHttpClient = createOpenAiClientFromEnv({ rateLimiter, cache });
  }
  return sharedHttpClient;
}

export function createClient(config: ClientConfig = {}): AIClient {
  return createBaseClient({
    ...config,
    httpClient: getHttpClient(),
  });
}

export {
  CoTSession,
  createAnalysisSession,
  createCodeSession,
  createFastSession,
  restoreSession,
} from '@libs/openai-client';

export type { ClientConfig } from '@libs/openai-client';
