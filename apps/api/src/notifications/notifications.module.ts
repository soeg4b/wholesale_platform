import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  MessageEvent,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable } from 'rxjs';
import { NotificationCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { AuthGuard, AuthUser, CurrentUser } from '../common/auth.guard';

export const CATEGORIES: NotificationCategory[] = [
  'PROMO',
  'DISCOUNT',
  'EARLY_BIRD',
  'BILLING_ALERT',
  'LINK_REQUEST',
  'TICKET',
];

export type Bilingual = { id: string; en: string };

export interface PrefFilters {
  cities?: string[];
  operatorIds?: string[];
  minDiscountPct?: number;
}

export interface NotifyInput {
  userIds: string[];
  category: NotificationCategory;
  title: Bilingual;
  body?: Bilingual;
  href?: string;
  entityType?: string;
  entityId?: string;
  // Made unique per recipient (":<userId>" is appended), so re-sending the same event is a no-op.
  dedupeKey?: string;
  match?: { cities?: string[]; operatorId?: string; discountPct?: number };
  isDemo?: boolean;
}

interface Pref {
  category: NotificationCategory;
  enabled: boolean;
  channels: string[];
  filters: PrefFilters | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async defaults() {
    return this.settings.cfg<Record<string, { enabled: boolean; channels: string[] }>>(
      'notification.defaults',
    );
  }

  async prefsFor(userId: string): Promise<Pref[]> {
    const [defs, rows] = await Promise.all([
      this.defaults(),
      this.prisma.notificationPreference.findMany({ where: { userId } }),
    ]);
    return CATEGORIES.map((category) => {
      const row = rows.find((r) => r.category === category);
      return {
        category,
        enabled: row ? row.enabled : (defs[category]?.enabled ?? true),
        channels: row ? row.channels : (defs[category]?.channels ?? ['IN_APP']),
        filters: (row?.filters as PrefFilters | null) ?? null,
      };
    });
  }

  async savePrefs(userId: string, items: unknown) {
    if (!Array.isArray(items) || items.length > CATEGORIES.length)
      throw new BadRequestException({ code: 'INVALID_PREFS', message: 'items must be an array' });
    const allowed = await this.settings.cfg<string[]>('notification.channels');
    for (const raw of items as Record<string, unknown>[]) {
      const category = raw?.category as NotificationCategory;
      const channels = raw?.channels;
      const f = (raw?.filters ?? null) as PrefFilters | null;
      const strList = (v: unknown) =>
        v === undefined ||
        (Array.isArray(v) &&
          v.length <= 100 &&
          v.every((s) => typeof s === 'string' && s.length <= 120));
      if (
        !CATEGORIES.includes(category) ||
        typeof raw.enabled !== 'boolean' ||
        !Array.isArray(channels) ||
        !channels.every((c) => typeof c === 'string' && allowed.includes(c)) ||
        (f !== null &&
          (typeof f !== 'object' ||
            !strList(f.cities) ||
            !strList(f.operatorIds) ||
            (f.minDiscountPct !== undefined &&
              !(
                typeof f.minDiscountPct === 'number' &&
                f.minDiscountPct >= 0 &&
                f.minDiscountPct <= 100
              ))))
      )
        throw new BadRequestException({ code: 'INVALID_PREFS', message: 'invalid preference' });
      const filters = f
        ? ({
            cities: f.cities,
            operatorIds: f.operatorIds,
            minDiscountPct: f.minDiscountPct,
          } as Prisma.InputJsonValue)
        : Prisma.DbNull;
      await this.prisma.notificationPreference.upsert({
        where: { userId_category: { userId, category } },
        create: { userId, category, enabled: raw.enabled, channels: channels as string[], filters },
        update: { enabled: raw.enabled, channels: channels as string[], filters },
      });
    }
    return this.prefsFor(userId);
  }

  // Active, loginable users of a role (demo users without a password are excluded).
  async audience(roleKey: string): Promise<string[]> {
    const max = await this.settings.cfg<number>('notification.maxFanout');
    const rows = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        passwordHash: { not: null },
        roles: { some: { role: { key: roleKey } } },
      },
      select: { id: true },
      take: max,
    });
    return rows.map((r) => r.id);
  }

  private matches(f: PrefFilters | null, m: NotifyInput['match']) {
    if (!f || !m) return true;
    const lower = (a?: string[]) => (a ?? []).map((s) => s.toLowerCase());
    if (f.cities?.length && m.cities?.length) {
      const want = lower(f.cities);
      if (!lower(m.cities).some((c) => want.includes(c))) return false;
    }
    if (f.operatorIds?.length && m.operatorId && !f.operatorIds.includes(m.operatorId))
      return false;
    if (f.minDiscountPct !== undefined && m.discountPct !== undefined)
      if (m.discountPct < f.minDiscountPct) return false;
    return true;
  }

  async notify(input: NotifyInput) {
    const ids = [...new Set(input.userIds)];
    if (!ids.length) return { sent: 0 };
    const [defs, rows] = await Promise.all([
      this.defaults(),
      this.prisma.notificationPreference.findMany({
        where: { userId: { in: ids }, category: input.category },
      }),
    ]);
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    const recipients = ids.filter((uid) => {
      const p = byUser.get(uid);
      const enabled = p ? p.enabled : (defs[input.category]?.enabled ?? true);
      const inApp = p ? p.channels.includes('IN_APP') : true;
      return enabled && inApp && this.matches((p?.filters as PrefFilters) ?? null, input.match);
    });
    if (!recipients.length) return { sent: 0 };
    const res = await this.prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        category: input.category,
        title: input.title,
        body: input.body,
        href: input.href,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${userId}` : null,
        isDemo: input.isDemo ?? false,
      })),
      skipDuplicates: true,
    });
    return { sent: res.count };
  }

  async list(userId: string, unreadOnly: boolean, take: number) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, ...(unreadOnly && { readAt: null }) },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (!res.count) {
      const exists = await this.prisma.notification.count({ where: { id, userId } });
      if (!exists) throw new NotFoundException();
    }
    return { ok: true };
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  // Small payload pushed to the app: unread count and the newest unread item.
  async snapshot(userId: string) {
    const [unread, latest] = await Promise.all([
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.findFirst({
        where: { userId, readAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, category: true, title: true, href: true, createdAt: true },
      }),
    ]);
    return { unread, latest, at: new Date().toISOString() };
  }

  // Server-Sent Events stream (Android app / PWA realtime monitoring). The DB is polled every 5s
  // and an event is sent only when the snapshot changes, plus a heartbeat every 25s.
  streamFor(userId: string): Observable<MessageEvent> {
    return new Observable((sub) => {
      let last = '';
      let ticks = 0;
      const tick = async () => {
        try {
          const snap = await this.snapshot(userId);
          const json = JSON.stringify(snap);
          if (json !== last || ++ticks % 5 === 0) {
            sub.next({ data: snap } as MessageEvent);
            last = json;
          }
        } catch {
          // A DB hiccup must not kill the stream.
        }
      };
      void tick();
      const timer = setInterval(() => void tick(), 5000);
      return () => clearInterval(timer);
    });
  }
}

// EventSource cannot send an Authorization header, so this controller verifies the JWT itself.
@Controller('notifications')
export class NotificationsStreamController {
  constructor(
    private readonly jwt: JwtService,
    private readonly svc: NotificationsService,
  ) {}

  @Sse('stream')
  stream(@Query('token') token?: string): Observable<MessageEvent> {
    let user: AuthUser;
    try {
      user = this.jwt.verify<AuthUser>(token ?? '', { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return this.svc.streamFor(user.sub);
  }
}

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('unread') unread?: string, @Query('take') take?: string) {
    const n = Math.min(100, Math.max(1, Number(take) || 30));
    return this.svc.list(u.sub, unread === 'true', n);
  }

  @Get('preferences')
  prefs(@CurrentUser() u: AuthUser) {
    return this.svc.prefsFor(u.sub);
  }

  @Put('preferences')
  save(@CurrentUser() u: AuthUser, @Body() b: { items?: unknown }) {
    return this.svc.savePrefs(u.sub, b?.items);
  }

  @Post('read-all')
  readAll(@CurrentUser() u: AuthUser) {
    return this.svc.markAllRead(u.sub);
  }

  @Post(':id/read')
  read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.markRead(u.sub, id);
  }
}

@Module({
  controllers: [NotificationsController, NotificationsStreamController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
