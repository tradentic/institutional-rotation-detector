/**
 * Supabase Edge Function: Graph Explain
 *
 * POST /graph-explain
 * Body: { "edgeIds": ["uuid1", "uuid2"], "question": "Why are institutions selling?" }
 *
 * Generates AI explanations for multiple edges with an optional question.
 */

import { POST } from '../../../apps/api/src/handlers/graph-explain.ts';

Deno.serve(async (req) => {
  // Enable CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const response = await POST(req);

    // Add CORS headers to response
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin': '*');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error('Error in graph-explain function:', error);
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
