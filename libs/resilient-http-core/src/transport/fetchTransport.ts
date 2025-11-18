import type { HttpTransport, TransportRequest, RawHttpResponse, HttpHeaders } from '../types';

/**
 * v0.8 fetch-based HTTP transport.
 * Uses global fetch API and converts Response to RawHttpResponse.
 */
export const fetchTransport: HttpTransport = async (req: TransportRequest, signal: AbortSignal): Promise<RawHttpResponse> => {
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal,
  };

  const response = await fetch(req.url, init);
  const body = await response.arrayBuffer();

  // Convert Headers object to plain object
  const headers: HttpHeaders = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: response.status,
    headers,
    body,
  };
};
