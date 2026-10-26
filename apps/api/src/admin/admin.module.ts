import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LedgerEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { AuthGuard, AuthUser, CurrentUser, Roles } from '../common/auth.guard';

@Controller('admin')
@UseGuards(AuthGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  @Get('overview')
  async overview() {
    const [
      users,
      operators,
      pendingOperators,
      links,
      reservations,
      paid,
      ledgerEntries,
      syncFailures,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.operatorProfile.count({ where: { approvalStatus: 'APPROVED' } }),
      this.prisma.operatorProfile.count({ where: { approvalStatus: 'PENDING' } }),
      this.prisma.networkLink.count({ where: { deletedAt: null } }),
      this.prisma.reservation.count({ where: { status: { not: 'CART' } } }),
      this.prisma.payment.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.transactionLog.count(),
      this.prisma.apiSyncRun.count({
        where: { status: 'FAILED', startedAt: { gte: new Date(Date.now() - 86400_000) } },
      }),
    ]);
    return {
      users,
      operators,
      pendingOperators,
      links,
      reservations,
      paidPayments: paid._count,
      grossVolume: Number(paid._sum.amount ?? 0),
      ledgerEntries,
      syncFailures24h: syncFailures,
    };
  }

  @Get('operators')
  async operators(@Query('status') status?: string) {
    return this.prisma.operatorProfile.findMany({
      where: { deletedAt: null, ...(status && { approvalStatus: status as 'PENDING' }) },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, fullName: true } },
        _count: { select: { links: true, apiConfigs: true } },
      },
    });
  }

  private async review(admin: AuthUser, id: string, approve: boolean, reason?: string) {
    const op = await this.prisma.operatorProfile.findUnique({ where: { id } });
    if (!op) throw new NotFoundException();
    if (!approve && !reason?.trim()) throw new BadRequestException('reason is required');
    const row = await this.prisma.operatorProfile.update({
      where: { id },
      data: {
        approvalStatus: approve ? 'APPROVED' : 'REJECTED',
        reviewedById: admin.sub,
        reviewedAt: new Date(),
        rejectionReason: approve ? null : reason,
      },
    });
    await this.ledger.append({
      eventType: 'OPERATOR_APPROVAL',
      status: 'SUCCESS',
      action: approve ? 'operator.approved' : 'operator.rejected',
      actorUserId: admin.sub,
      operatorProfileId: id,
      entityType: 'OperatorProfile',
      entityId: id,
      message: reason,
    });
    return row;
  }

  @Post('operators/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.review(u, id, true);
  }

  @Post('operators/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body('reason') reason?: string) {
    return this.review(u, id, false, reason);
  }

  @Get('users')
  users() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        locale: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    });
  }

  @Patch('users/:id/status')
  async setStatus(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body('status') status: 'ACTIVE' | 'SUSPENDED',
  ) {
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw new BadRequestException('Invalid status');
    if (id === u.sub) throw new BadRequestException('Cannot change your own status');
    const row = await this.prisma.user.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
    await this.ledger.append({
      eventType: 'ADMIN_ACTION',
      status: 'SUCCESS',
      action: `user.${status.toLowerCase()}`,
      actorUserId: u.sub,
      entityType: 'User',
      entityId: id,
    });
    return row;
  }

  @Get('ledger')
  async ledgerList(
    @Query('eventType') eventType?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
  ) {
    const take = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;
    const where: Prisma.TransactionLogWhereInput = eventType
      ? { eventType: eventType as LedgerEventType }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.transactionLog.count({ where }),
      this.prisma.transactionLog.findMany({
        where,
        orderBy: { sequence: 'desc' },
        skip,
        take,
        include: { actor: { select: { email: true } } },
      }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        ...r,
        sequence: Number(r.sequence),
        amount: r.amount === null ? null : Number(r.amount),
        actor: r.actor?.email ?? null,
      })),
    };
  }

  @Get('ledger/verify')
  verify() {
    return this.ledger.verifyChain();
  }

  @Get('sync-runs')
  syncRuns() {
    return this.prisma.apiSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: {
        apiConfig: { select: { name: true, operatorProfile: { select: { displayName: true } } } },
      },
    });
  }

  @Get('settings')
  async getSettings() {
    return this.prisma.platformSetting.findMany({
      where: { isSecret: false },
      orderBy: { key: 'asc' },
    });
  }

  @Put('settings/:key')
  async putSetting(
    @CurrentUser() u: AuthUser,
    @Param('key') key: string,
    @Body('value') value: unknown,
  ) {
    const existing = await this.prisma.platformSetting.findUnique({ where: { key } });
    if (!existing || existing.isSecret) throw new NotFoundException();
    const row = await this.settings.set(key, value, u.sub);
    await this.ledger.append({
      eventType: 'ADMIN_ACTION',
      status: 'SUCCESS',
      action: 'setting.updated',
      actorUserId: u.sub,
      entityType: 'PlatformSetting',
      entityId: key,
      requestPayload: { value },
    });
    return row;
  }
}

@Module({ controllers: [AdminController] })
export class AdminModule {}
