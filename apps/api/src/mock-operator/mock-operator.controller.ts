import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';
import { LedgerService } from '../common/ledger.service';
import { SettingsService } from '../common/settings.service';
import { FixtureLink, OPERATORS, OperatorKey, wobble } from './fixtures';
import { CITIES } from './fixtures';

interface Lock {
  op: OperatorKey;
  linkId: string;
  expires: number;
  confirmed: boolean;
}

interface Incident {
  id: string;
  op: OperatorKey;
  linkId: string;
  kind: 'DEGRADATION' | 'OUTAGE' | 'MAINTENANCE';
  expires: number;
  lossPct: number;
  latencyFactor: number;
}

// In-memory state of the simulated operator systems.
const locks = new Map<string, Lock>();
const incidents = new Map<string, Incident>();

function activeIncident(op: OperatorKey, linkId: string) {
  for (const i of incidents.values()) {
    if (i.expires <= Date.now()) incidents.delete(i.id);
    else if (i.op === op && i.linkId === linkId) return i;
  }
  return undefined;
}

function isHeld(op: OperatorKey, linkId: string) {
  for (const l of locks.values()) {
    if (l.op === op && l.linkId === linkId && (l.confirmed || l.expires > Date.now())) return true;
  }
  return false;
}

function live(op: OperatorKey, l: FixtureLink) {
  const held = isHeld(op, l.id);
  const inc = activeIncident(op, l.id);
  const free =
    held || l.state !== 'free'
      ? 0
      : Math.max(0, Math.round(l.freeMbps * (1 + wobble(l.id + 'f', 0.05))));
  const baseRtt = l.rttMs + wobble(l.id, l.rttMs * 0.04);
  const rtt = inc?.kind === 'DEGRADATION' ? baseRtt * inc.latencyFactor : baseRtt;
  return {
    held,
    rtt: Math.round(rtt * 100) / 100,
    free,
    state: held ? 'busy' : l.state,
    lossPct: inc?.kind === 'OUTAGE' ? 100 : inc?.kind === 'DEGRADATION' ? inc.lossPct : 0,
    oper: inc?.kind === 'OUTAGE' ? 'down' : inc?.kind === 'DEGRADATION' ? 'degraded' : 'up',
    planned: inc?.kind === 'MAINTENANCE' || l.state === 'maintenance',
  };
}

function assertToken(op: OperatorKey, supplied?: string) {
  if (!supplied || supplied !== OPERATORS[op].token) throw new UnauthorizedException();
}

const bearer = (h?: string) => h?.replace(/^Bearer /, '');

function findLink(op: OperatorKey, id: string) {
  const l = (OPERATORS[op].links as FixtureLink[]).find((x) => x.id === id);
  if (!l) throw new NotFoundException();
  return l;
}

function takeLock(op: OperatorKey, linkId: string, ttl: number) {
  const link = findLink(op, linkId);
  const state = live(op, link);
  if (state.held || state.state !== 'free' || state.free <= 0) {
    throw new ConflictException('Link not available');
  }
  const id = randomUUID();
  const expires = Date.now() + Math.max(30, Math.min(ttl || 900, 3600)) * 1000;
  locks.set(id, { op, linkId, expires, confirmed: false });
  return { id, expiresAt: new Date(expires).toISOString() };
}

function lockOr404(op: OperatorKey, id: string) {
  const l = locks.get(id);
  if (!l || l.op !== op) throw new NotFoundException();
  return l;
}

@Controller('mock-operator/nusalink/v1')
export class MockNusaLinkController {
  private readonly op: OperatorKey = 'nusalink';

  @Get('links')
  list(@Headers('authorization') auth?: string) {
    assertToken(this.op, bearer(auth));
    return {
      data: {
        links: OPERATORS.nusalink.links.map((l) => {
          const s = live(this.op, l);
          return {
            id: l.id,
            title: l.title,
            type: l.type,
            a_end: { city: l.from, lat: CITIES[l.from].lat, lng: CITIES[l.from].lng },
            z_end: { city: l.to, lat: CITIES[l.to].lat, lng: CITIES[l.to].lng },
            distance_km: l.km,
            capacity: { total_mbps: l.capMbps, free_mbps: s.free },
            metrics: {
              rtt_ms: s.rtt,
              loss_pct: s.lossPct,
              oper_status: s.oper,
              maintenance: s.planned,
            },
            sla: l.sla,
            redundancy: l.redundancy,
            pricing: { monthly: l.priceIdr, currency: 'IDR' },
            status: s.state,
          };
        }),
      },
    };
  }

  @Post('links/:id/lock')
  lock(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
    @Body() body: { ttlSeconds?: number },
  ) {
    assertToken(this.op, bearer(auth));
    const l = takeLock(this.op, id, body?.ttlSeconds ?? 900);
    return { lockId: l.id, expiresAt: l.expiresAt };
  }

  @Post('locks/:lockId/confirm')
  confirm(@Headers('authorization') auth: string | undefined, @Param('lockId') lockId: string) {
    assertToken(this.op, bearer(auth));
    lockOr404(this.op, lockId).confirmed = true;
    return { ok: true };
  }

  @Post('locks/:lockId/release')
  release(@Headers('authorization') auth: string | undefined, @Param('lockId') lockId: string) {
    assertToken(this.op, bearer(auth));
    lockOr404(this.op, lockId);
    locks.delete(lockId);
    return { ok: true };
  }
}

@Controller('mock-operator/garuda/api')
export class MockGarudaController {
  private readonly op: OperatorKey = 'garuda';

  @Get('inventory')
  list(@Headers('x-garuda-key') key?: string) {
    assertToken(this.op, key);
    return {
      items: OPERATORS.garuda.links.map((l) => {
        const s = live(this.op, l);
        return {
          link_ref: l.id,
          label: l.title,
          category: l.type,
          from_city: l.from,
          from_lat: CITIES[l.from].lat,
          from_lon: CITIES[l.from].lng,
          to_city: l.to,
          to_lat: CITIES[l.to].lat,
          to_lon: CITIES[l.to].lng,
          km: l.km,
          cap_gbps: l.capMbps / 1000,
          avail_gbps: s.free / 1000,
          latency: s.rtt,
          loss: s.lossPct,
          oper: s.oper === 'up' ? 'OK' : s.oper === 'down' ? 'DOWN' : 'DEG',
          planned: s.planned,
          uptime_sla: l.sla,
          resilience: l.redundancy,
          price_idr_month: l.priceIdr,
          state: s.state === 'free' ? 'AVAIL' : s.state === 'busy' ? 'HELD' : 'DOWN',
        };
      }),
    };
  }

  @Post('inventory/:id/hold')
  hold(
    @Headers('x-garuda-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: { ttlSeconds?: number },
  ) {
    assertToken(this.op, key);
    const l = takeLock(this.op, id, body?.ttlSeconds ?? 900);
    return { hold: { id: l.id, valid_until: l.expiresAt } };
  }

  @Post('holds/:holdId/commit')
  commit(@Headers('x-garuda-key') key: string | undefined, @Param('holdId') holdId: string) {
    assertToken(this.op, key);
    lockOr404(this.op, holdId).confirmed = true;
    return { ok: true };
  }

  @Post('holds/:holdId/release')
  release(@Headers('x-garuda-key') key: string | undefined, @Param('holdId') holdId: string) {
    assertToken(this.op, key);
    lockOr404(this.op, holdId);
    locks.delete(holdId);
    return { ok: true };
  }
}

@Controller('mock-operator/incidents')
@UseGuards(AuthGuard)
@Perms('demo:manage')
export class MockIncidentController {
  constructor(
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
  ) {}

  private async enabled() {
    if (!(await this.settings.cfg<boolean>('demo.incidentInjection')))
      throw new NotFoundException();
  }

  @Post()
  async inject(
    @CurrentUser() u: AuthUser,
    @Body()
    b: {
      operator: OperatorKey;
      linkId: string;
      kind: Incident['kind'];
      durationMin?: number;
      lossPct?: number;
      latencyFactor?: number;
    },
  ) {
    await this.enabled();
    if (!(b.operator in OPERATORS) || !['DEGRADATION', 'OUTAGE', 'MAINTENANCE'].includes(b.kind)) {
      throw new NotFoundException();
    }
    findLink(b.operator, b.linkId);
    const inc: Incident = {
      id: randomUUID(),
      op: b.operator,
      linkId: b.linkId,
      kind: b.kind,
      expires: Date.now() + Math.min(Math.max(b.durationMin ?? 10, 1), 240) * 60_000,
      lossPct: Math.min(100, Math.max(0, b.lossPct ?? 3)),
      latencyFactor: Math.min(10, Math.max(1, b.latencyFactor ?? 2)),
    };
    incidents.set(inc.id, inc);
    await this.ledger.appendSafe({
      eventType: 'ADMIN_ACTION',
      status: 'SUCCESS',
      action: 'demo.incident.injected',
      actorUserId: u.sub,
      requestPayload: { operator: b.operator, linkId: b.linkId, kind: b.kind },
    });
    return { id: inc.id, expiresAt: new Date(inc.expires).toISOString() };
  }

  @Get()
  async list() {
    await this.enabled();
    return [...incidents.values()].filter((i) => i.expires > Date.now());
  }

  @Delete(':id')
  async clear(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.enabled();
    incidents.delete(id);
    await this.ledger.appendSafe({
      eventType: 'ADMIN_ACTION',
      status: 'SUCCESS',
      action: 'demo.incident.cleared',
      actorUserId: u.sub,
      entityId: id,
    });
    return { ok: true };
  }
}
