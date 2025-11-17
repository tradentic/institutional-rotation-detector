import type { HttpTransport, RawHttpResponse, TransportRequest } from '../types';

/**
 * Default HTTP transport using the global fetch API.
 * Converts TransportRequest to fetch RequestInit and RawHttpResponse.
 */
export const fetchTransport: HttpTransport = async (
  req: TransportRequest,
  signal: AbortSignal
): Promise<RawHttpResponse> => {
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal,
  };

  const response = await fetch(req.url, init);
  const body = await response.arrayBuffer();

  // Convert Headers to plain object
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: response.status,
    headers,
    body,
  };
};
