import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LinkRequestStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { OperatorContext } from '../common/operator-context.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';
import { NotificationsModule, NotificationsService } from '../notifications/notifications.module';

const STATUSES: LinkRequestStatus[] = ['OPEN', 'IN_PROGRESS', 'FULFILLED', 'CLOSED'];

interface RequestBody {
  originName?: string;
  destinationName?: string;
  capacityMbps?: number;
  category?: string;
  termMonths?: number;
  budgetMonthly?: number;
  neededBy?: string;
  notes?: string;
}

interface ResponseBody {
  message?: string;
  proposedPrice?: number;
  etaDate?: string;
}

@Injectable()
export class LinkRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly operators: OperatorContext,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthUser, q: { status?: string; city?: string; mine?: string; sort?: string }) {
    const isOperator = user.roles.includes('PENYELENGGARA');
    const isAdmin = user.roles.includes('ADMIN');
    const op = isOperator
      ? await this.prisma.operatorProfile.findUnique({ where: { userId: user.sub } })
      : null;
    const status = STATUSES.includes(q.status as LinkRequestStatus)
      ? (q.status as LinkRequestStatus)
      : undefined;
    const rows = await this.prisma.linkRequest.findMany({
      where: {
        ...(status ? { status } : { status: { in: ['OPEN', 'IN_PROGRESS'] } }),
        ...(q.mine === 'true' && { requesterUserId: user.sub }),
        ...(q.city && {
          OR: [
            { originName: { equals: q.city, mode: 'insensitive' } },
            { destinationName: { equals: q.city, mode: 'insensitive' } },
          ],
        }),
      },
      include: {
        requester: { select: { buyerProfile: { select: { companyName: true } } } },
        votes: { select: { userId: true } },
        responses: {
          include: { operatorProfile: { select: { id: true, displayName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        products: {
          where: { deletedAt: null, status: { not: 'CANCELLED' } },
          select: { id: true, name: true, status: true, progressPct: true, targetReadyDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const hot = await this.settings.cfg<number>('linkRequest.minVotesHot');
    const items = rows.map((r) => {
      const mine = r.requesterUserId === user.sub;
      const seeAll = mine || isAdmin;
      const { requester, votes, responses, budgetMonthly, ...rest } = r;
      return {
        ...rest,
        // Budgets and company names are shared with providers (to quote) but not with other buyers.
        budgetMonthly:
          seeAll || isOperator ? (budgetMonthly === null ? null : Number(budgetMonthly)) : null,
        requesterCompany:
          seeAll || isOperator ? (requester.buyerProfile?.companyName ?? null) : null,
        isMine: mine,
        votes: votes.length + 1,
        hasVoted: votes.some((v) => v.userId === user.sub),
        hot: votes.length + 1 >= hot,
        responseCount: responses.length,
        responses: responses
          .filter((x) => seeAll || (op && x.operatorProfileId === op.id))
          .map((x) => ({
            ...x,
            proposedPrice: x.proposedPrice === null ? null : Number(x.proposedPrice),
          })),
      };
    });
    if (q.sort === 'votes') items.sort((a, b) => b.votes - a.votes);
    return items;
  }

  async create(user: AuthUser, b: RequestBody) {
    const text = (v: unknown, max: number) =>
      typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
    const posInt = (v: unknown, max: number) =>
      Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;
    if (
      !text(b.originName, 120) ||
      !text(b.destinationName, 120) ||
      b.originName!.trim().toLowerCase() === b.destinationName!.trim().toLowerCase() ||
      !posInt(b.capacityMbps, 1e7) ||
      (b.termMonths !== undefined && !posInt(b.termMonths, 240)) ||
      (b.category !== undefined && !text(b.category, 64)) ||
      (b.notes !== undefined && (typeof b.notes !== 'string' || b.notes.length > 2000)) ||
      (b.budgetMonthly !== undefined &&
        !(typeof b.budgetMonthly === 'number' && b.budgetMonthly > 0 && b.budgetMonthly <= 1e13)) ||
      (b.neededBy !== undefined && Number.isNaN(Date.parse(b.neededBy)))
    )
      throw new BadRequestException({ code: 'INVALID_LINK_REQUEST', message: 'invalid field' });
    const max = await this.settings.cfg<number>('linkRequest.maxOpenPerUser');
    const open = await this.prisma.linkRequest.count({
      where: { requesterUserId: user.sub, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    });
    if (open >= max)
      throw new HttpException(
        { code: 'LINK_REQUEST_LIMIT', message: `max ${max} open requests` },
        429,
      );
    const names = [b.originName!.trim(), b.destinationName!.trim()];
    const locs = await this.prisma.referenceLocation.findMany({
      where: { name: { in: names, mode: 'insensitive' } },
    });
    const loc = (n: string) => locs.find((l) => l.name.toLowerCase() === n.toLowerCase());
    const [a, z] = names.map(loc);
    const row = await this.prisma.linkRequest.create({
      data: {
        reference: `REQ-${new Date().getUTCFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`,
        requesterUserId: user.sub,
        originName: a?.name ?? names[0],
        originLat: a?.lat,
        originLng: a?.lng,
        destinationName: z?.name ?? names[1],
        destinationLat: z?.lat,
        destinationLng: z?.lng,
        capacityMbps: b.capacityMbps!,
        category: b.category?.trim().toUpperCase(),
        termMonths: b.termMonths,
        budgetMonthly: b.budgetMonthly,
        neededBy: b.neededBy ? new Date(b.neededBy) : undefined,
        notes: b.notes?.trim() || undefined,
      },
    });
    await this.ledger.appendSafe({
      eventType: 'LINK_REQUEST',
      status: 'SUCCESS',
      action: 'link-request.created',
      actorUserId: user.sub,
      entityType: 'LinkRequest',
      entityId: row.id,
    });
    const route = `${row.originName} - ${row.destinationName}`;
    await this.notifications.notify({
      userIds: await this.notifications.audience('PENYELENGGARA'),
      category: 'LINK_REQUEST',
      title: { id: `Permintaan link baru: ${route}`, en: `New link request: ${route}` },
      body: {
        id: `${row.capacityMbps} Mbps dibutuhkan pelanggan`,
        en: `${row.capacityMbps} Mbps wanted by a customer`,
      },
      href: `/requests#${row.id}`,
      entityType: 'LinkRequest',
      entityId: row.id,
      dedupeKey: `request:${row.id}`,
      match: { cities: [row.originName, row.destinationName] },
    });
    return row;
  }

  async vote(user: AuthUser, id: string) {
    const r = await this.prisma.linkRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.requesterUserId === user.sub)
      throw new BadRequestException({ code: 'OWN_REQUEST', message: 'cannot vote own request' });
    const existing = await this.prisma.linkRequestVote.findUnique({
      where: { requestId_userId: { requestId: id, userId: user.sub } },
    });
    if (existing)
      await this.prisma.linkRequestVote.delete({
        where: { requestId_userId: { requestId: id, userId: user.sub } },
      });
    else
      await this.prisma.linkRequestVote
        .create({ data: { requestId: id, userId: user.sub } })
        .catch((e) => {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        });
    const votes = await this.prisma.linkRequestVote.count({ where: { requestId: id } });
    return { voted: !existing, votes: votes + 1 };
  }

  async setStatus(user: AuthUser, id: string, status: unknown) {
    if (!STATUSES.includes(status as LinkRequestStatus))
      throw new BadRequestException({ code: 'INVALID_STATUS', message: 'invalid status' });
    const res = await this.prisma.linkRequest.updateMany({
      where: { id, ...(user.roles.includes('ADMIN') ? {} : { requesterUserId: user.sub }) },
      data: { status: status as LinkRequestStatus },
    });
    if (!res.count) throw new NotFoundException();
    await this.ledger.appendSafe({
      eventType: 'LINK_REQUEST',
      status: 'SUCCESS',
      action: 'link-request.status',
      actorUserId: user.sub,
      entityType: 'LinkRequest',
      entityId: id,
      requestPayload: { status },
    });
    return this.prisma.linkRequest.findUnique({ where: { id } });
  }

  async respond(user: AuthUser, id: string, b: ResponseBody) {
    const op = await this.operators.getApproved(user.sub);
    if (
      typeof b?.message !== 'string' ||
      !b.message.trim() ||
      b.message.length > 2000 ||
      (b.proposedPrice !== undefined &&
        !(
          typeof b.proposedPrice === 'number' &&
          b.proposedPrice >= 0 &&
          b.proposedPrice <= 1e13
        )) ||
      (b.etaDate !== undefined && Number.isNaN(Date.parse(b.etaDate)))
    )
      throw new BadRequestException({ code: 'INVALID_RESPONSE', message: 'invalid field' });
    const r = await this.prisma.linkRequest.findUnique({
      where: { id },
      include: { votes: { select: { userId: true } } },
    });
    if (!r) throw new NotFoundException();
    if (r.status === 'CLOSED' || r.status === 'FULFILLED')
      throw new ForbiddenException({ code: 'REQUEST_CLOSED', message: 'request is closed' });
    const data = {
      message: b.message.trim(),
      proposedPrice: b.proposedPrice ?? null,
      etaDate: b.etaDate ? new Date(b.etaDate) : null,
    };
    const row = await this.prisma.linkRequestResponse.upsert({
      where: { requestId_operatorProfileId: { requestId: id, operatorProfileId: op.id } },
      create: { ...data, requestId: id, operatorProfileId: op.id },
      update: data,
    });
    if (r.status === 'OPEN')
      await this.prisma.linkRequest.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
    await this.ledger.appendSafe({
      eventType: 'LINK_REQUEST',
      status: 'SUCCESS',
      action: 'link-request.responded',
      actorUserId: user.sub,
      operatorProfileId: op.id,
      entityType: 'LinkRequest',
      entityId: id,
    });
    const route = `${r.originName} - ${r.destinationName}`;
    await this.notifications.notify({
      userIds: [r.requesterUserId, ...r.votes.map((v) => v.userId)],
      category: 'LINK_REQUEST',
      title: {
        id: `${op.displayName} menanggapi permintaan ${route}`,
        en: `${op.displayName} responded to the ${route} request`,
      },
      body: { id: data.message, en: data.message },
      href: `/requests#${id}`,
      entityType: 'LinkRequest',
      entityId: id,
      dedupeKey: `request-response:${row.id}:${row.updatedAt.getTime()}`,
    });
    return { ...row, proposedPrice: row.proposedPrice === null ? null : Number(row.proposedPrice) };
  }
}

@Controller('link-requests')
@UseGuards(AuthGuard)
export class LinkRequestsController {
  constructor(private readonly svc: LinkRequestsService) {}

  @Get()
  @Perms('link:read')
  list(
    @CurrentUser() u: AuthUser,
    @Query() q: { status?: string; city?: string; mine?: string; sort?: string },
  ) {
    return this.svc.list(u, q);
  }

  @Post()
  @Perms('request:create')
  create(@CurrentUser() u: AuthUser, @Body() b: RequestBody) {
    return this.svc.create(u, b ?? {});
  }

  @Post(':id/vote')
  @Perms('request:create')
  vote(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.vote(u, id);
  }

  @Patch(':id')
  @Perms('request:create')
  status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { status?: string }) {
    return this.svc.setStatus(u, id, b?.status);
  }

  @Post(':id/responses')
  @Perms('request:respond')
  respond(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: ResponseBody) {
    return this.svc.respond(u, id, b);
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [LinkRequestsController],
  providers: [LinkRequestsService],
})
export class LinkRequestsModule {}
