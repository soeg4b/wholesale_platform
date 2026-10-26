import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Post,
  UseGuards,
} from '@nestjs/common';
import { NetworkLink, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { OperatorContext } from '../common/operator-context.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';

const MAX_ROWS = 1000;
const OVERRIDE_PREFIX = 'price-override:';

interface BulkBody {
  linkIds?: string[];
  filter?: { origin?: string; destination?: string; category?: string };
  mode?: 'SET' | 'PERCENT' | 'FIXED';
  value?: number;
  dryRun?: boolean;
}

interface ImportBody {
  rows?: { linkId?: string; externalId?: string; price?: number }[];
  dryRun?: boolean;
}

export interface PriceChange {
  linkId: string;
  externalId: string | null;
  route: string;
  before: number | null;
  after: number;
  method: 'BASE_PRICE' | 'OVERRIDE_RULE';
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Leading =,+,-,@ would be evaluated as a formula by spreadsheet apps.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// Single and bulk price maintenance. Manual links get basePrice updated; API-managed links keep the
// synced basePrice and receive a per-link OVERRIDE pricing rule, so the next sync does not undo it.
@Controller('operator')
@UseGuards(AuthGuard)
export class BulkPricingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operators: OperatorContext,
    private readonly ledger: LedgerService,
  ) {}

  private async currentPrices(links: NetworkLink[]) {
    const overrides = await this.prisma.pricingRule.findMany({
      where: {
        networkLinkId: { in: links.map((l) => l.id) },
        name: { startsWith: OVERRIDE_PREFIX },
      },
    });
    const byLink = new Map(overrides.map((r) => [r.networkLinkId!, r]));
    return (l: NetworkLink) => {
      const o = byLink.get(l.id);
      if (l.apiConfigId && o?.isActive) return Number((o.adjustment as { value: number }).value);
      return l.basePrice === null ? null : Number(l.basePrice);
    };
  }

  private async apply(
    user: AuthUser,
    opId: string,
    changes: PriceChange[],
    dryRun: boolean,
    source: string,
  ) {
    if (!dryRun) {
      await this.prisma.$transaction(async (tx) => {
        for (const c of changes) {
          if (c.method === 'BASE_PRICE') {
            await tx.networkLink.update({ where: { id: c.linkId }, data: { basePrice: c.after } });
            continue;
          }
          const name = `${OVERRIDE_PREFIX}${c.linkId}`;
          const existing = await tx.pricingRule.findFirst({
            where: { operatorProfileId: opId, networkLinkId: c.linkId, name },
          });
          const data = {
            type: 'BASE_OVERRIDE' as const,
            adjustment: { mode: 'OVERRIDE', value: c.after },
            priority: 0,
            isActive: true,
          };
          if (existing) await tx.pricingRule.update({ where: { id: existing.id }, data });
          else
            await tx.pricingRule.create({
              data: { ...data, operatorProfileId: opId, networkLinkId: c.linkId, name },
            });
        }
      });
      await this.ledger.appendSafe({
        eventType: 'LINK_UPDATE',
        status: 'SUCCESS',
        action: `pricing.bulk.${source}`,
        actorUserId: user.sub,
        operatorProfileId: opId,
        entityType: 'NetworkLink',
        requestPayload: { count: changes.length },
        responsePayload: changes.slice(0, 200) as unknown as Prisma.InputJsonValue,
      });
    }
    return { dryRun, count: changes.length, changes };
  }

  @Post('links/bulk-price')
  @Perms('pricing:manage')
  async bulk(@CurrentUser() u: AuthUser, @Body() b: BulkBody) {
    const op = await this.operators.getApproved(u.sub);
    if (
      !['SET', 'PERCENT', 'FIXED'].includes(String(b?.mode)) ||
      typeof b.value !== 'number' ||
      !Number.isFinite(b.value)
    )
      throw new BadRequestException({
        code: 'INVALID_BULK_PRICE',
        message: 'mode SET|PERCENT|FIXED and numeric value required',
      });
    if (b.mode === 'PERCENT' && (b.value < -100 || b.value > 1000))
      throw new BadRequestException({
        code: 'INVALID_BULK_PRICE',
        message: 'percent out of range',
      });
    const ids = Array.isArray(b.linkIds)
      ? b.linkIds.filter((x) => typeof x === 'string').slice(0, MAX_ROWS)
      : [];
    const f = b.filter ?? {};
    if (!ids.length && !f.origin && !f.destination && !f.category)
      throw new BadRequestException({
        code: 'INVALID_BULK_PRICE',
        message: 'select links or a filter',
      });
    const links = await this.prisma.networkLink.findMany({
      where: {
        operatorProfileId: op.id,
        deletedAt: null,
        ...(ids.length && { id: { in: ids } }),
        ...(f.origin && { originName: { equals: f.origin, mode: 'insensitive' } }),
        ...(f.destination && { destinationName: { equals: f.destination, mode: 'insensitive' } }),
        ...(f.category && { category: f.category }),
      },
      take: MAX_ROWS,
    });
    const price = await this.currentPrices(links);
    const changes: PriceChange[] = links.map((l) => {
      const before = price(l);
      const base = before ?? 0;
      const raw =
        b.mode === 'SET'
          ? b.value!
          : b.mode === 'PERCENT'
            ? base * (1 + b.value! / 100)
            : base + b.value!;
      return {
        linkId: l.id,
        externalId: l.externalId,
        route: `${l.originName} - ${l.destinationName}`,
        before,
        after: Math.max(0, Math.round(raw * 100) / 100),
        method: l.apiConfigId ? 'OVERRIDE_RULE' : 'BASE_PRICE',
      };
    });
    return this.apply(u, op.id, changes, b.dryRun === true, 'adjust');
  }

  @Post('links/price-import')
  @Perms('pricing:manage')
  async import(@CurrentUser() u: AuthUser, @Body() b: ImportBody) {
    const op = await this.operators.getApproved(u.sub);
    const rows = Array.isArray(b?.rows) ? b.rows : [];
    if (!rows.length || rows.length > MAX_ROWS)
      throw new BadRequestException({
        code: 'INVALID_PRICE_IMPORT',
        message: `1..${MAX_ROWS} rows required`,
      });
    const links = await this.prisma.networkLink.findMany({
      where: {
        operatorProfileId: op.id,
        deletedAt: null,
        OR: [
          {
            id: { in: rows.map((r) => r.linkId).filter((x): x is string => typeof x === 'string') },
          },
          {
            externalId: {
              in: rows.map((r) => r.externalId).filter((x): x is string => typeof x === 'string'),
            },
          },
        ],
      },
    });
    const price = await this.currentPrices(links);
    const errors: { row: number; reason: string }[] = [];
    const changes: PriceChange[] = [];
    rows.forEach((r, i) => {
      const l = links.find(
        (x) => (r.linkId && x.id === r.linkId) || (r.externalId && x.externalId === r.externalId),
      );
      if (!l) return errors.push({ row: i + 1, reason: 'LINK_NOT_FOUND' });
      if (typeof r.price !== 'number' || !(r.price >= 0) || r.price > 1e12)
        return errors.push({ row: i + 1, reason: 'INVALID_PRICE' });
      changes.push({
        linkId: l.id,
        externalId: l.externalId,
        route: `${l.originName} - ${l.destinationName}`,
        before: price(l),
        after: Math.round(r.price * 100) / 100,
        method: l.apiConfigId ? 'OVERRIDE_RULE' : 'BASE_PRICE',
      });
    });
    // Nothing is written while any row is invalid, so a CSV can be fixed and re-sent as a whole.
    const dryRun = b.dryRun === true || errors.length > 0;
    return { ...(await this.apply(u, op.id, changes, dryRun, 'import')), errors };
  }

  @Get('links/export.csv')
  @Perms('link:write')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="links.csv"')
  async exportCsv(@CurrentUser() u: AuthUser) {
    const op = await this.operators.get(u.sub);
    const links = await this.prisma.networkLink.findMany({
      where: { operatorProfileId: op.id, deletedAt: null },
      orderBy: [{ originName: 'asc' }, { destinationName: 'asc' }],
    });
    const price = await this.currentPrices(links);
    const head = [
      'linkId',
      'externalId',
      'origin',
      'destination',
      'category',
      'status',
      'capacityMbps',
      'currency',
      'managedBy',
      'price',
    ];
    const lines = links.map((l) =>
      [
        l.id,
        l.externalId,
        l.originName,
        l.destinationName,
        l.category,
        l.status,
        l.capacityMbps,
        l.currency,
        l.apiConfigId ? 'API' : 'MANUAL',
        price(l),
      ]
        .map(csvCell)
        .join(','),
    );
    return [head.join(','), ...lines].join('\n');
  }
}
