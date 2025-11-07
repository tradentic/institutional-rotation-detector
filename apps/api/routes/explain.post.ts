import { explainEdge } from '../../temporal-worker/src/activities/rag.activities.js';

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  if (!body?.edgeId) {
    return new Response('Missing edgeId', { status: 400 });
  }
  const explanation = await explainEdge({ edgeId: body.edgeId });
  return Response.json({ explanation });
}
