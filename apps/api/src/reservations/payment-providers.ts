import { BadGatewayException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

export interface ChargeRequest {
  paymentId: string;
  reference: string;
  amount: number;
  currency: string;
  customer: { name: string; email: string };
  returnUrl: string;
}

export interface ChargeResult {
  externalId: string;
  checkoutUrl: string;
  expiresAt?: Date;
}

export interface WebhookResult {
  eventId?: string;
  paymentId: string;
  externalId: string;
  status: 'PAID' | 'FAILED' | 'EXPIRED' | 'PENDING';
  raw: unknown;
}

export interface PaymentProvider {
  readonly key: string;
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  parseWebhook(body: Record<string, unknown>, rawBody: Buffer | undefined): WebhookResult;
}

const webOrigin = () => process.env.WEB_ORIGIN || 'http://localhost:3000';

// Demo provider: checkout is a hosted page in our own web app; completion is simulated by the buyer.
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly key = 'mock';

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    return {
      externalId: `mock_${req.paymentId}`,
      checkoutUrl: `${webOrigin()}/pay/mock/${req.paymentId}`,
    };
  }

  parseWebhook(): WebhookResult {
    throw new UnauthorizedException('Mock provider does not use webhooks');
  }
}

@Injectable()
export class MidtransProvider implements PaymentProvider {
  readonly key = 'midtrans';

  private get serverKey() {
    const k = process.env.MIDTRANS_SERVER_KEY;
    if (!k) throw new BadGatewayException('MIDTRANS_SERVER_KEY is not configured');
    return k;
  }

  private get base() {
    return process.env.MIDTRANS_IS_PRODUCTION === 'true'
      ? 'https://app.midtrans.com'
      : 'https://app.sandbox.midtrans.com';
  }

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    const res = await fetch(`${this.base}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.serverKey}:`).toString('base64')}`,
      },
      body: JSON.stringify({
        transaction_details: { order_id: req.paymentId, gross_amount: Math.round(req.amount) },
        customer_details: { first_name: req.customer.name, email: req.customer.email },
        callbacks: { finish: req.returnUrl },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new BadGatewayException(`Midtrans error ${res.status}`);
    const json = (await res.json()) as { redirect_url: string };
    return { externalId: req.paymentId, checkoutUrl: json.redirect_url };
  }

  parseWebhook(body: Record<string, unknown>): WebhookResult {
    const orderId = String(body.order_id ?? '');
    const sigInput = `${orderId}${body.status_code}${body.gross_amount}${this.serverKey}`;
    const expected = Buffer.from(createHash('sha512').update(sigInput).digest('hex'));
    const given = Buffer.from(String(body.signature_key ?? ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Invalid signature');
    }
    const ts = String(body.transaction_status);
    const status =
      ts === 'settlement' || (ts === 'capture' && body.fraud_status === 'accept')
        ? 'PAID'
        : ts === 'expire'
          ? 'EXPIRED'
          : ['deny', 'cancel', 'failure'].includes(ts)
            ? 'FAILED'
            : 'PENDING';
    return {
      eventId: body.transaction_id ? `${body.transaction_id}:${ts}` : undefined,
      paymentId: orderId,
      externalId: orderId,
      status,
      raw: body,
    };
  }
}
