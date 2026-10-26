import { Injectable } from '@nestjs/common';
import { NetworkLink, PricingRule } from '@prisma/client';

export interface PriceQuote {
  basePrice: number;
  unitPrice: number;
  currency: string;
  termMonths: number;
  applied: {
    ruleId: string;
    name: string;
    mode: string;
    value: number;
    before: number;
    after: number;
  }[];
}

interface Adjustment {
  mode: 'PERCENT' | 'FIXED' | 'OVERRIDE';
  value: number;
}

interface Conditions {
  minCapacityMbps?: number;
  minTermMonths?: number;
  maxTermMonths?: number;
  minRequestedMbps?: number;
}

@Injectable()
export class PricingService {
  compute(
    link: Pick<NetworkLink, 'id' | 'basePrice' | 'currency' | 'capacityMbps'>,
    rules: PricingRule[],
    opts: { termMonths?: number; requestedMbps?: number | null; at?: Date } = {},
  ): PriceQuote {
    const termMonths = opts.termMonths ?? 12;
    const at = opts.at ?? new Date();
    const base = Number(link.basePrice ?? 0);
    let price = base;
    const applied: PriceQuote['applied'] = [];

    const matching = rules
      .filter((r) => r.isActive && (!r.networkLinkId || r.networkLinkId === link.id))
      .filter((r) => (!r.validFrom || r.validFrom <= at) && (!r.validUntil || r.validUntil >= at))
      .filter((r) => {
        const c = (r.conditions ?? {}) as Conditions;
        return (
          (c.minCapacityMbps === undefined || (link.capacityMbps ?? 0) >= c.minCapacityMbps) &&
          (c.minTermMonths === undefined || termMonths >= c.minTermMonths) &&
          (c.maxTermMonths === undefined || termMonths <= c.maxTermMonths) &&
          (c.minRequestedMbps === undefined || (opts.requestedMbps ?? 0) >= c.minRequestedMbps)
        );
      })
      .sort((a, b) => a.priority - b.priority);

    for (const r of matching) {
      const adj = r.adjustment as unknown as Adjustment;
      const before = price;
      if (adj.mode === 'OVERRIDE') price = adj.value;
      else if (adj.mode === 'PERCENT') price = price * (1 + adj.value / 100);
      else if (adj.mode === 'FIXED') price = price + adj.value;
      price = Math.max(0, Math.round(price * 100) / 100);
      applied.push({
        ruleId: r.id,
        name: r.name,
        mode: adj.mode,
        value: adj.value,
        before,
        after: price,
      });
    }
    return { basePrice: base, unitPrice: price, currency: link.currency, termMonths, applied };
  }
}
