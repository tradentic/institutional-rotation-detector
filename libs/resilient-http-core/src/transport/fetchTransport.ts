import type { HttpTransport } from '../types';

export const fetchTransport: HttpTransport = (req) => fetch(req.url, req.init);
