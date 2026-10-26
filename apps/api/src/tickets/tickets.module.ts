import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NetworkLink, Prisma, TicketKind, TicketSeverity, TicketStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { AuthGuard, AuthUser, CurrentUser } from '../common/auth.guard';

type Tx = Prisma.TransactionClient;
const OPEN_STATES: TicketStatus[] = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'];
const err = (status: number, code: string, message: string) =>
  new HttpException({ code, message }, status);

export interface TicketStats {
  count: number;
  openCount: number;
  buyerOperatorCount: number;
  mttaMin: number | null;
  mttrMin: number | null;
  slaBreachRatePct: number | null;
}

interface CreateDto {
  linkId: string;
  kind: TicketKind;
  severity: TicketSeverity;
  title: string;
  description: string;
  reservationId?: string;
}

@Injectable()
export class TicketsService {
  private readonly log = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  // ---------- helpers ----------
  private async dueDates(severity: TicketSeverity, from: Date) {
    const sla =
      await this.settings.cfg<Record<string, { ackMin: number; resolveMin: number }>>('ticket.sla');
    const s = sla[severity] ?? sla.SEV3;
    return {
      ackDueAt: new Date(from.getTime() + s.ackMin * 60_000),
      resolveDueAt: new Date(from.getTime() + s.resolveMin * 60_000),
    };
  }

  private async nextRef(tx: Tx) {
    const [{ n }] = await tx.$queryRaw<
      { n: number }[]
    >`SELECT nextval(pg_get_serial_sequence('link_tickets','ticketNo'))::int AS n`;
    return {
      ticketNo: n,
      reference: `TKT-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`,
    };
  }

  private async operatorIdOf(userId: string) {
    return (
      (await this.prisma.operatorProfile.findUnique({ where: { userId }, select: { id: true } }))
        ?.id ?? null
    );
  }

  private async scopeWhere(user: AuthUser): Promise<Prisma.LinkTicketWhereInput> {
    if (user.roles.includes('ADMIN')) return {};
    if (user.roles.includes('PENYELENGGARA'))
      return { operatorProfileId: (await this.operatorIdOf(user.sub)) ?? '__none__' };
    return { reporterUserId: user.sub };
  }

  private ledgerTicket(
    tx: Tx,
    t: {
      id: string;
      networkLinkId: string;
      operatorProfileId: string;
      reservationId?: string | null;
    },
    action: string,
    actorUserId: string | null,
    payload: object,
    message?: string,
  ) {
    return this.ledger.append(
      {
        eventType: 'TICKET',
        status: 'SUCCESS',
        action,
        actorUserId,
        operatorProfileId: t.operatorProfileId,
        networkLinkId: t.networkLinkId,
        reservationId: t.reservationId,
        entityType: 'LinkTicket',
        entityId: t.id,
        requestPayload: payload,
        message,
      },
      tx,
    );
  }

  // ---------- creation ----------
  async create(user: AuthUser, dto: CreateDto) {
    const isStaff = user.roles.includes('PENYELENGGARA') || user.roles.includes('ADMIN');
    if (!user.perms.includes('ticket:create') && !user.perms.includes('ticket:manage'))
      throw new ForbiddenException();
    if (
      typeof dto.title !== 'string' ||
      typeof dto.description !== 'string' ||
      dto.title.trim().length < 3 ||
      dto.title.length > 160 ||
      dto.description.trim().length < 10 ||
      dto.description.length > 4000
    ) {
      throw err(400, 'INVALID_TICKET', 'title (3-160) and description (10-4000) are required');
    }
    if (
      !['DEGRADATION', 'OUTAGE', 'OTHER'].includes(dto.kind) ||
      !['SEV1', 'SEV2', 'SEV3'].includes(dto.severity)
    ) {
      throw err(400, 'INVALID_TICKET', 'invalid kind or severity');
    }
    if (typeof dto.linkId !== 'string') throw new NotFoundException();
    const link = await this.prisma.networkLink.findFirst({
      where: { id: dto.linkId, deletedAt: null },
    });
    if (!link) throw new NotFoundException();

    let source: 'BUYER' | 'OPERATOR' = 'BUYER';
    let reservationId: string | undefined;
    if (isStaff) {
      const opId = await this.operatorIdOf(user.sub);
      if (!user.roles.includes('ADMIN') && opId !== link.operatorProfileId)
        throw new NotFoundException();
      source = 'OPERATOR';
    } else {
      const rented = await this.prisma.reservationItem.findFirst({
        where: {
          networkLinkId: link.id,
          reservation: { buyerUserId: user.sub, status: { in: ['PAID', 'CONFIRMED'] } },
        },
        select: { reservationId: true },
      });
      if (!rented)
        throw err(403, 'TICKET_NOT_RENTER', 'Only customers of this link can open a ticket');
      reservationId = rented.reservationId;
    }

    const now = new Date();
    const due = await this.dueDates(dto.severity, now);
    const maxOpen = await this.settings.cfg<number>('ticket.maxOpenPerUserPerLink');
    return this.prisma.$transaction(async (tx) => {
      if (source === 'BUYER') {
        // Serialise per (user, link) so parallel requests cannot exceed the open-ticket cap.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ticket:${user.sub}:${link.id}`}))`;
        const open = await tx.linkTicket.count({
          where: { networkLinkId: link.id, reporterUserId: user.sub, status: { in: OPEN_STATES } },
        });
        if (open >= maxOpen)
          throw err(409, 'TICKET_DUPLICATE', 'Too many open tickets for this link');
      }
      const ref = await this.nextRef(tx);
      const t = await tx.linkTicket.create({
        data: {
          ...ref,
          networkLinkId: link.id,
          operatorProfileId: link.operatorProfileId,
          reporterUserId: user.sub,
          reservationId,
          source,
          kind: dto.kind,
          severity: dto.severity,
          title: dto.title.trim(),
          description: dto.description.trim(),
          createdAt: now,
          ...due,
        },
      });
      await tx.linkTicketUpdate.create({
        data: {
          ticketId: t.id,
          actorUserId: user.sub,
          type: 'CREATED',
          toStatus: 'OPEN',
          message: dto.title.trim(),
        },
      });
      await this.ledgerTicket(tx, t, 'ticket.created', user.sub, {
        kind: t.kind,
        severity: t.severity,
        source,
      });
      return t;
    });
  }

  // SYSTEM tickets are opened by the incident detector; the partial unique index guarantees one open per link.
  async createSystem(
    link: Pick<NetworkLink, 'id' | 'operatorProfileId' | 'originName' | 'destinationName'>,
    kind: 'OUTAGE' | 'DEGRADATION',
    incidentStartAt: Date,
    detail: string,
  ) {
    const map = await this.settings.cfg<Record<string, TicketSeverity>>('ticket.severityMap');
    const severity = map[kind] ?? 'SEV2';
    const now = new Date();
    const due = await this.dueDates(severity, now);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ref = await this.nextRef(tx);
        const t = await tx.linkTicket.create({
          data: {
            ...ref,
            networkLinkId: link.id,
            operatorProfileId: link.operatorProfileId,
            source: 'SYSTEM',
            kind,
            severity,
            title: `${kind === 'OUTAGE' ? 'Outage' : 'Degradation'} detected: ${link.originName} - ${link.destinationName}`,
            description: detail,
            incidentStartAt,
            createdAt: now,
            ...due,
          },
        });
        await tx.linkTicketUpdate.create({
          data: { ticketId: t.id, type: 'CREATED', toStatus: 'OPEN', message: detail },
        });
        await this.ledgerTicket(tx, t, 'ticket.created', null, {
          kind,
          severity,
          source: 'SYSTEM',
        });
        return t;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return null; // another worker won the race
      throw e;
    }
  }

  async escalateSystem(ticketId: string, incidentStartAt: Date) {
    const map = await this.settings.cfg<Record<string, TicketSeverity>>('ticket.severityMap');
    const severity = map.OUTAGE ?? 'SEV1';
    const t = await this.prisma.linkTicket.findUniqueOrThrow({ where: { id: ticketId } });
    const due = await this.dueDates(severity, t.createdAt);
    await this.prisma.$transaction(async (tx) => {
      await tx.linkTicket.update({
        where: { id: t.id },
        data: { kind: 'OUTAGE', severity, incidentStartAt, ...due },
      });
      await tx.linkTicketUpdate.create({
        data: { ticketId: t.id, type: 'ESCALATED', message: 'Degradation escalated to outage' },
      });
      await this.ledgerTicket(tx, t, 'ticket.escalated', null, { to: 'OUTAGE', severity });
    });
  }

  async reopenSystem(ticketId: string) {
    const t = await this.prisma.linkTicket.findUniqueOrThrow({ where: { id: ticketId } });
    try {
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.linkTicket.updateMany({
          where: { id: t.id, status: 'RESOLVED' },
          data: {
            status: 'OPEN',
            resolvedAt: null,
            incidentEndAt: null,
            flapCount: { increment: 1 },
          },
        });
        if (!res.count) return;
        await tx.linkTicketUpdate.create({
          data: {
            ticketId: t.id,
            type: 'STATUS_CHANGE',
            fromStatus: 'RESOLVED',
            toStatus: 'OPEN',
            message: 'Incident recurred (flap)',
          },
        });
        await this.ledgerTicket(tx, t, 'ticket.reopened', null, { reason: 'flap' });
      });
    } catch (e) {
      // Another system ticket is already open for this link (partial unique index).
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
  }

  async autoResolveSystem(ticketId: string, at: Date) {
    const t = await this.prisma.linkTicket.findUniqueOrThrow({ where: { id: ticketId } });
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.linkTicket.updateMany({
        where: { id: t.id, status: { in: OPEN_STATES } },
        data: {
          status: 'RESOLVED',
          resolvedAt: at,
          incidentEndAt: at,
          ackAt: t.ackAt ?? at,
          ...(at > t.resolveDueAt && !t.resolveBreachedAt ? { resolveBreachedAt: at } : {}),
        },
      });
      if (!res.count) return;
      await tx.linkTicketUpdate.create({
        data: {
          ticketId: t.id,
          type: 'STATUS_CHANGE',
          fromStatus: t.status,
          toStatus: 'RESOLVED',
          message: 'Recovered automatically',
        },
      });
      await this.ledgerTicket(tx, t, 'ticket.auto_resolved', null, { from: t.status });
    });
  }

  // ---------- reads ----------
  private async scoped(user: AuthUser, id: string) {
    const t = await this.prisma.linkTicket.findFirst({
      where: { id, ...(await this.scopeWhere(user)) },
      include: {
        networkLink: { select: { id: true, name: true, originName: true, destinationName: true } },
        operatorProfile: { select: { displayName: true } },
      },
    });
    if (!t) throw new NotFoundException();
    return t;
  }

  async list(
    user: AuthUser,
    q: {
      status?: string;
      linkId?: string;
      kind?: string;
      source?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(q.pageSize) || 20));
    const ENUMS = {
      status: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
      kind: ['DEGRADATION', 'OUTAGE', 'OTHER'],
      source: ['BUYER', 'OPERATOR', 'SYSTEM'],
    } as const;
    for (const k of ['status', 'kind', 'source'] as const) {
      const v = q[k];
      if (v !== undefined && v !== '' && !(ENUMS[k] as readonly string[]).includes(v)) {
        throw err(400, 'INVALID_FILTER', `invalid ${k}`);
      }
    }
    const where: Prisma.LinkTicketWhereInput = {
      ...(await this.scopeWhere(user)),
      ...(q.status && { status: q.status as TicketStatus }),
      ...(q.linkId && { networkLinkId: String(q.linkId) }),
      ...(q.kind && { kind: q.kind as TicketKind }),
      ...(q.source && { source: q.source as 'BUYER' }),
    };
    const [total, items] = await Promise.all([
      this.prisma.linkTicket.count({ where }),
      this.prisma.linkTicket.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          networkLink: {
            select: { id: true, name: true, originName: true, destinationName: true },
          },
          operatorProfile: { select: { displayName: true } },
        },
      }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(user: AuthUser, id: string) {
    const t = await this.scoped(user, id);
    const staff = user.roles.includes('ADMIN') || user.roles.includes('PENYELENGGARA');
    const updates = await this.prisma.linkTicketUpdate.findMany({
      where: { ticketId: id, ...(staff ? {} : { isInternal: false }) },
      orderBy: { createdAt: 'asc' },
      include: {
        actor: {
          select: { fullName: true, roles: { select: { role: { select: { key: true } } } } },
        },
      },
    });
    return {
      ...t,
      updates: updates.map((u) => ({
        id: u.id,
        at: u.createdAt,
        type: u.type,
        fromStatus: u.fromStatus,
        toStatus: u.toStatus,
        message: u.message,
        isInternal: u.isInternal,
        isPublicReply: u.isPublicReply,
        actor: u.actor
          ? { name: u.actor.fullName, role: u.actor.roles[0]?.role.key }
          : { name: 'System', role: 'SYSTEM' },
      })),
    };
  }

  // ---------- mutations ----------
  async addUpdate(
    user: AuthUser,
    id: string,
    b: { message: string; isInternal?: boolean; isPublicReply?: boolean },
  ) {
    const t = await this.scoped(user, id);
    if (typeof b?.message !== 'string' || !b.message.trim() || b.message.length > 2000)
      throw err(400, 'INVALID_MESSAGE', 'message (<=2000) required');
    if (b.isInternal && b.isPublicReply)
      throw err(400, 'INVALID_MESSAGE', 'a note cannot be both internal and public');
    if (t.status === 'CLOSED') throw err(409, 'TICKET_STATE_CONFLICT', 'Ticket is closed');
    const isStaff =
      user.roles.includes('ADMIN') ||
      (user.roles.includes('PENYELENGGARA') &&
        (await this.operatorIdOf(user.sub)) === t.operatorProfileId);
    if ((b.isInternal || b.isPublicReply) && !isStaff) throw new ForbiddenException();
    return this.prisma
      .$transaction(async (tx) => {
        const u = await tx.linkTicketUpdate.create({
          data: {
            ticketId: id,
            actorUserId: user.sub,
            type: b.isPublicReply ? 'PUBLIC_REPLY' : 'COMMENT',
            message: b.message.trim(),
            isInternal: !!b.isInternal,
            isPublicReply: !!b.isPublicReply,
          },
        });
        if (b.isPublicReply) {
          await tx.linkTicket.update({
            where: { id },
            data: {
              publicReply: {
                text: b.message.trim(),
                at: new Date().toISOString(),
                byUserId: user.sub,
              },
            },
          });
        }
        await this.ledgerTicket(
          tx,
          t,
          b.isPublicReply ? 'ticket.reply' : 'ticket.comment',
          user.sub,
          { internal: !!b.isInternal },
        );
        return u;
      })
      .catch((e) => {
        if ((e as { code?: string }).code === 'P2002')
          throw err(409, 'REPLY_EXISTS', 'A public reply already exists');
        throw e;
      });
  }

  async transition(user: AuthUser, id: string, to: TicketStatus, note?: string) {
    const t = await this.scoped(user, id);
    const matrix = await this.settings.cfg<Record<string, string[]>>('ticket.transitions');
    if (!(matrix[t.status] ?? []).includes(to))
      throw err(409, 'TICKET_STATE_CONFLICT', `Cannot move ${t.status} to ${to}`);

    const isAdmin = user.roles.includes('ADMIN');
    const isStaff =
      isAdmin ||
      (user.roles.includes('PENYELENGGARA') &&
        (await this.operatorIdOf(user.sub)) === t.operatorProfileId);
    const isReporter = t.reporterUserId === user.sub;
    const allowed =
      to === 'CLOSED' ? isReporter || isAdmin : to === 'OPEN' ? isReporter || isStaff : isStaff;
    if (!allowed) throw err(403, 'TICKET_FORBIDDEN', 'Your role cannot perform this transition');

    const now = new Date();
    const data: Prisma.LinkTicketUpdateInput = { status: to };
    if (to === 'ACKNOWLEDGED' || (to === 'RESOLVED' && !t.ackAt)) {
      // The first acknowledgement is kept so MTTA is not skewed by reopen cycles.
      if (!t.ackAt) data.ackAt = now;
      if (!t.ackAt && now > t.ackDueAt && !t.ackBreachedAt) data.ackBreachedAt = now;
    }
    if (to === 'RESOLVED') {
      data.resolvedAt = now;
      if (t.source === 'SYSTEM') data.incidentEndAt = now;
      if (now > t.resolveDueAt && !t.resolveBreachedAt) data.resolveBreachedAt = now;
    }
    if (to === 'CLOSED') data.closedAt = now;
    if (to === 'OPEN') {
      // Reopening restarts the resolution clock instead of inheriting an expired deadline.
      const due = await this.dueDates(t.severity, now);
      data.resolvedAt = null;
      data.resolveDueAt = due.resolveDueAt;
      data.resolveBreachedAt = null;
      if (t.source === 'SYSTEM') data.incidentEndAt = null;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const res = await tx.linkTicket.updateMany({
          where: { id, status: t.status },
          data: data as Prisma.LinkTicketUpdateManyMutationInput,
        });
        if (!res.count) throw err(409, 'TICKET_STATE_CONFLICT', 'Ticket changed concurrently');
        await tx.linkTicketUpdate.create({
          data: {
            ticketId: id,
            actorUserId: user.sub,
            type: 'STATUS_CHANGE',
            fromStatus: t.status,
            toStatus: to,
            message: note?.trim() || null,
          },
        });
        await this.ledgerTicket(
          tx,
          t,
          `ticket.${to === 'OPEN' ? 'reopened' : to.toLowerCase()}`,
          user.sub,
          { from: t.status, to },
        );
        return tx.linkTicket.findUniqueOrThrow({ where: { id } });
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw err(
          409,
          'TICKET_STATE_CONFLICT',
          'Another incident ticket is already open for this link',
        );
      throw e;
    }
  }

  // ---------- KPIs ----------
  async stats(linkIds: string[], days: number): Promise<Map<string, TicketStats>> {
    const includeDemo = await this.settings.cfg<boolean>('demo.countInMetrics');
    const since = new Date(Date.now() - days * 86400_000);
    const rows = await this.prisma.linkTicket.findMany({
      where: {
        networkLinkId: { in: linkIds },
        createdAt: { gte: since },
        ...(includeDemo ? {} : { isDemo: false }),
      },
      select: {
        networkLinkId: true,
        source: true,
        status: true,
        createdAt: true,
        ackAt: true,
        resolvedAt: true,
        ackBreachedAt: true,
        resolveBreachedAt: true,
        resolveDueAt: true,
      },
    });
    const now = Date.now();
    const out = new Map<string, TicketStats>();
    for (const id of linkIds) {
      const mine = rows.filter((r) => r.networkLinkId === id);
      const acked = mine.filter((r) => r.ackAt);
      const resolved = mine.filter((r) => r.resolvedAt);
      const judged = mine.filter((r) => r.resolvedAt || r.resolveDueAt.getTime() < now);
      const avg = (xs: number[]) =>
        xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60_000) : null;
      out.set(id, {
        count: mine.length,
        openCount: mine.filter((r) => OPEN_STATES.includes(r.status)).length,
        buyerOperatorCount: mine.filter((r) => r.source !== 'SYSTEM').length,
        mttaMin: avg(acked.map((r) => r.ackAt!.getTime() - r.createdAt.getTime())),
        mttrMin: avg(resolved.map((r) => r.resolvedAt!.getTime() - r.createdAt.getTime())),
        slaBreachRatePct: judged.length
          ? Math.round(
              (judged.filter((r) => r.ackBreachedAt || r.resolveBreachedAt).length /
                judged.length) *
                100,
            )
          : null,
      });
    }
    return out;
  }

  async summary(user: AuthUser, linkId: string, days: number) {
    const link = await this.prisma.networkLink.findFirst({
      where: { id: linkId, deletedAt: null },
      select: { operatorProfile: { select: { userId: true } } },
    });
    if (!link) throw new NotFoundException();
    // A competing operator must not read a rival's ticket KPIs.
    if (user.roles.includes('PENYELENGGARA') && link.operatorProfile.userId !== user.sub) {
      throw new NotFoundException();
    }
    const min = await this.settings.cfg<number>('ticket.minForRates');
    const s = (await this.stats([linkId], days)).get(linkId)!;
    const enough = s.count >= min;
    const kinds = await this.prisma.linkTicket.groupBy({
      by: ['kind'],
      where: { networkLinkId: linkId, createdAt: { gte: new Date(Date.now() - days * 86400_000) } },
      _count: true,
    });
    return {
      periodDays: days,
      count: s.count,
      openCount: s.openCount,
      byKind: Object.fromEntries(kinds.map((k) => [k.kind, k._count])),
      mttaMin: enough ? s.mttaMin : null,
      mttrMin: enough ? s.mttrMin : null,
      slaBreachRatePct: enough ? s.slaBreachRatePct : null,
      minForRates: min,
    };
  }

  // ---------- sweeper ----------
  @Interval(60_000)
  async sweep() {
    try {
      const now = new Date();
      const ackLate = await this.prisma.linkTicket.findMany({
        where: { status: 'OPEN', ackAt: null, ackBreachedAt: null, ackDueAt: { lt: now } },
        take: 100,
      });
      for (const t of ackLate) await this.markBreach(t, 'ack');
      const resolveLate = await this.prisma.linkTicket.findMany({
        where: { status: { in: OPEN_STATES }, resolveBreachedAt: null, resolveDueAt: { lt: now } },
        take: 100,
      });
      for (const t of resolveLate) await this.markBreach(t, 'resolve');

      const hours = await this.settings.cfg<number>('ticket.autoCloseHours');
      const stale = await this.prisma.linkTicket.findMany({
        where: { status: 'RESOLVED', resolvedAt: { lt: new Date(Date.now() - hours * 3600_000) } },
        take: 100,
      });
      for (const t of stale) {
        await this.prisma.$transaction(async (tx) => {
          const res = await tx.linkTicket.updateMany({
            where: { id: t.id, status: 'RESOLVED' },
            data: { status: 'CLOSED', closedAt: now },
          });
          if (!res.count) return;
          await tx.linkTicketUpdate.create({
            data: {
              ticketId: t.id,
              type: 'STATUS_CHANGE',
              fromStatus: 'RESOLVED',
              toStatus: 'CLOSED',
              message: 'Auto-closed',
            },
          });
          await this.ledgerTicket(tx, t, 'ticket.closed', null, { auto: true });
        });
      }
    } catch (e) {
      this.log.warn(`ticket sweep failed: ${(e as Error).message}`);
    }
  }

  private async markBreach(
    t: {
      id: string;
      networkLinkId: string;
      operatorProfileId: string;
      reservationId: string | null;
    },
    kind: 'ack' | 'resolve',
  ) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.linkTicket.updateMany({
        where: {
          id: t.id,
          ...(kind === 'ack' ? { ackBreachedAt: null } : { resolveBreachedAt: null }),
        },
        data: kind === 'ack' ? { ackBreachedAt: new Date() } : { resolveBreachedAt: new Date() },
      });
      if (!res.count) return;
      await tx.linkTicketUpdate.create({
        data: { ticketId: t.id, type: 'SLA_BREACH', message: `${kind} SLA breached` },
      });
      await this.ledgerTicket(tx, t, 'ticket.sla.breached', null, { kind });
    });
  }
}

@Controller()
@UseGuards(AuthGuard)
export class TicketsController {
  constructor(private readonly svc: TicketsService) {}

  @Post('tickets')
  create(@CurrentUser() u: AuthUser, @Body() b: CreateDto) {
    return this.svc.create(u, b);
  }

  @Get('tickets')
  list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.svc.list(u, q);
  }

  @Get('tickets/:id')
  one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.get(u, id);
  }

  @Post('tickets/:id/updates')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: { message: string; isInternal?: boolean; isPublicReply?: boolean },
  ) {
    return this.svc.addUpdate(u, id, b);
  }

  @Post('tickets/:id/transition')
  transition(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: { to: TicketStatus; note?: string },
  ) {
    return this.svc.transition(u, id, b.to, b.note);
  }

  @Get('links/:id/tickets/summary')
  summary(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('days') days?: string) {
    return this.svc.summary(u, id, Math.min(180, Math.max(1, Number(days) || 30)));
  }
}

@Module({
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
