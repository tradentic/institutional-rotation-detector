/**
 * Supabase Edge Function: Graph
 *
 * GET /graph?ticker=AAPL&period=2024-01
 * GET /graph?cik=0000320193&period=2024-01
 *
 * Retrieves the rotation graph (nodes and edges) for a period.
 */

import { GET } from '../../../apps/api/src/handlers/graph.ts';

Deno.serve(async (req) => {
  // Enable CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const response = await GET(req);

    // Add CORS headers to response
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error('Error in graph function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});
