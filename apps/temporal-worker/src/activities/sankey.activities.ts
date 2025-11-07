import { randomUUID } from 'crypto';
import { createSupabaseClient } from '../lib/supabase.js';

export interface FlowDelta {
  entityId: string | null;
  cusip: string;
  equityDelta: number;
  optionsDelta: number;
}

export interface SankeyResult {
  nodes: Array<{ id: string; label: string; kind: string }>;
  links: Array<{
    source: string;
    target: string;
    equity: number;
    options: number;
  }>;
}

export async function buildEdges(
  sellerFlows: FlowDelta[],
  buyerFlows: FlowDelta[],
  period: { start: string; end: string }
): Promise<SankeyResult> {
  const totalSell = sellerFlows.reduce((sum, s) => sum + Math.abs(s.equityDelta), 0);
  const totalBuy = buyerFlows.reduce((sum, s) => sum + s.equityDelta, 0);
  const supabase = createSupabaseClient();
  const clusterId = randomUUID();

  const remainder = Math.max(0, totalSell - totalBuy);
  const remainderId = remainder > 0 ? randomUUID() : null;

  const links: SankeyResult['links'] = [];
  for (const seller of sellerFlows) {
    const sellerOut = Math.abs(seller.equityDelta);
    for (const buyer of buyerFlows) {
      const weight = buyer.equityDelta / totalBuy;
      const equity = sellerOut * weight;
      if (equity <= 0) continue;
      links.push({
        source: seller.entityId ?? 'unknown_seller',
        target: buyer.entityId ?? 'unknown_buyer',
        equity,
        options: seller.optionsDelta * weight,
      });
    }
    if (remainderId && sellerOut > 0) {
      const weight = remainder / totalSell;
      if (weight > 0) {
        links.push({
          source: seller.entityId ?? 'unknown_seller',
          target: remainderId,
          equity: sellerOut * weight,
          options: 0,
        });
      }
    }
  }

  const nodes = new Set<string>();
  links.forEach((link) => {
    nodes.add(link.source);
    nodes.add(link.target);
  });

  for (const link of links) {
    await supabase.from('rotation_edges').upsert(
      {
        cluster_id: clusterId,
        period_start: period.start,
        period_end: period.end,
        seller_id: link.source,
        buyer_id: link.target,
        cusip: buyerFlows[0]?.cusip ?? 'UNKNOWN',
        equity_shares: Math.round(link.equity),
        options_shares: Math.round(link.options),
        confidence: 0.8,
        notes: remainderId === link.target ? 'Other Absorption' : null,
      },
      { onConflict: 'cluster_id,seller_id,buyer_id,cusip' }
    );
  }

  return {
    nodes: [...nodes].map((id) => ({ id, label: id, kind: 'entity' })),
    links,
  };
}
