import type { HttpTransport } from '../types';

export const fetchTransport: HttpTransport = (url, init) => fetch(url, init);
