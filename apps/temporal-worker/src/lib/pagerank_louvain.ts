export interface CommunityEdge {
  src: string;
  dst: string;
  weight: number;
}

export interface CommunityResult {
  communityId: string;
  nodes: string[];
  edges: CommunityEdge[];
  score: number;
}

function undirectedKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export function louvainLikeCommunities(nodes: string[], edges: CommunityEdge[]): CommunityResult[] {
  const adjacency = new Map<string, Map<string, number>>();
  for (const edge of edges) {
    const { src, dst, weight } = edge;
    if (!adjacency.has(src)) adjacency.set(src, new Map());
    if (!adjacency.has(dst)) adjacency.set(dst, new Map());
    const srcMap = adjacency.get(src)!;
    const dstMap = adjacency.get(dst)!;
    srcMap.set(dst, (srcMap.get(dst) ?? 0) + weight);
    dstMap.set(src, (dstMap.get(src) ?? 0) + weight);
  }

  const labels = new Map<string, string>();
  const sortedNodes = [...nodes].sort();
  for (const node of sortedNodes) {
    labels.set(node, node);
  }

  const iterations = 5;
  for (let iter = 0; iter < iterations; iter += 1) {
    let changed = false;
    for (const node of sortedNodes) {
      const neighbors = adjacency.get(node);
      if (!neighbors || neighbors.size === 0) continue;
      const scores = new Map<string, number>();
      for (const [neighbor, weight] of neighbors.entries()) {
        const community = labels.get(neighbor) ?? neighbor;
        scores.set(community, (scores.get(community) ?? 0) + weight);
      }
      let bestCommunity = labels.get(node) ?? node;
      let bestScore = scores.get(bestCommunity) ?? 0;
      for (const [community, score] of [...scores.entries()].sort()) {
        if (score > bestScore || (score === bestScore && community < bestCommunity)) {
          bestCommunity = community;
          bestScore = score;
        }
      }
      if (bestCommunity !== labels.get(node)) {
        labels.set(node, bestCommunity);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byCommunity = new Map<string, { nodes: Set<string>; edgeMap: Map<string, CommunityEdge>; weightSum: number }>();
  for (const node of sortedNodes) {
    const community = labels.get(node) ?? node;
    if (!byCommunity.has(community)) {
      byCommunity.set(community, { nodes: new Set(), edgeMap: new Map(), weightSum: 0 });
    }
    byCommunity.get(community)!.nodes.add(node);
  }

  for (const edge of edges) {
    const srcCommunity = labels.get(edge.src) ?? edge.src;
    const dstCommunity = labels.get(edge.dst) ?? edge.dst;
    if (srcCommunity !== dstCommunity) continue;
    const key = undirectedKey(edge.src, edge.dst);
    const group = byCommunity.get(srcCommunity);
    if (!group) continue;
    const existing = group.edgeMap.get(key);
    if (existing) {
      existing.weight += edge.weight;
    } else {
      group.edgeMap.set(key, { ...edge });
    }
    group.weightSum += edge.weight;
  }

  return [...byCommunity.entries()].map(([communityId, value]) => ({
    communityId,
    nodes: [...value.nodes].sort(),
    edges: [...value.edgeMap.values()].sort((a, b) => {
      if (a.weight === b.weight) return a.src.localeCompare(b.src) || a.dst.localeCompare(b.dst);
      return b.weight - a.weight;
    }),
    score: value.weightSum,
  }));
}

export function topNodes(community: CommunityResult, limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const edge of community.edges) {
    counts.set(edge.src, (counts.get(edge.src) ?? 0) + edge.weight);
    counts.set(edge.dst, (counts.get(edge.dst) ?? 0) + edge.weight);
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] === a[1]) return a[0].localeCompare(b[0]);
      return b[1] - a[1];
    })
    .slice(0, limit)
    .map(([node]) => node);
}
