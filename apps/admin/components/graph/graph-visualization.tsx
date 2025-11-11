'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  GraphNode,
  GraphEdge,
  GraphState,
  LayoutType,
  getNeighbors,
  NODE_COLORS,
  EDGE_COLORS,
} from '@/lib/graph-utils';

// Dynamically import ForceGraph2D to avoid SSR issues
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full">Loading graph...</div>,
});

interface GraphVisualizationProps {
  graphState: GraphState;
  width?: number;
  height?: number;
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  backgroundColor?: string;
  // Animation support
  newNodeIds?: Set<string>;
  newEdgeIds?: Set<string>;
  animatingNodeIds?: Set<string>;
}

export function GraphVisualization({
  graphState,
  width = 800,
  height = 600,
  onNodeClick,
  onNodeHover,
  backgroundColor = '#ffffff',
  newNodeIds = new Set(),
  newEdgeIds = new Set(),
  animatingNodeIds = new Set(),
}: GraphVisualizationProps) {
  const fgRef = useRef<any>(null);
  const [highlightNodes, setHighlightNodes] = useState(new Set<string>());
  const [highlightLinks, setHighlightLinks] = useState(new Set<string>());
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [nodeOpacities, setNodeOpacities] = useState<Map<string, number>>(new Map());
  const [edgeOpacities, setEdgeOpacities] = useState<Map<string, number>>(new Map());

  // Prepare graph data in the format react-force-graph expects
  const graphData = {
    nodes: graphState.nodes.map((node) => ({
      ...node,
      // Add rendering properties
      val: node.size,
      color: node.color || NODE_COLORS[node.type],
    })),
    links: graphState.edges.map((edge) => ({
      ...edge,
      // Add rendering properties
      color: edge.color || EDGE_COLORS[edge.type],
      width: edge.weight * 3, // Scale thickness
    })),
  };

  // Apply force simulation settings based on layout
  useEffect(() => {
    if (!fgRef.current) return;

    const fg = fgRef.current;

    // Configure force simulation
    switch (graphState.layout) {
      case 'force':
        fg.d3Force('charge')?.strength(-120);
        fg.d3Force('link')?.distance(80);
        break;
      case 'radial':
        fg.d3Force('charge')?.strength(-50);
        fg.d3Force('link')?.distance(60);
        fg.d3Force('radial', null); // Could add radial force here
        break;
      case 'circular':
        fg.d3Force('charge')?.strength(0);
        fg.d3Force('link')?.distance(50);
        break;
    }
  }, [graphState.layout]);

  // Animate fade-in for new nodes
  useEffect(() => {
    if (newNodeIds.size === 0) return;

    // Start new nodes at 0 opacity
    const newOpacities = new Map(nodeOpacities);
    newNodeIds.forEach((id) => {
      if (!newOpacities.has(id)) {
        newOpacities.set(id, 0);
      }
    });
    setNodeOpacities(newOpacities);

    // Fade in over 300ms
    const steps = 20;
    const stepDelay = 15; // 300ms total
    let currentStep = 0;

    const interval = setInterval(() => {
      currentStep++;
      const opacity = currentStep / steps;

      setNodeOpacities((prev) => {
        const updated = new Map(prev);
        newNodeIds.forEach((id) => {
          updated.set(id, opacity);
        });
        return updated;
      });

      if (currentStep >= steps) {
        clearInterval(interval);
      }
    }, stepDelay);

    return () => clearInterval(interval);
  }, [newNodeIds]);

  // Animate fade-in for new edges
  useEffect(() => {
    if (newEdgeIds.size === 0) return;

    // Start new edges at 0 opacity
    const newOpacities = new Map(edgeOpacities);
    newEdgeIds.forEach((id) => {
      if (!newOpacities.has(id)) {
        newOpacities.set(id, 0);
      }
    });
    setEdgeOpacities(newOpacities);

    // Fade in over 300ms
    const steps = 20;
    const stepDelay = 15;
    let currentStep = 0;

    const interval = setInterval(() => {
      currentStep++;
      const opacity = currentStep / steps;

      setEdgeOpacities((prev) => {
        const updated = new Map(prev);
        newEdgeIds.forEach((id) => {
          updated.set(id, opacity);
        });
        return updated;
      });

      if (currentStep >= steps) {
        clearInterval(interval);
      }
    }, stepDelay);

    return () => clearInterval(interval);
  }, [newEdgeIds]);

  // Handle node click - highlight neighbors
  const handleNodeClick = useCallback(
    (node: any) => {
      const nodeId = node.id;
      const neighbors = getNeighbors(nodeId, graphState.edges);

      // Toggle highlight
      if (highlightNodes.has(nodeId)) {
        setHighlightNodes(new Set());
        setHighlightLinks(new Set());
      } else {
        const newHighlightNodes = new Set([nodeId, ...Array.from(neighbors)]);
        const newHighlightLinks = new Set(
          graphState.edges
            .filter((edge) => edge.source === nodeId || edge.target === nodeId)
            .map((edge) => edge.id)
        );
        setHighlightNodes(newHighlightNodes);
        setHighlightLinks(newHighlightLinks);
      }

      onNodeClick?.(node);
    },
    [graphState.edges, highlightNodes, onNodeClick]
  );

  // Handle node hover
  const handleNodeHover = useCallback(
    (node: any) => {
      setHoverNode(node);
      onNodeHover?.(node);
    },
    [onNodeHover]
  );

  // Node canvas rendering with custom styling
  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isHighlighted = highlightNodes.has(node.id);
      const isHovered = hoverNode?.id === node.id;
      const isNew = newNodeIds.has(node.id);
      const isAnimating = animatingNodeIds.has(node.id);

      // Calculate node size
      const nodeSize = node.val || 5;
      const radius = Math.sqrt(nodeSize) * 2;

      // Get opacity for fade-in animation
      const opacity = nodeOpacities.get(node.id) ?? 1;

      // Save context for opacity
      ctx.save();
      ctx.globalAlpha = opacity;

      // Draw node
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.fill();

      // Add border for highlighted, hovered, or new nodes
      if (isHighlighted || isHovered || isNew || isAnimating) {
        let borderColor = '#3b82f6'; // blue for highlight
        if (isHovered) borderColor = '#fbbf24'; // yellow for hover
        if (isNew || isAnimating) borderColor = '#10b981'; // green for new

        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();

        // Add pulsing glow for animating nodes
        if (isAnimating) {
          const pulseRadius = radius + 4 + Math.sin(Date.now() / 200) * 2;
          ctx.beginPath();
          ctx.arc(node.x, node.y, pulseRadius, 0, 2 * Math.PI);
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1 / globalScale;
          ctx.globalAlpha = 0.3 * opacity;
          ctx.stroke();
        }
      }

      // Restore alpha for label
      ctx.globalAlpha = opacity;

      // Draw label if zoomed in enough or highlighted
      if (globalScale > 1.5 || isHighlighted || isHovered || isNew) {
        ctx.font = `${12 / globalScale}px Sans-Serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1f2937'; // gray-800
        ctx.fillText(node.label, node.x, node.y + radius + 8 / globalScale);
      }

      ctx.restore();
    },
    [highlightNodes, hoverNode, newNodeIds, animatingNodeIds, nodeOpacities]
  );

  // Link canvas rendering with custom styling
  const linkCanvasObject = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isHighlighted = highlightLinks.has(link.id);
      const isNew = newEdgeIds.has(link.id);

      // Get opacity for fade-in animation
      const opacity = edgeOpacities.get(link.id) ?? 1;

      // Save context for opacity
      ctx.save();
      ctx.globalAlpha = opacity;

      // Calculate link width
      const linkWidth = link.width || 1;
      const actualWidth = isHighlighted || isNew ? linkWidth * 2 : linkWidth;

      // Draw link
      ctx.beginPath();
      ctx.moveTo(link.source.x, link.source.y);
      ctx.lineTo(link.target.x, link.target.y);

      let strokeColor = link.color;
      if (isHighlighted) strokeColor = '#3b82f6';
      if (isNew) strokeColor = '#10b981'; // green for new edges

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = actualWidth / globalScale;
      ctx.stroke();

      // Draw directional arrow if edge has direction
      if (
        link.type === 'increased' ||
        link.type === 'decreased' ||
        link.type === 'rotation'
      ) {
        const arrowLength = 10 / globalScale;
        const arrowWidth = 5 / globalScale;

        // Calculate arrow position (60% along the link)
        const arrowX = link.source.x + (link.target.x - link.source.x) * 0.6;
        const arrowY = link.source.y + (link.target.y - link.source.y) * 0.6;

        // Calculate angle
        const angle = Math.atan2(link.target.y - link.source.y, link.target.x - link.source.x);

        // Draw arrow
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(arrowX, arrowY);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowLength, -arrowWidth);
        ctx.lineTo(-arrowLength, arrowWidth);
        ctx.closePath();
        ctx.fillStyle = strokeColor;
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    },
    [highlightLinks, newEdgeIds, edgeOpacities]
  );

  // Node tooltip
  const nodeLabel = useCallback((node: any) => {
    let label = `<div style="padding: 8px; background: white; border: 1px solid #e5e7eb; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">`;
    label += `<div style="font-weight: 600; margin-bottom: 4px;">${node.label}</div>`;
    label += `<div style="font-size: 12px; color: #6b7280;">Type: ${node.type}</div>`;

    // Add metadata
    if (node.metadata) {
      if (node.metadata.ticker) {
        label += `<div style="font-size: 12px; color: #6b7280;">Ticker: ${node.metadata.ticker}</div>`;
      }
      if (node.metadata.institution) {
        label += `<div style="font-size: 12px; color: #6b7280;">Institution: ${node.metadata.institution}</div>`;
      }
      if (node.metadata.portfolioValue) {
        const valueInB = (node.metadata.portfolioValue / 1_000_000_000).toFixed(2);
        label += `<div style="font-size: 12px; color: #6b7280;">Portfolio: $${valueInB}B</div>`;
      }
      if (node.metadata.communityId) {
        label += `<div style="font-size: 12px; color: #6b7280;">Community: ${node.metadata.communityId}</div>`;
      }
    }

    label += `</div>`;
    return label;
  }, []);

  return (
    <div className="relative" style={{ width, height }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={height}
        backgroundColor={backgroundColor}
        nodeCanvasObject={nodeCanvasObject}
        linkCanvasObject={linkCanvasObject}
        nodeLabel={nodeLabel}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onNodeDrag={(node: any) => {
          // Allow node dragging - position is updated automatically
        }}
        onNodeDragEnd={(node: any) => {
          // Fix node position after dragging
          node.fx = node.x;
          node.fy = node.y;
        }}
        cooldownTicks={100}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        enableNodeDrag={true}
        warmupTicks={50}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />

      {/* Instructions overlay */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-1">
        <div>🖱️ <strong>Drag</strong> to pan • <strong>Scroll</strong> to zoom</div>
        <div>👆 <strong>Click node</strong> to highlight neighbors</div>
        <div>✋ <strong>Drag node</strong> to reposition</div>
      </div>
    </div>
  );
}
