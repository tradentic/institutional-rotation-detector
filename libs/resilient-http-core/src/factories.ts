import { HttpClient } from './HttpClient';
import { fetchTransport } from './transport/fetchTransport';
import type { HttpClientConfig, ResilienceProfile, Logger } from './types';

export interface DefaultHttpClientOptions {
    clientName: string;
    baseUrl?: string;
    defaultResilience?: ResilienceProfile;
    logger?: Logger;
}

class ConsoleLogger implements Logger {
    debug(message: string, meta?: Record<string, unknown>): void {
        console.debug(message, meta);
    }
    info(message: string, meta?: Record<string, unknown>): void {
        console.info(message, meta);
    }
    warn(message: string, meta?: Record<string, unknown>): void {
        console.warn(message, meta);
    }
    error(message: string, meta?: Record<string, unknown>): void {
        console.error(message, meta);
    }
}

export function createDefaultHttpClient(options: DefaultHttpClientOptions): HttpClient {
    const config: HttpClientConfig = {
        clientName: options.clientName,
        baseUrl: options.baseUrl,
        transport: fetchTransport,
        defaultResilience: options.defaultResilience ?? {
            maxAttempts: 3,
            retryEnabled: true,
            perAttemptTimeoutMs: 10_000,
            overallTimeoutMs: 30_000,
            baseBackoffMs: 250,
            maxBackoffMs: 10_000,
            jitterFactorRange: [0.8, 1.2],
        },
        logger: options.logger ?? new ConsoleLogger(),
    };

    return new HttpClient(config);
}
