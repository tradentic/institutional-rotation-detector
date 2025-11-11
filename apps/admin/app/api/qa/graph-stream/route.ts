import { NextRequest } from 'next/server';
import {
  GraphEvent,
  GraphStartedEvent,
  NodeAddedEvent,
  EdgeAddedEvent,
  CommunityDetectedEvent,
  GraphCompleteEvent,
} from '@/lib/graph-streaming';
import {
  GraphNode,
  GraphEdge,
  NODE_COLORS,
  EDGE_COLORS,
  getCommunityColor,
} from '@/lib/graph-utils';

/**
 * SSE endpoint for real-time graph construction
 *
 * Streams graph building events as the Q&A workflow analyzes the institutional
 * ownership network. Events include:
 * - graphStarted: Initial graph metadata
 * - nodeAdded: Institution/issuer discovered
 * - edgeAdded: Relationship detected
 * - communityDetected: Community/cluster identified
 * - graphComplete: Graph construction finished
 *
 * In production, this would:
 * 1. Connect to Temporal workflow
 * 2. Subscribe to graph construction activities
 * 3. Stream real-time events as analysis progresses
 *
 * Current implementation: Simulates realistic graph construction
 */
export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get('workflowId');

  if (!workflowId) {
    return new Response('Missing workflowId', { status: 400 });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Helper to send events
        const sendEvent = (event: GraphEvent) => {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        };

        // Generate mock graph based on workflowId pattern
        // In production, this would query actual workflow state
        await generateMockGraphStream(workflowId, sendEvent);

        controller.close();
      } catch (error) {
        console.error('Graph stream error:', error);
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// ============================================================================
// Mock Graph Generation
// ============================================================================

async function generateMockGraphStream(
  workflowId: string,
  sendEvent: (event: GraphEvent) => void
) {
  const startTime = Date.now();
  const baseTimestamp = new Date().toISOString();

  // Determine graph type from workflowId (in production, from workflow state)
  const graphType = determineGraphType(workflowId);

  // Send graph started event
  const startEvent: GraphStartedEvent = {
    type: 'graphStarted',
    timestamp: baseTimestamp,
    workflowId,
    data: {
      graphType,
      estimatedNodes: graphType === 'community' ? 20 : 15,
      estimatedEdges: graphType === 'community' ? 35 : 25,
    },
  };
  sendEvent(startEvent);
  await sleep(100);

  // Generate graph based on type
  switch (graphType) {
    case 'community':
      await generateCommunityGraph(workflowId, sendEvent);
      break;
    case 'cross-community':
      await generateCrossCommunityGraph(workflowId, sendEvent);
      break;
    case 'correlation':
      await generateCorrelationGraph(workflowId, sendEvent);
      break;
    default:
      await generateOverviewGraph(workflowId, sendEvent);
      break;
  }

  // Send completion event
  const completeEvent: GraphCompleteEvent = {
    type: 'graphComplete',
    timestamp: new Date().toISOString(),
    workflowId,
    data: {
      totalNodes: startEvent.data.estimatedNodes,
      totalEdges: startEvent.data.estimatedEdges,
      totalCommunities: graphType === 'community' ? 3 : undefined,
      durationMs: Date.now() - startTime,
    },
  };
  sendEvent(completeEvent);
}

async function generateCommunityGraph(
  workflowId: string,
  sendEvent: (event: GraphEvent) => void
) {
  const communities = 3;
  const institutionsPerCommunity = [7, 6, 7];

  for (let c = 0; c < communities; c++) {
    const communityNodes: string[] = [];

    // Add institutions in this community
    for (let i = 0; i < institutionsPerCommunity[c]; i++) {
      const nodeId = `inst-${c}-${i}`;
      const node: GraphNode = {
        id: nodeId,
        type: 'institution',
        label: `Institution ${String.fromCharCode(65 + c)}${i + 1}`,
        size: Math.random() * 4 + 4,
        color: getCommunityColor(c),
        metadata: {
          institution: `Institution ${String.fromCharCode(65 + c)}${i + 1}`,
          communityId: `community-${c}`,
          portfolioValue: Math.random() * 10_000_000_000 + 1_000_000_000,
        },
      };

      const nodeEvent: NodeAddedEvent = {
        type: 'nodeAdded',
        timestamp: new Date().toISOString(),
        workflowId,
        data: {
          node,
          reason: `Discovered in community ${c + 1} during cluster analysis`,
        },
      };
      sendEvent(nodeEvent);
      communityNodes.push(nodeId);
      await sleep(150); // Delay between nodes
    }

    // Add edges within community
    for (let i = 0; i < communityNodes.length; i++) {
      const sourceId = communityNodes[i];
      // Connect to 2-3 other nodes in same community
      const numConnections = Math.min(3, Math.floor(Math.random() * 2) + 2);

      for (let j = 0; j < numConnections; j++) {
        const targetIdx = (i + j + 1) % communityNodes.length;
        if (targetIdx === i) continue;

        const targetId = communityNodes[targetIdx];
        const edge: GraphEdge = {
          id: `edge-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          type: 'sameCommunity',
          weight: Math.random() * 0.5 + 0.5,
          color: EDGE_COLORS.sameCommunity,
          metadata: {
            similarity: Math.random() * 0.3 + 0.7,
          },
        };

        const edgeEvent: EdgeAddedEvent = {
          type: 'edgeAdded',
          timestamp: new Date().toISOString(),
          workflowId,
          data: {
            edge,
            reason: 'Similar trading patterns detected',
          },
        };
        sendEvent(edgeEvent);
        await sleep(100); // Delay between edges
      }
    }

    // Announce community detection
    const communityEvent: CommunityDetectedEvent = {
      type: 'communityDetected',
      timestamp: new Date().toISOString(),
      workflowId,
      data: {
        communityId: `community-${c}`,
        nodeIds: communityNodes,
        description: `Community ${c + 1}: ${communityNodes.length} institutions with coordinated trading behavior`,
      },
    };
    sendEvent(communityEvent);
    await sleep(200);
  }
}

async function generateCrossCommunityGraph(
  workflowId: string,
  sendEvent: (event: GraphEvent) => void
) {
  const tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN'];
  const institutions = 12;

  // Add ticker nodes first
  for (const ticker of tickers) {
    const node: GraphNode = {
      id: ticker,
      type: 'issuer',
      label: ticker,
      size: 8,
      color: NODE_COLORS.issuer,
      metadata: { ticker },
    };

    const nodeEvent: NodeAddedEvent = {
      type: 'nodeAdded',
      timestamp: new Date().toISOString(),
      workflowId,
      data: {
        node,
        reason: `Target issuer mentioned in query`,
      },
    };
    sendEvent(nodeEvent);
    await sleep(150);
  }

  // Add institutions
  for (let i = 0; i < institutions; i++) {
    const nodeId = `inst-${i}`;
    const node: GraphNode = {
      id: nodeId,
      type: 'institution',
      label: `Institution ${i + 1}`,
      size: Math.random() * 4 + 4,
      color: NODE_COLORS.institution,
      metadata: {
        institution: `Institution ${i + 1}`,
        portfolioValue: Math.random() * 8_000_000_000 + 2_000_000_000,
      },
    };

    const nodeEvent: NodeAddedEvent = {
      type: 'nodeAdded',
      timestamp: new Date().toISOString(),
      workflowId,
      data: {
        node,
        reason: `Major holder detected across target issuers`,
      },
    };
    sendEvent(nodeEvent);
    await sleep(150);

    // Connect to 1-3 tickers
    const numHoldings = Math.floor(Math.random() * 3) + 1;
    const selectedTickers = tickers.slice(0, numHoldings);

    for (const ticker of selectedTickers) {
      const isIncrease = Math.random() > 0.5;
      const edge: GraphEdge = {
        id: `edge-${nodeId}-${ticker}`,
        source: nodeId,
        target: ticker,
        type: isIncrease ? 'increased' : 'decreased',
        weight: Math.random() * 0.7 + 0.3,
        color: isIncrease ? EDGE_COLORS.increased : EDGE_COLORS.decreased,
        metadata: {
          percentChange: (Math.random() * 50 - 25) * (isIncrease ? 1 : -1),
          quarter: '2024Q3',
        },
      };

      const edgeEvent: EdgeAddedEvent = {
        type: 'edgeAdded',
        timestamp: new Date().toISOString(),
        workflowId,
        data: {
          edge,
          reason: `Position ${isIncrease ? 'increase' : 'decrease'} of ${Math.abs(edge.metadata.percentChange ?? 0).toFixed(1)}%`,
        },
      };
      sendEvent(edgeEvent);
      await sleep(100);
    }
  }
}

async function generateCorrelationGraph(
  workflowId: string,
  sendEvent: (event: GraphEvent) => void
) {
  const institutions = 15;
  const nodeIds: string[] = [];

  // Add institution nodes
  for (let i = 0; i < institutions; i++) {
    const nodeId = `inst-${i}`;
    const node: GraphNode = {
      id: nodeId,
      type: 'institution',
      label: `Institution ${i + 1}`,
      size: Math.random() * 5 + 3,
      color: NODE_COLORS.institution,
      metadata: {
        institution: `Institution ${i + 1}`,
        portfolioValue: Math.random() * 8_000_000_000,
      },
    };

    const nodeEvent: NodeAddedEvent = {
      type: 'nodeAdded',
      timestamp: new Date().toISOString(),
      workflowId,
      data: {
        node,
        reason: 'Analyzing portfolio correlations',
      },
    };
    sendEvent(nodeEvent);
    nodeIds.push(nodeId);
    await sleep(150);
  }

  // Add correlation edges (sparse)
  for (let i = 0; i < nodeIds.length; i++) {
    const numConnections = Math.floor(Math.random() * 3) + 1;

    for (let j = 0; j < numConnections; j++) {
      const targetIdx = (i + j + 1) % nodeIds.length;
      if (targetIdx === i) continue;

      const correlation = Math.random() * 0.4 + 0.6; // 0.6-1.0
      const edge: GraphEdge = {
        id: `edge-${nodeIds[i]}-${nodeIds[targetIdx]}`,
        source: nodeIds[i],
        target: nodeIds[targetIdx],
        type: 'correlatedWith',
        weight: correlation,
        color: EDGE_COLORS.correlatedWith,
        metadata: {
          correlationCoefficient: correlation,
        },
      };

      const edgeEvent: EdgeAddedEvent = {
        type: 'edgeAdded',
        timestamp: new Date().toISOString(),
        workflowId,
        data: {
          edge,
          reason: `Strong correlation detected (r=${correlation.toFixed(2)})`,
        },
      };
      sendEvent(edgeEvent);
      await sleep(100);
    }
  }
}

async function generateOverviewGraph(
  workflowId: string,
  sendEvent: (event: GraphEvent) => void
) {
  // Generic mixed graph with institutions and issuers
  const institutions = 12;
  const issuers = 3;
  const nodeIds: string[] = [];

  // Add institutions
  for (let i = 0; i < institutions; i++) {
    const nodeId = `inst-${i}`;
    const node: GraphNode = {
      id: nodeId,
      type: 'institution',
      label: `Institution ${i + 1}`,
      size: Math.random() * 5 + 3,
      color: NODE_COLORS.institution,
      metadata: {
        institution: `Institution ${i + 1}`,
      },
    };

    const nodeEvent: NodeAddedEvent = {
      type: 'nodeAdded',
      timestamp: new Date().toISOString(),
      workflowId,
      data: { node, reason: 'Major institutional holder' },
    };
    sendEvent(nodeEvent);
    nodeIds.push(nodeId);
    await sleep(150);
  }

  // Add issuers
  const tickerNames = ['AAPL', 'MSFT', 'GOOGL'];
  for (let i = 0; i < issuers; i++) {
    const nodeId = `issuer-${i}`;
    const node: GraphNode = {
      id: nodeId,
      type: 'issuer',
      label: tickerNames[i],
      size: 7,
      color: NODE_COLORS.issuer,
      metadata: { ticker: tickerNames[i] },
    };

    const nodeEvent: NodeAddedEvent = {
      type: 'nodeAdded',
      timestamp: new Date().toISOString(),
      workflowId,
      data: { node, reason: 'Target issuer' },
    };
    sendEvent(nodeEvent);
    nodeIds.push(nodeId);
    await sleep(150);
  }

  // Add random edges
  for (let i = 0; i < 25; i++) {
    const sourceIdx = Math.floor(Math.random() * nodeIds.length);
    const targetIdx = Math.floor(Math.random() * nodeIds.length);
    if (sourceIdx === targetIdx) continue;

    const edge: GraphEdge = {
      id: `edge-${i}`,
      source: nodeIds[sourceIdx],
      target: nodeIds[targetIdx],
      type: 'holds',
      weight: Math.random() * 0.8 + 0.2,
      color: EDGE_COLORS.holds,
      metadata: {},
    };

    const edgeEvent: EdgeAddedEvent = {
      type: 'edgeAdded',
      timestamp: new Date().toISOString(),
      workflowId,
      data: { edge, reason: 'Position detected' },
    };
    sendEvent(edgeEvent);
    await sleep(100);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function determineGraphType(workflowId: string): string {
  // In production, this would query the workflow state
  // For now, use simple heuristic based on workflowId
  const hash = workflowId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const types = ['community', 'cross-community', 'correlation', 'overview'];
  return types[hash % types.length];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
