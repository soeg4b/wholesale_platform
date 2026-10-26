import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { AuthGuard, AuthUser, CurrentUser, Perms, Roles } from '../common/auth.guard';
import { LinksModule } from '../links/links.module';
import { PricingService } from '../links/pricing.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AdapterRegistry } from '../integrations/sync.service';
import { InteractionsModule, InteractionsService } from '../interactions/interactions.module';
import {
  MidtransProvider,
  MockPaymentProvider,
  PaymentProvider,
  WebhookResult,
} from './payment-providers';

const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

// The mock provider lets a buyer mark their own payment as paid, so it is off in production.
const mockPaymentsAllowed = () =>
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_MOCK_PAYMENTS === 'true';

type ItemWithLink = Prisma.ReservationItemGetPayload<{
  include: { networkLink: { include: { apiConfig: true } } };
}>;

@Injectable()
export class ReservationsService {
  private readonly log = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly registry: AdapterRegistry,
    private readonly interactions: InteractionsService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProvider[],
  ) {}

  // CART_ADD / RESERVE are only ever recorded here, so clients cannot forge demand signals.
  async trackLinks(user: AuthUser, type: 'CART_ADD' | 'RESERVE', linkIds: string[]) {
    const links = await this.prisma.networkLink.findMany({
      where: { id: { in: linkIds } },
      select: { id: true, originName: true, destinationName: true },
    });
    for (const link of links) this.interactions.track(user, type, { link });
  }

  // ---------- presentation ----------
  private present<
    T extends { subtotal: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal },
  >(r: T) {
    return {
      ...r,
      subtotal: Number(r.subtotal),
      taxAmount: Number(r.taxAmount),
      totalAmount: Number(r.totalAmount),
    };
  }

  private include = {
    items: {
      include: {
        networkLink: {
          select: {
            id: true,
            name: true,
            originName: true,
            destinationName: true,
            category: true,
            capacityMbps: true,
            latencyMs: true,
            availability: true,
            currency: true,
            operatorProfile: { select: { displayName: true } },
          },
        },
      },
    },
    payments: { orderBy: { createdAt: 'desc' as const } },
  } satisfies Prisma.ReservationInclude;

  private async load(id: string) {
    const r = await this.prisma.reservation.findUniqueOrThrow({
      where: { id },
      include: this.include,
    });
    return {
      ...this.present(r),
      items: r.items.map((i) => ({
        ...i,
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
      })),
      payments: r.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    };
  }

  // ---------- cart ----------
  private async cartFor(userId: string) {
    const existing = await this.prisma.reservation.findFirst({
      where: { buyerUserId: userId, status: 'CART' },
    });
    if (existing) return existing;
    const buyer = await this.prisma.buyerProfile.findUnique({ where: { userId } });
    return this.prisma.reservation.create({
      data: {
        reference: `RSV-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`,
        buyerUserId: userId,
        buyerProfileId: buyer?.id,
      },
    });
  }

  async getCart(userId: string) {
    const cart = await this.cartFor(userId);
    return this.load(cart.id);
  }

  private async recalc(reservationId: string) {
    const items = await this.prisma.reservationItem.findMany({ where: { reservationId } });
    const subtotal = items.reduce((s, i) => s.plus(i.lineTotal), new Prisma.Decimal(0));
    const rate = await this.settings.get<number>('tax.rate', 0.11);
    const tax = subtotal.mul(rate).toDecimalPlaces(2);
    await this.prisma.reservation.update({
      where: { id: reservationId },
      data: { subtotal, taxAmount: tax, totalAmount: subtotal.plus(tax) },
    });
  }

  async addItem(userId: string, linkId: string, termMonths = 12, requestedMbps?: number) {
    if (typeof linkId !== 'string') throw new NotFoundException('Link not found');
    if (
      requestedMbps !== undefined &&
      requestedMbps !== null &&
      (typeof requestedMbps !== 'number' || !Number.isFinite(requestedMbps) || requestedMbps <= 0)
    )
      throw new BadRequestException('Invalid requestedMbps');
    if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 120)
      throw new BadRequestException('Invalid termMonths');
    const link = await this.prisma.networkLink.findFirst({
      where: {
        id: linkId,
        deletedAt: null,
        status: 'ACTIVE',
        operatorProfile: { approvalStatus: 'APPROVED' },
      },
    });
    if (!link) throw new NotFoundException('Link not found');
    if (link.availability !== 'AVAILABLE') throw new ConflictException('Link is not available');
    if (link.basePrice === null) throw new BadRequestException('Link has no price');
    const cart = await this.cartFor(userId);
    const existingItems = await this.prisma.reservationItem.findMany({
      where: { reservationId: cart.id },
      include: { networkLink: true },
    });
    if (existingItems.some((i) => i.networkLink.currency !== link.currency)) {
      throw new BadRequestException('Cart items must share one currency');
    }
    const rules = await this.prisma.pricingRule.findMany({
      where: { operatorProfileId: link.operatorProfileId, isActive: true },
    });
    const quote = this.pricing.compute(link, rules, { termMonths, requestedMbps });
    const data = {
      requestedMbps: requestedMbps ?? link.capacityMbps,
      termMonths,
      unitPrice: quote.unitPrice,
      lineTotal: quote.unitPrice, // first monthly invoice is charged at checkout
      appliedRules: quote.applied as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.reservationItem.upsert({
      where: { reservationId_networkLinkId: { reservationId: cart.id, networkLinkId: link.id } },
      create: { reservationId: cart.id, networkLinkId: link.id, ...data },
      update: data,
    });
    await this.recalc(cart.id);
    return this.load(cart.id);
  }

  async removeItem(userId: string, itemId: string) {
    const cart = await this.cartFor(userId);
    const res = await this.prisma.reservationItem.deleteMany({
      where: { id: itemId, reservationId: cart.id },
    });
    if (!res.count) throw new NotFoundException();
    await this.recalc(cart.id);
    return this.load(cart.id);
  }

  // ---------- operator locks ----------
  private async releaseItems(reservationId: string, actorUserId: string | null, reason: string) {
    const items = await this.prisma.reservationItem.findMany({
      where: { reservationId, lockStatus: 'ACQUIRED' },
      include: { networkLink: { include: { apiConfig: true } } },
    });
    for (const item of items) {
      await this.releaseOne(item, actorUserId, reason);
    }
  }

  private async releaseOne(item: ItemWithLink, actorUserId: string | null, reason: string) {
    let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';
    let message: string | undefined;
    const { apiConfig } = item.networkLink;
    if (apiConfig && item.externalLockRef) {
      try {
        await this.registry
          .for(apiConfig)
          .release(
            apiConfig,
            item.externalLockRef,
            item.networkLink.externalId ?? item.networkLinkId,
          );
      } catch (err) {
        status = 'FAILED';
        message = err instanceof Error ? err.message : String(err);
        this.log.warn(`Release failed for ${item.id}: ${message}`);
      }
    }
    await this.prisma.reservationItem.update({
      where: { id: item.id },
      data: { lockStatus: 'RELEASED' },
    });
    await this.prisma.networkLink.updateMany({
      where: { id: item.networkLinkId, availability: 'LOCKED' },
      data: { availability: 'AVAILABLE' },
    });
    await this.ledger.appendSafe({
      eventType: 'LINK_LOCK',
      status,
      action: 'link.lock.released',
      actorUserId,
      networkLinkId: item.networkLinkId,
      reservationId: item.reservationId,
      operatorProfileId: item.networkLink.operatorProfileId,
      externalRef: item.externalLockRef,
      message: message ?? reason,
    });
  }

  // ---------- checkout ----------
  async checkout(userId: string, ip?: string) {
    const cart = await this.prisma.reservation.findFirst({
      where: { buyerUserId: userId, status: 'CART' },
      include: { buyer: true },
    });
    if (!cart) throw new BadRequestException('Cart is empty');
    // Status flip is the mutex against double-submit.
    const claimed = await this.prisma.reservation.updateMany({
      where: { id: cart.id, status: 'CART' },
      data: { status: 'LOCKED' },
    });
    if (!claimed.count) throw new ConflictException('Checkout already in progress');

    const fail = async (message: string, locked: boolean): Promise<never> => {
      if (locked) await this.releaseItems(cart.id, userId, 'checkout failed');
      await this.prisma.reservation.update({
        where: { id: cart.id },
        data: { status: 'CART', expiresAt: null },
      });
      await this.ledger.appendSafe({
        eventType: 'RESERVATION',
        status: 'FAILED',
        action: 'reservation.checkout',
        actorUserId: userId,
        reservationId: cart.id,
        message,
        ipAddress: ip,
      });
      throw new ConflictException(message);
    };

    const items = await this.prisma.reservationItem.findMany({
      where: { reservationId: cart.id },
      include: { networkLink: { include: { apiConfig: true } } },
    });
    if (!items.length) return fail('Cart is empty', false);

    const ttl = await this.settings.get<number>('reservation.lock_ttl_seconds', 900);

    // Re-price at lock time so the buyer pays the current rules, not a stale cart price.
    for (const item of items) {
      const rules = await this.prisma.pricingRule.findMany({
        where: { operatorProfileId: item.networkLink.operatorProfileId, isActive: true },
      });
      const q = this.pricing.compute(item.networkLink, rules, {
        termMonths: item.termMonths,
        requestedMbps: item.requestedMbps,
      });
      await this.prisma.reservationItem.update({
        where: { id: item.id },
        data: {
          unitPrice: q.unitPrice,
          lineTotal: q.unitPrice,
          appliedRules: q.applied as unknown as Prisma.InputJsonValue,
        },
      });
    }
    await this.recalc(cart.id);

    let locked = false;
    for (const item of items) {
      const link = item.networkLink;
      const claim = await this.prisma.networkLink.updateMany({
        where: { id: link.id, availability: 'AVAILABLE', status: 'ACTIVE', deletedAt: null },
        data: { availability: 'LOCKED' },
      });
      if (!claim.count)
        return fail(
          `Link no longer available: ${link.originName} - ${link.destinationName}`,
          locked,
        );
      locked = true;
      try {
        const adapterLock = link.apiConfig
          ? await this.registry
              .for(link.apiConfig)
              .lock(link.apiConfig, link.externalId ?? link.id, ttl, cart.reference)
          : {
              lockRef: `local-${link.id}-${Date.now()}`,
              expiresAt: new Date(Date.now() + ttl * 1000),
            };
        await this.prisma.reservationItem.update({
          where: { id: item.id },
          data: {
            lockStatus: 'ACQUIRED',
            externalLockRef: adapterLock.lockRef,
            lockExpiresAt: adapterLock.expiresAt,
          },
        });
        await this.ledger.append({
          eventType: 'LINK_LOCK',
          status: 'SUCCESS',
          action: 'link.lock.acquired',
          actorUserId: userId,
          networkLinkId: link.id,
          reservationId: cart.id,
          operatorProfileId: link.operatorProfileId,
          externalRef: adapterLock.lockRef,
          responsePayload: { expiresAt: adapterLock.expiresAt },
        });
      } catch (err) {
        await this.prisma.networkLink.updateMany({
          where: { id: link.id, availability: 'LOCKED' },
          data: { availability: 'AVAILABLE' },
        });
        await this.ledger.appendSafe({
          eventType: 'LINK_LOCK',
          status: 'FAILED',
          action: 'link.lock.acquired',
          actorUserId: userId,
          networkLinkId: link.id,
          reservationId: cart.id,
          operatorProfileId: link.operatorProfileId,
          message: err instanceof Error ? err.message : String(err),
        });
        return fail(`Operator could not hold ${link.originName} - ${link.destinationName}`, true);
      }
    }

    const fresh = await this.prisma.reservation.findUniqueOrThrow({
      where: { id: cart.id },
      include: { items: true },
    });
    const expiresAt = new Date(
      Math.min(
        ...fresh.items.map((i) => (i.lockExpiresAt ?? new Date(Date.now() + ttl * 1000)).getTime()),
      ),
    );

    const providerKey = await this.settings.get<string>('payment.provider', 'mock');
    const provider = this.providers.find((p) => p.key === providerKey);
    if (!provider || (provider.key === 'mock' && !mockPaymentsAllowed()))
      return fail(`Payment provider "${providerKey}" is not available`, true);

    const payment = await this.prisma.payment.create({
      data: {
        reservationId: cart.id,
        provider: provider.key,
        amount: fresh.totalAmount,
        currency: fresh.currency,
        idempotencyKey: `${cart.id}:${randomBytes(6).toString('hex')}`,
        expiresAt,
      },
    });
    try {
      const charge = await provider.createCharge({
        paymentId: payment.id,
        reference: cart.reference,
        amount: Number(fresh.totalAmount),
        currency: fresh.currency,
        customer: { name: cart.buyer.fullName, email: cart.buyer.email },
        returnUrl: `${process.env.WEB_ORIGIN || 'http://localhost:3000'}/reservations/${cart.id}`,
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { externalId: charge.externalId, checkoutUrl: charge.checkoutUrl },
      });
    } catch (err) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: err instanceof Error ? err.message : String(err) },
      });
      await this.ledger.appendSafe({
        eventType: 'PAYMENT',
        status: 'FAILED',
        action: 'payment.created',
        actorUserId: userId,
        reservationId: cart.id,
        paymentId: payment.id,
        amount: fresh.totalAmount,
        currency: fresh.currency,
        message: err instanceof Error ? err.message : String(err),
      });
      return fail('Payment provider error, please try again', true);
    }

    await this.prisma.reservation.update({
      where: { id: cart.id },
      data: { status: 'AWAITING_PAYMENT', expiresAt },
    });
    await this.ledger.append({
      eventType: 'RESERVATION',
      status: 'SUCCESS',
      action: 'reservation.checkout',
      actorUserId: userId,
      reservationId: cart.id,
      amount: fresh.totalAmount,
      currency: fresh.currency,
      ipAddress: ip,
      responsePayload: { items: items.length, expiresAt },
    });
    await this.ledger.append({
      eventType: 'PAYMENT',
      status: 'INITIATED',
      action: 'payment.created',
      actorUserId: userId,
      reservationId: cart.id,
      paymentId: payment.id,
      amount: fresh.totalAmount,
      currency: fresh.currency,
      externalRef: payment.externalId,
      responsePayload: { provider: provider.key },
    });
    return this.load(cart.id);
  }

  // ---------- payment results ----------
  async applyPaymentResult(
    paymentId: string,
    status: WebhookResult['status'],
    source: string,
    raw?: unknown,
    eventId?: string,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { reservation: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (status === 'PENDING') return payment;
    const reservation = payment.reservation;

    if (status === 'PAID') {
      const claimed = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: ['PENDING', 'AUTHORIZED', 'EXPIRED'] } },
        data: { status: 'PAID', paidAt: new Date() },
      });
      if (!claimed.count) return payment; // already processed (idempotent)
      await this.ledger.append({
        eventType: 'PAYMENT',
        status: 'SUCCESS',
        action: `payment.paid.${source}`,
        reservationId: reservation.id,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        externalRef: eventId ?? payment.externalId,
        actorUserId: reservation.buyerUserId,
        responsePayload: raw,
      });
      if (reservation.status === 'EXPIRED' || reservation.status === 'CANCELLED') {
        await this.prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: 'PAID' },
        });
        await this.ledger.appendSafe({
          eventType: 'RESERVATION',
          status: 'FAILED',
          action: 'reservation.paid-after-release',
          reservationId: reservation.id,
          paymentId: payment.id,
          message: 'Payment received after locks were released; manual review/refund required',
        });
        return this.load(reservation.id);
      }
      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: 'PAID' },
      });
      const items = await this.prisma.reservationItem.findMany({
        where: { reservationId: reservation.id },
        include: { networkLink: { include: { apiConfig: true } } },
      });
      let allConfirmed = true;
      for (const item of items) {
        const { apiConfig } = item.networkLink;
        try {
          if (apiConfig && item.externalLockRef) {
            await this.registry
              .for(apiConfig)
              .confirm(
                apiConfig,
                item.externalLockRef,
                item.networkLink.externalId ?? item.networkLinkId,
              );
          }
          await this.prisma.reservationItem.update({
            where: { id: item.id },
            data: { lockStatus: 'CONFIRMED' },
          });
          await this.prisma.networkLink.update({
            where: { id: item.networkLinkId },
            data: { availability: 'RESERVED' },
          });
          await this.ledger.appendSafe({
            eventType: 'LINK_LOCK',
            status: 'SUCCESS',
            action: 'link.lock.confirmed',
            reservationId: reservation.id,
            networkLinkId: item.networkLinkId,
            operatorProfileId: item.networkLink.operatorProfileId,
            externalRef: item.externalLockRef,
          });
        } catch (err) {
          allConfirmed = false;
          await this.ledger.appendSafe({
            eventType: 'LINK_LOCK',
            status: 'FAILED',
            action: 'link.lock.confirmed',
            reservationId: reservation.id,
            networkLinkId: item.networkLinkId,
            operatorProfileId: item.networkLink.operatorProfileId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (allConfirmed) {
        await this.prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: 'CONFIRMED', expiresAt: null },
        });
      }
      await this.ledger.appendSafe({
        eventType: 'RESERVATION',
        status: allConfirmed ? 'SUCCESS' : 'FAILED',
        action: allConfirmed ? 'reservation.confirmed' : 'reservation.confirm-incomplete',
        reservationId: reservation.id,
        amount: payment.amount,
        currency: payment.currency,
        actorUserId: reservation.buyerUserId,
      });
      return this.load(reservation.id);
    }

    // FAILED / EXPIRED
    const next = status === 'EXPIRED' ? 'EXPIRED' : 'FAILED';
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: { in: ['PENDING', 'AUTHORIZED'] } },
      data: { status: next, failureReason: `${source}:${status}` },
    });
    if (!claimed.count) return payment;
    await this.releaseItems(
      reservation.id,
      reservation.buyerUserId,
      `payment ${next.toLowerCase()}`,
    );
    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: next === 'EXPIRED' ? 'EXPIRED' : 'FAILED' },
    });
    await this.ledger.append({
      eventType: 'PAYMENT',
      status: 'FAILED',
      action: `payment.${next.toLowerCase()}.${source}`,
      reservationId: reservation.id,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      responsePayload: raw,
    });
    return this.load(reservation.id);
  }

  async cancel(userId: string, reservationId: string) {
    const r = await this.prisma.reservation.findFirst({
      where: { id: reservationId, buyerUserId: userId, status: 'AWAITING_PAYMENT' },
      include: { payments: true },
    });
    if (!r) throw new NotFoundException();
    for (const p of r.payments.filter((p) => p.status === 'PENDING')) {
      await this.prisma.payment.update({ where: { id: p.id }, data: { status: 'CANCELLED' } });
    }
    await this.releaseItems(r.id, userId, 'cancelled by buyer');
    await this.prisma.reservation.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
    await this.ledger.append({
      eventType: 'RESERVATION',
      status: 'CANCELLED',
      action: 'reservation.cancelled',
      actorUserId: userId,
      reservationId: r.id,
    });
    return this.load(r.id);
  }

  // Pays a pending checkout from the buyer's prepaid wallet balance.
  async payWithWallet(userId: string, reservationId: string) {
    const r = await this.prisma.reservation.findFirst({
      where: { id: reservationId, buyerUserId: userId, status: 'AWAITING_PAYMENT' },
      include: { payments: true },
    });
    if (!r) throw new NotFoundException();
    const payment = r.payments.find((p) => p.status === 'PENDING');
    if (!payment) throw new ConflictException('No pending payment');
    const profile = await this.prisma.buyerProfile.findUnique({ where: { userId } });
    if (!profile)
      throw new BadRequestException({ code: 'NO_BUYER_PROFILE', message: 'No buyer profile' });
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:${profile.id}`}))`;
      const bal = await tx.walletEntry.aggregate({
        where: { buyerProfileId: profile.id },
        _sum: { amount: true },
      });
      if (Number(bal._sum.amount ?? 0) < Number(payment.amount))
        throw new HttpException(
          { code: 'INSUFFICIENT_BALANCE', message: 'Wallet balance is too low' },
          402,
        );
      // Switching the provider claims the payment, so the mock/gateway path can no longer complete it.
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { provider: 'wallet', method: 'WALLET' },
      });
      if (!claimed.count) throw new ConflictException('Payment already processed');
      await tx.walletEntry.create({
        data: {
          buyerProfileId: profile.id,
          type: 'CHARGE',
          amount: payment.amount.neg(),
          currency: payment.currency,
          reservationId: r.id,
          reference: r.reference,
          description: { id: `Pembayaran ${r.reference}`, en: `Payment ${r.reference}` },
          createdById: userId,
        },
      });
    });
    await this.ledger.appendSafe({
      eventType: 'WALLET',
      status: 'SUCCESS',
      action: 'wallet.charge',
      actorUserId: userId,
      reservationId: r.id,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
    });
    return this.applyPaymentResult(payment.id, 'PAID', 'wallet');
  }

  async mockComplete(userId: string, paymentId: string, outcome: 'success' | 'failure') {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { reservation: true },
    });
    if (!payment || payment.reservation.buyerUserId !== userId) throw new NotFoundException();
    if (payment.provider !== 'mock' || !mockPaymentsAllowed())
      throw new ForbiddenException('Only available for the mock provider');
    return this.applyPaymentResult(paymentId, outcome === 'success' ? 'PAID' : 'FAILED', 'mock');
  }

  async listFor(user: AuthUser) {
    const where: Prisma.ReservationWhereInput = user.roles.includes('ADMIN')
      ? { status: { not: 'CART' } }
      : user.roles.includes('PENYELENGGARA')
        ? {
            status: { not: 'CART' },
            items: { some: { networkLink: { operatorProfile: { userId: user.sub } } } },
          }
        : { buyerUserId: user.sub, status: { not: 'CART' } };
    const rows = await this.prisma.reservation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: this.include,
    });
    return rows.map((r) => ({
      ...this.present(r),
      items: r.items.map((i) => ({
        ...i,
        unitPrice: Number(i.unitPrice),
        lineTotal: Number(i.lineTotal),
      })),
      payments: r.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    }));
  }

  async getFor(user: AuthUser, id: string) {
    const r = await this.prisma.reservation.findUnique({
      where: { id },
      include: { items: { include: { networkLink: true } } },
    });
    if (!r) throw new NotFoundException();
    const isOwner = r.buyerUserId === user.sub;
    const isOperator =
      user.roles.includes('PENYELENGGARA') &&
      (await this.prisma.operatorProfile.count({
        where: {
          userId: user.sub,
          id: { in: r.items.map((i) => i.networkLink.operatorProfileId) },
        },
      })) > 0;
    if (!isOwner && !isOperator && !user.roles.includes('ADMIN')) throw new NotFoundException();
    return this.load(id);
  }

  async handlePaymentWebhook(
    providerKey: string,
    body: Record<string, unknown>,
    rawBody: Buffer | undefined,
  ) {
    const provider = this.providers.find((p) => p.key === providerKey);
    if (!provider) throw new NotFoundException();
    let parsed: WebhookResult;
    try {
      parsed = provider.parseWebhook(body, rawBody);
    } catch (err) {
      await this.prisma.webhookEvent.create({
        data: {
          source: 'PAYMENT_GATEWAY',
          provider: providerKey,
          signatureOk: false,
          payload: body as Prisma.InputJsonValue,
          status: 'FAILED',
          error: 'Invalid signature',
        },
      });
      throw err;
    }
    let event;
    try {
      event = await this.prisma.webhookEvent.create({
        data: {
          source: 'PAYMENT_GATEWAY',
          provider: providerKey,
          eventId: parsed.eventId ?? null,
          signatureOk: true,
          payload: body as Prisma.InputJsonValue,
        },
      });
    } catch {
      return { duplicate: true };
    }
    try {
      await this.applyPaymentResult(
        parsed.paymentId,
        parsed.status,
        providerKey,
        parsed.raw,
        parsed.eventId,
      );
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    } catch (err) {
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
    return { ok: true };
  }

  // Releases operator locks for unpaid reservations whose TTL has passed.
  @Interval(15_000)
  async sweepExpired() {
    const due = await this.prisma.reservation.findMany({
      where: { status: 'AWAITING_PAYMENT', expiresAt: { lt: new Date() } },
      include: { payments: { where: { status: 'PENDING' } } },
      take: 50,
    });
    for (const r of due) {
      const claimed = await this.prisma.reservation.updateMany({
        where: { id: r.id, status: 'AWAITING_PAYMENT' },
        data: { status: 'EXPIRED' },
      });
      if (!claimed.count) continue;
      await this.prisma.payment.updateMany({
        where: { reservationId: r.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      await this.releaseItems(r.id, null, 'lock expired');
      await this.ledger.appendSafe({
        eventType: 'RESERVATION',
        status: 'CANCELLED',
        action: 'reservation.expired',
        reservationId: r.id,
        actorUserId: r.buyerUserId,
      });
    }
  }
}

@Controller()
export class ReservationsController {
  constructor(private readonly svc: ReservationsService) {}

  @Get('cart')
  @UseGuards(AuthGuard)
  @Perms('reservation:create')
  cart(@CurrentUser() u: AuthUser) {
    return this.svc.getCart(u.sub);
  }

  @Post('cart/items')
  @UseGuards(AuthGuard)
  @Perms('reservation:create')
  add(
    @CurrentUser() u: AuthUser,
    @Body() b: { linkId: string; termMonths?: number; requestedMbps?: number },
  ) {
    return this.svc.addItem(u.sub, b.linkId, b.termMonths ?? 12, b.requestedMbps).then((r) => {
      void this.svc.trackLinks(u, 'CART_ADD', [b.linkId]).catch(() => undefined);
      return r;
    });
  }

  @Delete('cart/items/:id')
  @UseGuards(AuthGuard)
  @Perms('reservation:create')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.removeItem(u.sub, id);
  }

  @Post('cart/checkout')
  @UseGuards(AuthGuard)
  @Perms('reservation:create')
  checkout(@CurrentUser() u: AuthUser, @Req() req: { ip?: string }) {
    return this.svc.checkout(u.sub, req.ip).then((r) => {
      void this.svc
        .trackLinks(
          u,
          'RESERVE',
          r.items.map((i) => i.networkLinkId),
        )
        .catch(() => undefined);
      return r;
    });
  }

  @Get('reservations')
  @UseGuards(AuthGuard)
  list(@CurrentUser() u: AuthUser) {
    return this.svc.listFor(u);
  }

  @Get('reservations/:id')
  @UseGuards(AuthGuard)
  one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.getFor(u, id);
  }

  @Post('reservations/:id/cancel')
  @UseGuards(AuthGuard)
  @Perms('reservation:create')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.cancel(u.sub, id);
  }

  @Post('reservations/:id/pay-wallet')
  @UseGuards(AuthGuard)
  @Perms('reservation:create')
  payWallet(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.payWithWallet(u.sub, id);
  }

  @Post('payments/mock/:id/complete')
  @UseGuards(AuthGuard)
  @Roles('PENYEWA')
  mock(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: { outcome: 'success' | 'failure' },
  ) {
    return this.svc.mockComplete(u.sub, id, b.outcome === 'failure' ? 'failure' : 'success');
  }

  @Post('webhooks/payments/:provider')
  @HttpCode(200)
  webhook(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { rawBody?: Buffer },
    @Headers() _h: unknown,
  ) {
    return this.svc.handlePaymentWebhook(provider, body, req.rawBody);
  }
}

@Module({
  imports: [LinksModule, IntegrationsModule, InteractionsModule],
  controllers: [ReservationsController],
  providers: [
    MockPaymentProvider,
    MidtransProvider,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (a: MockPaymentProvider, b: MidtransProvider) => [a, b],
      inject: [MockPaymentProvider, MidtransProvider],
    },
    ReservationsService,
  ],
})
export class ReservationsModule {}
