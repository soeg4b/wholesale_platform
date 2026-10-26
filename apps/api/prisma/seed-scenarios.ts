// DEMO SEED (iteration 3): reference locations plus one login per business scenario.
// Every fabricated row carries isDemo=true and is rebuilt on each run.
import { readFileSync } from 'fs';
import { join } from 'path';
import { AccountStatus, ApprovalStatus, Prisma, PrismaClient } from '@prisma/client';

const DAY = 86400_000;

interface Ctx {
  upsertUser: (
    email: string,
    fullName: string,
    roleKey: string,
    locale: 'ID' | 'EN',
  ) => Promise<{ id: string }>;
  adminId: string;
  buyerId: string;
  operators: { nusa: string; garuda: string; nusaUser: string };
}

export async function seedReferenceLocations(prisma: PrismaClient) {
  const rows = JSON.parse(
    readFileSync(join(__dirname, 'data', 'reference-locations.json'), 'utf8'),
  ) as { name: string; province: string; lat: number; lng: number }[];
  for (const r of rows)
    await prisma.referenceLocation.upsert({
      where: { name: r.name },
      create: r,
      update: {},
    });
  return rows.length;
}

export async function seedScenarios(prisma: PrismaClient, ctx: Ctx) {
  const now = Date.now();
  const loc = async (name: string) =>
    prisma.referenceLocation.findUniqueOrThrow({ where: { name } });
  const link = (ext: string) =>
    prisma.networkLink.findFirstOrThrow({ where: { externalId: ext, deletedAt: null } });

  // ---- reset previous scenario rows ----
  await prisma.notification.deleteMany({ where: { isDemo: true } });
  await prisma.prebuildProduct.deleteMany({ where: { isDemo: true } });
  await prisma.linkRequest.deleteMany({ where: { isDemo: true } });
  await prisma.operatorReview.deleteMany({ where: { isDemo: true } });
  await prisma.walletEntry.deleteMany({ where: { isDemo: true } });
  await prisma.reservation.deleteMany({
    where: { isDemo: true, reference: { startsWith: 'RSV-SCN-' } },
  });

  const setStatus = (id: string, status: AccountStatus) =>
    prisma.user.update({ where: { id }, data: { status } });
  const buyer = async (
    email: string,
    fullName: string,
    company: string,
    extra: Partial<Prisma.BuyerProfileUncheckedCreateInput> = {},
  ) => {
    const u = await ctx.upsertUser(email, fullName, 'PENYEWA', 'ID');
    const p = await prisma.buyerProfile.upsert({
      where: { userId: u.id },
      create: { userId: u.id, companyName: company, ...extra },
      update: { companyName: company, ...extra },
    });
    return { userId: u.id, profileId: p.id };
  };
  const operator = async (o: {
    email: string;
    fullName: string;
    slug: string;
    displayName: string;
    legalName: string;
    status: ApprovalStatus;
    rejectionReason?: string;
  }) => {
    const u = await ctx.upsertUser(o.email, o.fullName, 'PENYELENGGARA', 'ID');
    const data = {
      slug: o.slug,
      legalName: o.legalName,
      displayName: o.displayName,
      description: {
        id: `${o.displayName} - penyedia konektivitas regional.`,
        en: `${o.displayName} - regional connectivity provider.`,
      },
      contactEmail: o.email,
      contactPhone: '+62 21 5550 1000',
      approvalStatus: o.status,
      rejectionReason: o.rejectionReason ?? null,
      reviewedById: o.status === 'PENDING' ? null : ctx.adminId,
      reviewedAt: o.status === 'PENDING' ? null : new Date(),
    };
    return prisma.operatorProfile.upsert({
      where: { userId: u.id },
      create: { userId: u.id, ...data },
      update: data,
    });
  };

  // ---- providers: manual-only builder, rejected, suspended ----
  const borneo = await operator({
    email: 'operator@borneo.wnmp.test',
    fullName: 'Dewi Builder',
    slug: 'borneo-link',
    displayName: 'Borneo Link',
    legalName: 'PT Borneo Link Nusantara',
    status: 'APPROVED',
  });
  await operator({
    email: 'rejected@operator.wnmp.test',
    fullName: 'Joko Rejected',
    slug: 'rejected-net',
    displayName: 'Rejected Net',
    legalName: 'PT Rejected Net',
    status: 'REJECTED',
    rejectionReason: 'Telecom licence number could not be verified',
  });
  await operator({
    email: 'suspended@operator.wnmp.test',
    fullName: 'Tono Suspended',
    slug: 'suspended-fiber',
    displayName: 'Suspended Fiber',
    legalName: 'PT Suspended Fiber',
    status: 'SUSPENDED',
  });
  const [ptk, bpn, bjm, jkt, sby, mks, mdn, dps, jyp] = await Promise.all(
    [
      'Pontianak',
      'Balikpapan',
      'Banjarmasin',
      'Jakarta',
      'Surabaya',
      'Makassar',
      'Medan',
      'Denpasar',
      'Jayapura',
    ].map(loc),
  );
  const manual = [
    { ext: 'BL-PTK-BPN', a: ptk, z: bpn, km: 1120, cap: 20000, lat: 14.5, price: 72000000 },
    { ext: 'BL-BJM-BPN', a: bjm, z: bpn, km: 410, cap: 10000, lat: 6.1, price: 31000000 },
  ];
  for (const m of manual) {
    const data = {
      name: { id: `${m.a.name} - ${m.z.name}`, en: `${m.a.name} - ${m.z.name}` },
      category: 'DARK_FIBER',
      status: 'ACTIVE' as const,
      originName: m.a.name,
      originLat: m.a.lat,
      originLng: m.a.lng,
      destinationName: m.z.name,
      destinationLat: m.z.lat,
      destinationLng: m.z.lng,
      distanceKm: m.km,
      capacityMbps: m.cap,
      availableMbps: m.cap,
      latencyMs: m.lat,
      slaPercent: 99.5,
      redundancyScore: 0.4,
      basePrice: m.price,
      minTermMonths: 12,
    };
    await prisma.networkLink.upsert({
      where: { operatorProfileId_externalId: { operatorProfileId: borneo.id, externalId: m.ext } },
      create: { ...data, operatorProfileId: borneo.id, externalId: m.ext },
      update: data,
    });
  }

  // ---- buyers: one per billing scenario ----
  const main = await prisma.buyerProfile.update({
    where: { userId: ctx.buyerId },
    data: { monthlyBudget: 300000000, alertThresholdPct: 80 },
  });
  const low = await buyer('buyer.lowbalance@demo.wnmp.test', 'Rudi Saldo Tipis', 'PT Data Kilat');
  const over = await buyer(
    'buyer.overbudget@demo.wnmp.test',
    'Maya Over Budget',
    'PT Retail Digital',
    {
      monthlyBudget: 100000000,
      alertThresholdPct: 80,
    },
  );
  const fresh = await buyer('buyer.new@demo.wnmp.test', 'Sinta Pelanggan Baru', 'PT Startup Baru');
  const early = await buyer(
    'buyer.earlybird@demo.wnmp.test',
    'Hendra Early Bird',
    'PT Smart Factory',
    {
      monthlyBudget: 200000000,
    },
  );
  const susp = await buyer('buyer.suspended@demo.wnmp.test', 'Agus Suspended', 'PT Ditangguhkan');
  await setStatus(susp.userId, 'SUSPENDED');

  // ---- scenario rentals (real monthly prices) ----
  let seq = 0;
  const rent = async (
    userId: string,
    profileId: string,
    exts: string[],
    monthsAgo: number,
    term = 12,
  ) => {
    const links = await Promise.all(exts.map(link));
    const total = links.reduce((s, l) => s + Number(l.basePrice ?? 0), 0);
    return prisma.reservation.create({
      data: {
        reference: `RSV-SCN-${String(++seq).padStart(4, '0')}`,
        buyerUserId: userId,
        buyerProfileId: profileId,
        status: 'CONFIRMED',
        isDemo: true,
        subtotal: total,
        totalAmount: total,
        createdAt: new Date(now - monthsAgo * 30.5 * DAY),
        items: {
          create: links.map((l) => ({
            networkLinkId: l.id,
            termMonths: term,
            unitPrice: l.basePrice ?? 0,
            lineTotal: l.basePrice ?? 0,
            lockStatus: 'CONFIRMED' as const,
          })),
        },
      },
    });
  };
  const rLow = await rent(low.userId, low.profileId, ['GF-1001', 'NL-JKT-MDN'], 2);
  const rOver1 = await rent(over.userId, over.profileId, ['NL-JKT-SBY-S'], 5);
  const rOver2 = await rent(over.userId, over.profileId, ['NL-SBY-DPS'], 1);
  const rEarly = await rent(early.userId, early.profileId, ['GF-1005'], 11.5);
  const rMain = await rent(ctx.buyerId, main.id, ['GF-1002'], 3, 24);

  // ---- wallets (signed amounts; balance = sum) ----
  const wallet = (
    profileId: string,
    type: 'TOPUP' | 'CHARGE' | 'REFUND' | 'ADJUSTMENT',
    amount: number,
    daysAgo: number,
    desc: { id: string; en: string },
    reservationId?: string,
  ) => ({
    buyerProfileId: profileId,
    type,
    amount,
    reference: `${type}-DEMO-${daysAgo}`,
    description: desc,
    reservationId,
    isDemo: true,
    createdAt: new Date(now - daysAgo * DAY),
  });
  const topup = { id: 'Isi saldo via transfer bank', en: 'Top-up by bank transfer' };
  const pay = (ref: string) => ({ id: `Pembayaran ${ref}`, en: `Payment ${ref}` });
  await prisma.walletEntry.createMany({
    data: [
      wallet(main.id, 'TOPUP', 800000000, 120, topup),
      wallet(main.id, 'CHARGE', -98000000, 90, pay(rMain.reference), rMain.id),
      wallet(main.id, 'TOPUP', 200000000, 20, topup),
      wallet(low.profileId, 'TOPUP', 250000000, 70, topup),
      wallet(low.profileId, 'CHARGE', -232000000, 60, pay(rLow.reference), rLow.id),
      wallet(over.profileId, 'TOPUP', 500000000, 160, topup),
      wallet(over.profileId, 'CHARGE', -68000000, 150, pay(rOver1.reference), rOver1.id),
      wallet(over.profileId, 'CHARGE', -52000000, 30, pay(rOver2.reference), rOver2.id),
      wallet(early.profileId, 'TOPUP', 300000000, 350, topup),
      wallet(early.profileId, 'CHARGE', -44000000, 345, pay(rEarly.reference), rEarly.id),
      wallet(early.profileId, 'REFUND', 4000000, 200, { id: 'Kompensasi SLA', en: 'SLA credit' }),
      wallet(fresh.profileId, 'TOPUP', 50000000, 3, topup),
    ],
  });

  // ---- reviews ----
  const demoRes = await prisma.reservation.findMany({
    where: { isDemo: true, status: 'CONFIRMED' },
    include: { items: { include: { networkLink: true } } },
  });
  const ratings = [5, 4, 5, 3, 4, 5, 4, 2, 5];
  const comments = [
    'Latensi stabil, tim NOC responsif.',
    'Good capacity, provisioning took a few days longer than promised.',
    'Sangat puas, SLA terpenuhi.',
    'Ada gangguan sekali, tapi cepat ditangani.',
    'Pricing is competitive for long terms.',
    null,
    'Dokumentasi KMZ lengkap.',
    'Two outages in one month, please improve.',
    'Excellent.',
  ];
  let k = 0;
  for (const r of demoRes) {
    for (const opId of new Set(r.items.map((i) => i.networkLink.operatorProfileId))) {
      const i = k++ % ratings.length;
      await prisma.operatorReview.create({
        data: {
          operatorProfileId: opId,
          reservationId: r.id,
          networkLinkId: r.items.find((x) => x.networkLink.operatorProfileId === opId)!
            .networkLinkId,
          buyerUserId: r.buyerUserId,
          rating: ratings[i],
          comment: comments[i],
          reply: ratings[i] <= 3 ? 'Terima kasih, kami sudah menambah jalur cadangan.' : null,
          repliedAt: ratings[i] <= 3 ? new Date() : null,
          isDemo: true,
          createdAt: new Date(r.createdAt.getTime() + 20 * DAY),
        },
      });
    }
  }

  // ---- link requests (wish list visible to every provider) ----
  const demoBuyers = (
    await prisma.user.findMany({
      where: { email: { startsWith: 'demo.buyer' } },
      select: { id: true },
      orderBy: { email: 'asc' },
    })
  ).map((u) => u.id);
  const request = async (
    ref: string,
    userId: string,
    a: { name: string; lat: number; lng: number },
    z: { name: string; lat: number; lng: number },
    capacityMbps: number,
    extra: Partial<Prisma.LinkRequestUncheckedCreateInput>,
    voters: string[],
  ) =>
    prisma.linkRequest.create({
      data: {
        reference: ref,
        requesterUserId: userId,
        originName: a.name,
        originLat: a.lat,
        originLng: a.lng,
        destinationName: z.name,
        destinationLat: z.lat,
        destinationLng: z.lng,
        capacityMbps,
        isDemo: true,
        ...extra,
        votes: { create: voters.map((v) => ({ userId: v })) },
      },
    });
  const reqPtkJkt = await request(
    'REQ-DEMO-0001',
    fresh.userId,
    ptk,
    jkt,
    10000,
    {
      category: 'DARK_FIBER',
      termMonths: 36,
      budgetMonthly: 90000000,
      neededBy: new Date(now + 200 * DAY),
      notes: 'Data center baru di Pontianak, butuh backhaul ke Jakarta.',
      status: 'IN_PROGRESS',
    },
    demoBuyers.slice(0, 6),
  );
  await request(
    'REQ-DEMO-0002',
    fresh.userId,
    mks,
    bpn,
    5000,
    { category: 'WAVELENGTH', termMonths: 24, budgetMonthly: 45000000 },
    demoBuyers.slice(6, 8),
  );
  const reqMdnDps = await request(
    'REQ-DEMO-0003',
    ctx.buyerId,
    mdn,
    dps,
    20000,
    { category: 'IP_TRANSIT', termMonths: 12, notes: 'Searched often, no direct route today.' },
    demoBuyers.slice(2, 12),
  );
  await request(
    'REQ-DEMO-0004',
    early.userId,
    jyp,
    mks,
    2000,
    { termMonths: 60, neededBy: new Date(now + 365 * DAY) },
    [],
  );
  await prisma.linkRequestResponse.createMany({
    data: [
      {
        requestId: reqPtkJkt.id,
        operatorProfileId: borneo.id,
        message:
          'Kami sedang membangun kabel laut Pontianak - Jakarta, target Q3. Early bird tersedia.',
        proposedPrice: 82000000,
        etaDate: new Date(now + 150 * DAY),
      },
      {
        requestId: reqMdnDps.id,
        operatorProfileId: ctx.operators.garuda,
        message: 'We can offer a protected path via Jakarta and Surabaya within 90 days.',
        proposedPrice: 150000000,
        etaDate: new Date(now + 90 * DAY),
      },
    ],
  });

  // ---- pre-build products with early-bird pledges ----
  const product = async (
    opId: string,
    a: { name: string; lat: number; lng: number },
    z: { name: string; lat: number; lng: number },
    p: {
      category: string;
      cap: number;
      readyDays: number;
      progress: number;
      status: 'PLANNED' | 'BUILDING' | 'READY';
      base: number;
      early: number;
      earlyDays: number;
      slots: number;
      requestId?: string;
    },
  ) =>
    prisma.prebuildProduct.create({
      data: {
        operatorProfileId: opId,
        linkRequestId: p.requestId,
        name: { id: `${a.name} - ${z.name} (pra-bangun)`, en: `${a.name} - ${z.name} (pre-build)` },
        description: {
          id: 'Rute baru dengan harga early bird untuk komitmen awal.',
          en: 'New route with an early-bird price for early commitments.',
        },
        category: p.category,
        originName: a.name,
        originLat: a.lat,
        originLng: a.lng,
        destinationName: z.name,
        destinationLat: z.lat,
        destinationLng: z.lng,
        capacityMbps: p.cap,
        targetReadyDate: new Date(now + p.readyDays * DAY),
        progressPct: p.progress,
        status: p.status,
        basePrice: p.base,
        earlyBirdPrice: p.early,
        earlyBirdUntil: new Date(now + p.earlyDays * DAY),
        earlyBirdSlots: p.slots,
        isDemo: true,
      },
    });
  const pPtk = await product(borneo.id, ptk, jkt, {
    category: 'SUBSEA',
    cap: 100000,
    readyDays: 150,
    progress: 45,
    status: 'BUILDING',
    base: 90000000,
    early: 72000000,
    earlyDays: 60,
    slots: 5,
    requestId: reqPtkJkt.id,
  });
  const pBpn = await product(borneo.id, bpn, mks, {
    category: 'SUBSEA',
    cap: 40000,
    readyDays: 300,
    progress: 10,
    status: 'PLANNED',
    base: 80000000,
    early: 60000000,
    earlyDays: 120,
    slots: 3,
  });
  await product(ctx.operators.garuda, mdn, dps, {
    category: 'IP_TRANSIT',
    cap: 40000,
    readyDays: 90,
    progress: 25,
    status: 'BUILDING',
    base: 150000000,
    early: 128000000,
    earlyDays: 30,
    slots: 4,
    requestId: reqMdnDps.id,
  });
  const pBjm = await product(ctx.operators.nusa, bjm, sby, {
    category: 'DARK_FIBER',
    cap: 100000,
    readyDays: 14,
    progress: 90,
    status: 'READY',
    base: 58000000,
    early: 50000000,
    earlyDays: 7,
    slots: 2,
  });
  await prisma.prebuildCommitment.createMany({
    data: [
      {
        productId: pPtk.id,
        buyerUserId: early.userId,
        termMonths: 36,
        lockedPrice: 72000000,
        capacityMbps: 10000,
      },
      { productId: pPtk.id, buyerUserId: fresh.userId, termMonths: 36, lockedPrice: 72000000 },
      { productId: pPtk.id, buyerUserId: demoBuyers[0], termMonths: 24, lockedPrice: 72000000 },
      { productId: pBpn.id, buyerUserId: early.userId, termMonths: 24, lockedPrice: 60000000 },
      { productId: pBjm.id, buyerUserId: demoBuyers[1], termMonths: 12, lockedPrice: 50000000 },
      { productId: pBjm.id, buyerUserId: demoBuyers[2], termMonths: 12, lockedPrice: 50000000 },
    ].map((c) => ({ ...c, isDemo: true })),
  });

  // ---- notification preferences and inbox ----
  await prisma.notificationPreference.upsert({
    where: { userId_category: { userId: fresh.userId, category: 'PROMO' } },
    create: {
      userId: fresh.userId,
      category: 'PROMO',
      enabled: true,
      channels: ['IN_APP', 'EMAIL'],
      filters: { cities: ['Jakarta', 'Pontianak'] },
    },
    update: {},
  });
  await prisma.notificationPreference.upsert({
    where: { userId_category: { userId: fresh.userId, category: 'DISCOUNT' } },
    create: { userId: fresh.userId, category: 'DISCOUNT', enabled: false, channels: ['IN_APP'] },
    update: {},
  });
  const pantura = await link('NL-JKT-SBY-N');
  const inbox = (userId: string) => [
    {
      userId,
      category: 'PROMO' as const,
      title: {
        id: 'Promo 7% dari NusaLink Backbone (Jakarta - Surabaya)',
        en: 'Promo 7% from NusaLink Backbone (Jakarta - Surabaya)',
      },
      body: { id: 'Hot route promo: Pantura 7% off', en: 'Hot route promo: Pantura 7% off' },
      href: `/links/${pantura.id}`,
      isDemo: true,
      createdAt: new Date(now - 2 * DAY),
    },
    {
      userId,
      category: 'EARLY_BIRD' as const,
      title: {
        id: 'Early bird 20%: Pontianak - Jakarta oleh Borneo Link',
        en: 'Early bird 20% off: Pontianak - Jakarta by Borneo Link',
      },
      href: `/prebuild#${pPtk.id}`,
      isDemo: true,
      createdAt: new Date(now - DAY),
    },
  ];
  await prisma.notification.createMany({
    data: [
      ...inbox(ctx.buyerId),
      ...inbox(early.userId),
      {
        userId: ctx.operators.nusaUser,
        category: 'LINK_REQUEST',
        title: {
          id: 'Permintaan link baru: Medan - Denpasar',
          en: 'New link request: Medan - Denpasar',
        },
        href: `/requests#${reqMdnDps.id}`,
        isDemo: true,
      },
    ],
  });

  return {
    providers: [
      'operator@borneo.wnmp.test',
      'rejected@operator.wnmp.test',
      'suspended@operator.wnmp.test',
    ],
    buyers: [
      'buyer.lowbalance@demo.wnmp.test',
      'buyer.overbudget@demo.wnmp.test',
      'buyer.new@demo.wnmp.test',
      'buyer.earlybird@demo.wnmp.test',
      'buyer.suspended@demo.wnmp.test',
    ],
  };
}
