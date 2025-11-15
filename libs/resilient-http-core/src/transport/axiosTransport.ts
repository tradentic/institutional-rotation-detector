import type { HttpTransport } from '../types';

export interface AxiosInstanceLike {
  request<T = unknown>(config: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    signal?: AbortSignal;
  }): Promise<{
    status: number;
    headers: HeadersInit | Record<string, string>;
    data: T;
  }>;
}

export const createAxiosTransport = (axiosInstance: AxiosInstanceLike): HttpTransport => {
  return async (url, init) => {
    const response = await axiosInstance.request<unknown>({
      url,
      method: init.method as string,
      headers: init.headers as Record<string, string>,
      data: init.body,
      signal: init.signal ?? undefined,
    });

    const data = isBodyInit(response.data) ? response.data : JSON.stringify(response.data);

    return new Response(data as BodyInit, {
      status: response.status,
      headers: response.headers as HeadersInit,
    });
  };
};

const isBodyInit = (value: unknown): value is BodyInit => {
  return (
    typeof value === 'string' ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof URLSearchParams ||
    value instanceof FormData
  );
};
