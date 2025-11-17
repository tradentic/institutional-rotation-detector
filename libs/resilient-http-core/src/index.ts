// ============================================================================
// Resilient HTTP Core v0.8.0
// ============================================================================

// Core types
export * from './types';

// HttpClient and factories
export { HttpClient, createDefaultHttpClient } from './HttpClient';
export type { DefaultClientOptions } from './HttpClient';

// Standard interceptors
export {
  createAuthInterceptor,
  createJsonBodyInterceptor,
  createIdempotencyInterceptor,
} from './interceptors';
export type {
  AuthInterceptorOptions,
  JsonBodyInterceptorOptions,
  IdempotencyInterceptorOptions,
} from './interceptors';

// Transports
export { fetchTransport } from './transport/fetchTransport';
export { createAxiosTransport } from './transport/axiosTransport';
export type { AxiosInstanceLike } from './transport/axiosTransport';
