import type { HttpTransport, TransportRequest, RawHttpResponse, HttpHeaders } from '../types';

export interface AxiosInstanceLike {
  request<T = unknown>(config: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    signal?: AbortSignal;
    responseType?: 'arraybuffer';
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    data: T;
  }>;
}

/**
 * v0.8 axios-based HTTP transport.
 * Wraps an axios instance and converts its responses to RawHttpResponse.
 */
export const createAxiosTransport = (axiosInstance: AxiosInstanceLike): HttpTransport => {
  return async (req: TransportRequest, signal: AbortSignal): Promise<RawHttpResponse> => {
    const response = await axiosInstance.request<ArrayBuffer>({
      url: req.url,
      method: req.method,
      headers: req.headers,
      data: req.body,
      signal,
      responseType: 'arraybuffer',
    });

    // Normalize headers to plain object
    const headers: HttpHeaders = {};
    const responseHeaders = response.headers;
    if (responseHeaders) {
      for (const [key, value] of Object.entries(responseHeaders)) {
        headers[key] = String(value);
      }
    }

    return {
      status: response.status,
      headers,
      body: response.data,
    };
  };
};
