import type { HttpTransport, RawHttpResponse, TransportRequest } from '../types';

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
 * Creates an HTTP transport adapter for Axios-like HTTP clients.
 * @deprecated Consider using fetchTransport instead for zero-dependency setup.
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

    return {
      status: response.status,
      headers: response.headers,
      body: response.data,
    };
  };
};
