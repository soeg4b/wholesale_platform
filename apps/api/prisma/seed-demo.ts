// DEMO SEED ONLY. Every fabricated row here carries isDemo=true so it can be excluded from metrics
// (platform_settings demo.countInMetrics) and is shown with a "Demo data" badge in the UI.
import { Prisma, PrismaClient } from '@prisma/client';
import { dayKey, routeKeyOf } from '../src/common/nodes';

const DAY = 86400_000;

// Small deterministic PRNG so repeated seeds produce the same demo story.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LinkRef {
  id: string;
  externalId: string | null;
  originName: string;
  destinationName: string;
  latencyMs: number | null;
  capacityMbps: number | null;
  availableMbps: number | null;
  operatorProfileId: string;
  slaPercent: number | null;
}

export async function seedDemo(
  prisma: PrismaClient,
  opts: { buyerId: string; operatorUserIds: Record<string, string>; bcryptHash: string },
) {
  const rand = rng(20261018);
  const links = (await prisma.networkLink.findMany({ where: { deletedAt: null } })) as LinkRef[];
  const byExt = (ext: string) => {
    const l = links.find((x) => x.externalId === ext);
    if (!l) throw new Error(`demo seed: link ${ext} missing`);
    return l;
  };
  const tz = 'Asia/Jakarta';
  const now = Date.now();

  // ---- reset previous demo rows (never touches real rows) ----
  await prisma.$executeRaw`DELETE FROM link_ticket_updates WHERE "ticketId" IN (SELECT id FROM link_tickets WHERE "isDemo")`;
  await prisma.$executeRaw`DELETE FROM link_tickets WHERE "isDemo"`;
  await prisma.linkInteraction.deleteMany({ where: { isDemo: true } });
  await prisma.linkMetricSnapshot.deleteMany({});
  await prisma.reservation.deleteMany({ where: { isDemo: true } });

  // ---- demo buyers (cannot log in: no password hash) ----
  const buyerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'PENYEWA' } });
  const demoBuyers: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const email = `demo.buyer${String(i).padStart(2, '0')}@demo.wnmp.test`;
    const u = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        fullName: `Demo Buyer ${i}`,
        status: 'ACTIVE',
        locale: 'ID',
        passwordHash: null,
      },
      update: {},
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: u.id, roleId: buyerRole.id } },
      create: { userId: u.id, roleId: buyerRole.id },
      update: {},
    });
    await prisma.buyerProfile.upsert({
      where: { userId: u.id },
      create: { userId: u.id, companyName: `PT Demo Pelanggan ${i}` },
      update: {},
    });
    demoBuyers.push(u.id);
  }

  // ---- 30 days of telemetry (every 3h). Two links get none, to exercise the "not yet rated" state. ----
  const noHistory = new Set([byExt('NL-JKT-BDG').id, byExt('GF-1004').id]);
  const growth: Record<string, number> = {
    'NL-SBY-DPS': 0.5,
    'NL-JKT-SBY-N': 0.18,
    'GF-1001': 0.1,
    'GF-1003': 0.12,
  };
  const unstable = byExt('NL-JKT-SBY-S').id;
  const snaps: Prisma.LinkMetricSnapshotCreateManyInput[] = [];
  for (const l of links) {
    if (noHistory.has(l.id) || l.latencyMs === null) continue;
    const util0 =
      l.capacityMbps && l.availableMbps !== null
        ? 100 * (1 - l.availableMbps / l.capacityMbps)
        : null;
    const slope = growth[l.externalId ?? ''] ?? 0.03;
    for (let i = 1; i <= 240; i++) {
      const spike = l.id === unstable && rand() < 0.1;
      const lat = l.latencyMs * (1 + (rand() - 0.5) * 0.06) * (spike ? 1.9 : 1);
      const util =
        util0 === null
          ? null
          : Math.max(1, Math.min(100, util0 - slope * ((i * 3) / 24) + (rand() - 0.5) * 2));
      snaps.push({
        networkLinkId: l.id,
        latencyMs: Math.round(lat * 100) / 100,
        availableMbps:
          l.capacityMbps && util !== null ? Math.round(l.capacityMbps * (1 - util / 100)) : null,
        utilizationPct: util === null ? null : Math.round(util * 10) / 10,
        lossPct: 0,
        opStatus: 'UP',
        recordedAt: new Date(now - i * 3 * 3600_000),
        isDemo: true,
      });
    }
  }
  await prisma.linkMetricSnapshot.createMany({ data: snaps });

  // ---- demand: 14 days of buyer activity; the Jakarta-Surabaya route is rising, Surabaya-Denpasar is scarce ----
  const jkSby = [byExt('NL-JKT-SBY-N'), byExt('NL-JKT-SBY-S'), byExt('GF-1001')];
  const sbyDps = byExt('NL-SBY-DPS');
  type Plan = {
    link?: LinkRef;
    from?: string;
    to?: string;
    type: 'SEARCH' | 'VIEW' | 'CART_ADD' | 'RESERVE';
    prev: number;
    cur: number;
    unmet?: boolean;
  };
  const plans: Plan[] = [
    { from: 'Jakarta', to: 'Surabaya', type: 'SEARCH', prev: 0.35, cur: 0.8 },
    { link: jkSby[0], type: 'VIEW', prev: 0.3, cur: 0.7 },
    { link: jkSby[0], type: 'CART_ADD', prev: 0.08, cur: 0.25 },
    { link: jkSby[0], type: 'RESERVE', prev: 0.03, cur: 0.1 },
    { link: jkSby[1], type: 'VIEW', prev: 0.15, cur: 0.2 },
    { link: jkSby[2], type: 'VIEW', prev: 0.2, cur: 0.3 },
    { from: 'Surabaya', to: 'Denpasar', type: 'SEARCH', prev: 0.5, cur: 0.6 },
    { link: sbyDps, type: 'VIEW', prev: 0.4, cur: 0.5 },
    { link: sbyDps, type: 'CART_ADD', prev: 0.12, cur: 0.18 },
    { from: 'Medan', to: 'Batam', type: 'SEARCH', prev: 0.2, cur: 0.25 },
    { from: 'Medan', to: 'Denpasar', type: 'SEARCH', prev: 0.4, cur: 0.5, unmet: true },
  ];
  const interactions: Prisma.LinkInteractionCreateManyInput[] = [];
  for (let d = 13; d >= 0; d--) {
    const at = new Date(now - d * DAY - 3600_000 * (1 + rand() * 10));
    const day = dayKey(tz, at);
    for (const uid of demoBuyers) {
      for (const p of plans) {
        if (rand() > (d < 7 ? p.cur : p.prev)) continue;
        const rk = p.link
          ? routeKeyOf(p.link.originName, p.link.destinationName)
          : routeKeyOf(p.from!, p.to!);
        interactions.push({
          userId: uid,
          networkLinkId: p.link?.id ?? null,
          routeKey: rk,
          type: p.type,
          unmet: !!p.unmet,
          counted: true,
          countedKey: `${uid}|${p.link?.id ?? rk}|${p.type}|${day}`,
          isDemo: true,
          createdAt: at,
        });
      }
    }
  }
  await prisma.linkInteraction.createMany({ data: interactions, skipDuplicates: true });

  // ---- rentals (demo reservations) so add-on advice and the buyer ticket flow have something to work with ----
  const rentals: [string, string[]][] = [
    [opts.buyerId, ['NL-JKT-SBY-N']],
    [demoBuyers[0], ['NL-JKT-SBY-N', 'NL-JKT-MDN']],
    [demoBuyers[1], ['NL-JKT-SBY-S', 'NL-SBY-DPS']],
    [demoBuyers[2], ['NL-JKT-MDN']],
    [demoBuyers[3], ['GF-1001', 'GF-1003']],
  ];
  let n = 0;
  for (const [buyerUserId, exts] of rentals) {
    const items = exts.map((e) => byExt(e));
    // Real monthly prices and staggered start dates feed provider income/customer trends.
    const price = (l: LinkRef) => Number((l as LinkRef & { basePrice: unknown }).basePrice ?? 0);
    const subtotal = new Prisma.Decimal(items.reduce((s, l) => s + price(l), 0));
    const createdAt = new Date(now - n * 32 * DAY);
    await prisma.reservation.create({
      data: {
        reference: `RSV-DEMO-${String(++n).padStart(4, '0')}`,
        buyerUserId,
        status: 'CONFIRMED',
        isDemo: true,
        subtotal,
        taxAmount: 0,
        totalAmount: subtotal,
        createdAt,
        items: {
          create: items.map((l) => ({
            networkLinkId: l.id,
            termMonths: 12,
            unitPrice: price(l),
            lineTotal: price(l),
            lockStatus: 'CONFIRMED' as const,
          })),
        },
      },
    });
  }

  // ---- tickets ----
  const sla = {
    SEV1: { a: 15, r: 240 },
    SEV2: { a: 60, r: 480 },
    SEV3: { a: 240, r: 1440 },
  } as const;
  type T = {
    ext: string;
    source: 'BUYER' | 'OPERATOR' | 'SYSTEM';
    kind: 'OUTAGE' | 'DEGRADATION' | 'OTHER';
    sev: 'SEV1' | 'SEV2' | 'SEV3';
    ago: number;
    ack: number;
    res: number;
    outage?: number;
    title: string;
  };
  const tickets: T[] = [
    {
      ext: 'NL-JKT-SBY-N',
      source: 'SYSTEM',
      kind: 'DEGRADATION',
      sev: 'SEV2',
      ago: 21,
      ack: 20,
      res: 180,
      title: 'Latency degradation',
    },
    {
      ext: 'NL-JKT-SBY-N',
      source: 'BUYER',
      kind: 'OTHER',
      sev: 'SEV3',
      ago: 12,
      ack: 90,
      res: 600,
      title: 'Request: VLAN change',
    },
    {
      ext: 'NL-JKT-SBY-N',
      source: 'OPERATOR',
      kind: 'OTHER',
      sev: 'SEV3',
      ago: 9,
      ack: 10,
      res: 120,
      title: 'Planned fibre splice notice',
    },
    {
      ext: 'NL-JKT-SBY-N',
      source: 'BUYER',
      kind: 'DEGRADATION',
      sev: 'SEV2',
      ago: 5,
      ack: 40,
      res: 300,
      title: 'Intermittent packet loss',
    },
    {
      ext: 'NL-JKT-SBY-N',
      source: 'SYSTEM',
      kind: 'OUTAGE',
      sev: 'SEV1',
      ago: 3,
      ack: 5,
      res: 40,
      outage: 40,
      title: 'Link down',
    },
    {
      ext: 'NL-JKT-SBY-S',
      source: 'SYSTEM',
      kind: 'OUTAGE',
      sev: 'SEV1',
      ago: 16,
      ack: 35,
      res: 400,
      outage: 380,
      title: 'Link down after cable cut',
    },
    {
      ext: 'NL-JKT-SBY-S',
      source: 'BUYER',
      kind: 'OUTAGE',
      sev: 'SEV1',
      ago: 16,
      ack: 50,
      res: 420,
      title: 'Total loss of traffic',
    },
    {
      ext: 'NL-JKT-SBY-S',
      source: 'SYSTEM',
      kind: 'DEGRADATION',
      sev: 'SEV2',
      ago: 10,
      ack: 90,
      res: 700,
      title: 'Latency spikes',
    },
    {
      ext: 'NL-JKT-SBY-S',
      source: 'BUYER',
      kind: 'DEGRADATION',
      sev: 'SEV2',
      ago: 6,
      ack: 45,
      res: 520,
      title: 'Jitter affecting voice',
    },
    {
      ext: 'NL-JKT-SBY-S',
      source: 'SYSTEM',
      kind: 'DEGRADATION',
      sev: 'SEV2',
      ago: 2,
      ack: 30,
      res: 240,
      title: 'Latency spikes',
    },
    {
      ext: 'GF-1001',
      source: 'BUYER',
      kind: 'OTHER',
      sev: 'SEV3',
      ago: 8,
      ack: 60,
      res: 480,
      title: 'Billing question',
    },
    {
      ext: 'GF-1001',
      source: 'SYSTEM',
      kind: 'DEGRADATION',
      sev: 'SEV2',
      ago: 4,
      ack: 15,
      res: 120,
      title: 'Latency degradation',
    },
    {
      ext: 'NL-SBY-DPS',
      source: 'BUYER',
      kind: 'OTHER',
      sev: 'SEV3',
      ago: 7,
      ack: 100,
      res: 900,
      title: 'Capacity inquiry',
    },
  ];
  for (const [i, t] of tickets.entries()) {
    const link = byExt(t.ext);
    const created = new Date(now - t.ago * DAY);
    const ackAt = new Date(created.getTime() + t.ack * 60_000);
    const resolvedAt = new Date(created.getTime() + t.res * 60_000);
    const due = sla[t.sev];
    const reporter =
      t.source === 'SYSTEM'
        ? null
        : t.source === 'OPERATOR'
          ? Object.values(opts.operatorUserIds)[link.externalId?.startsWith('GF') ? 1 : 0]
          : demoBuyers[i % demoBuyers.length];
    const [{ n: ticketNo }] = await prisma.$queryRaw<
      { n: number }[]
    >`SELECT nextval(pg_get_serial_sequence('link_tickets','ticketNo'))::int AS n`;
    const row = await prisma.linkTicket.create({
      data: {
        ticketNo,
        reference: `TKT-${new Date(created).getFullYear()}-${String(ticketNo).padStart(6, '0')}`,
        networkLinkId: link.id,
        operatorProfileId: link.operatorProfileId,
        reporterUserId: reporter,
        source: t.source,
        kind: t.kind,
        severity: t.sev,
        status: 'CLOSED',
        title: t.title,
        description: `${t.title} (demo ticket)`,
        createdAt: created,
        ackDueAt: new Date(created.getTime() + due.a * 60_000),
        resolveDueAt: new Date(created.getTime() + due.r * 60_000),
        ackAt,
        resolvedAt,
        closedAt: new Date(resolvedAt.getTime() + 6 * 3600_000),
        ackBreachedAt: t.ack > due.a ? new Date(created.getTime() + due.a * 60_000) : null,
        resolveBreachedAt: t.res > due.r ? new Date(created.getTime() + due.r * 60_000) : null,
        incidentStartAt: t.source === 'SYSTEM' ? created : null,
        incidentEndAt:
          t.source === 'SYSTEM' ? new Date(created.getTime() + (t.outage ?? t.res) * 60_000) : null,
        isDemo: true,
      },
    });
    await prisma.linkTicketUpdate.createMany({
      data: [
        {
          ticketId: row.id,
          actorUserId: reporter,
          type: 'CREATED',
          toStatus: 'OPEN',
          message: t.title,
          createdAt: created,
        },
        {
          ticketId: row.id,
          type: 'STATUS_CHANGE',
          fromStatus: 'OPEN',
          toStatus: 'ACKNOWLEDGED',
          createdAt: ackAt,
        },
        {
          ticketId: row.id,
          type: 'STATUS_CHANGE',
          fromStatus: 'ACKNOWLEDGED',
          toStatus: 'RESOLVED',
          createdAt: resolvedAt,
        },
        {
          ticketId: row.id,
          type: 'STATUS_CHANGE',
          fromStatus: 'RESOLVED',
          toStatus: 'CLOSED',
          message: 'Auto-closed',
          createdAt: new Date(resolvedAt.getTime() + 6 * 3600_000),
        },
      ],
    });
  }
  return {
    snapshots: snaps.length,
    interactions: interactions.length,
    tickets: tickets.length,
    demoBuyers: demoBuyers.length,
  };
}
