import { Injectable } from '@nestjs/common';
import { LedgerEventType, LedgerStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from './prisma.service';

export interface LedgerInput {
  eventType: LedgerEventType;
  status: LedgerStatus;
  action: string;
  actorUserId?: string | null;
  operatorProfileId?: string | null;
  networkLinkId?: string | null;
  reservationId?: string | null;
  paymentId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  amount?: Prisma.Decimal | number | string | null;
  currency?: string | null;
  externalRef?: string | null;
  requestPayload?: unknown;
  responsePayload?: unknown;
  message?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const SECRET_KEY = /token|secret|password|authorization|api[-_]?key|credential|signature/i;
const LEDGER_LOCK_ID = 727001;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? '[REDACTED]' : redact(v),
      ]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function ledgerHash(
  prevHash: string | null,
  row: {
    eventType: string;
    status: string;
    action: string;
    actorUserId: string | null;
    operatorProfileId: string | null;
    networkLinkId: string | null;
    reservationId: string | null;
    paymentId: string | null;
    entityType: string | null;
    entityId: string | null;
    amount: Prisma.Decimal | null;
    currency: string | null;
    externalRef: string | null;
    requestPayload: unknown;
    responsePayload: unknown;
    message: string | null;
    createdAt: Date;
  },
): string {
  const body = canonicalJson({
    ...row,
    amount: row.amount === null ? null : new Prisma.Decimal(row.amount).toFixed(2),
    createdAt: row.createdAt.toISOString(),
  });
  return createHash('sha256')
    .update(prevHash ?? '')
    .update(body)
    .digest('hex');
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  // Serialised through an advisory lock so the hash chain has no forks.
  async append(input: LedgerInput, tx?: Prisma.TransactionClient) {
    const run = async (client: Prisma.TransactionClient) => {
      await client.$executeRaw`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_ID})`;
      const last = await client.transactionLog.findFirst({
        orderBy: { sequence: 'desc' },
        select: { hash: true },
      });
      const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
      const data = {
        eventType: input.eventType,
        status: input.status,
        action: input.action,
        actorUserId: input.actorUserId ?? null,
        operatorProfileId: input.operatorProfileId ?? null,
        networkLinkId: input.networkLinkId ?? null,
        reservationId: input.reservationId ?? null,
        paymentId: input.paymentId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        amount:
          input.amount === undefined || input.amount === null
            ? null
            : new Prisma.Decimal(input.amount).toDecimalPlaces(2),
        currency: input.currency ?? null,
        externalRef: input.externalRef ?? null,
        requestPayload: (input.requestPayload === undefined
          ? null
          : JSON.parse(JSON.stringify(redact(input.requestPayload)))) as unknown,
        responsePayload: (input.responsePayload === undefined
          ? null
          : JSON.parse(JSON.stringify(redact(input.responsePayload)))) as unknown,
        message: input.message ?? null,
        createdAt,
      };
      const prevHash = last?.hash ?? null;
      const hash = ledgerHash(prevHash, data);
      return client.transactionLog.create({
        data: {
          ...data,
          requestPayload:
            data.requestPayload === null ? Prisma.JsonNull : (data.requestPayload as object),
          responsePayload:
            data.responsePayload === null ? Prisma.JsonNull : (data.responsePayload as object),
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          prevHash,
          hash,
        },
      });
    };
    if (tx) return run(tx);
    return this.prisma.$transaction(run, { timeout: 15000 });
  }

  // Never lets an audit failure break the main flow for non-financial events.
  async appendSafe(input: LedgerInput) {
    try {
      return await this.append(input);
    } catch (err) {
      console.error('[ledger] append failed', err);
      return null;
    }
  }

  async verifyChain(limit = 5000) {
    const rows = await this.prisma.transactionLog.findMany({
      orderBy: { sequence: 'asc' },
      take: limit,
    });
    let prev: string | null = null;
    for (const r of rows) {
      const expected = ledgerHash(prev, {
        eventType: r.eventType,
        status: r.status,
        action: r.action,
        actorUserId: r.actorUserId,
        operatorProfileId: r.operatorProfileId,
        networkLinkId: r.networkLinkId,
        reservationId: r.reservationId,
        paymentId: r.paymentId,
        entityType: r.entityType,
        entityId: r.entityId,
        amount: r.amount,
        currency: r.currency,
        externalRef: r.externalRef,
        requestPayload: r.requestPayload,
        responsePayload: r.responsePayload,
        message: r.message,
        createdAt: r.createdAt,
      });
      if (r.prevHash !== prev || r.hash !== expected) {
        return { valid: false, checked: rows.length, brokenAtSequence: Number(r.sequence) };
      }
      prev = r.hash;
    }
    return { valid: true, checked: rows.length, brokenAtSequence: null };
  }
}
