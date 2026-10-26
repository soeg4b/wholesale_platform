import 'dotenv/config';
import AdmZip from 'adm-zip';
import * as bcrypt from 'bcryptjs';
import { PrismaClient, Prisma } from '@prisma/client';
import { CryptoService } from '../src/common/crypto.service';
import { LedgerService } from '../src/common/ledger.service';
import { GenericRestAdapter } from '../src/integrations/generic-rest.adapter';
import { AdapterRegistry, SyncService } from '../src/integrations/sync.service';
import { buildKml, parseGeo } from '../src/geo/kmz-parser';
import {
  MockGarudaController,
  MockNusaLinkController,
} from '../src/mock-operator/mock-operator.controller';
import { OPERATORS } from '../src/mock-operator/fixtures';
import { applyLedgerTriggers } from './apply-triggers';
import { SETTING_DEFAULTS } from '../src/common/settings-defaults';
import { SettingsService } from '../src/common/settings.service';
import { TicketsService } from '../src/tickets/tickets.module';
import { IncidentDetector } from '../src/quality/incident-detector';
import { TelemetryService } from '../src/quality/telemetry.service';
import { PerformanceService } from '../src/quality/quality.module';
import { seedDemo } from './seed-demo';
import { seedReferenceLocations, seedScenarios } from './seed-scenarios';

const prisma = new PrismaClient();
const crypto = new CryptoService();
const ledger = new LedgerService(prisma as never);
const settings = new SettingsService(prisma as never);
const tickets = new TicketsService(prisma as never, ledger, settings);
const telemetry = new TelemetryService(
  prisma as never,
  settings,
  new IncidentDetector(prisma as never, settings, tickets),
);
const DEMO_PASSWORD = 'Demo@12345';
const API = process.env.PUBLIC_API_URL || 'http://localhost:4000';

const PERMISSIONS: Record<string, { id: string; en: string }> = {
  'link:read': { id: 'Melihat marketplace link', en: 'Browse marketplace links' },
  'link:write': { id: 'Mengelola link jaringan', en: 'Manage network links' },
  'apiconfig:manage': { id: 'Mengelola integrasi API', en: 'Manage API integrations' },
  'geo:upload': { id: 'Unggah KMZ/KML', en: 'Upload KMZ/KML' },
  'pricing:manage': { id: 'Mengelola aturan harga', en: 'Manage pricing rules' },
  'reservation:create': { id: 'Reservasi dan pembayaran', en: 'Reserve and pay' },
  'ai:analyze': { id: 'Analisis AI', en: 'Use AI analysis' },
  'operator:approve': { id: 'Menyetujui penyelenggara', en: 'Approve operators' },
  'user:manage': { id: 'Mengelola pengguna', en: 'Manage users' },
  'ledger:read': { id: 'Melihat buku besar transaksi', en: 'View transaction ledger' },
  'ticket:create': { id: 'Membuat tiket gangguan', en: 'Open trouble tickets' },
  'ticket:manage': { id: 'Mengelola tiket gangguan', en: 'Manage trouble tickets' },
  'insight:read': { id: 'Melihat insight AI penjual', en: 'View seller AI insights' },
  'addon:manage': { id: 'Mengelola katalog add-on', en: 'Manage add-on catalog' },
  'demo:manage': { id: 'Mengelola fitur demo', en: 'Manage demo tooling' },
  'request:create': { id: 'Mengajukan permintaan link baru', en: 'Request new links' },
  'request:respond': { id: 'Menanggapi permintaan link', en: 'Respond to link requests' },
  'prebuild:manage': { id: 'Mengelola produk pra-bangun', en: 'Manage pre-build products' },
  'prebuild:commit': { id: 'Komitmen early bird', en: 'Commit to early-bird offers' },
  'review:create': { id: 'Memberi ulasan penyedia', en: 'Review providers' },
  'data:export': { id: 'Ekspor data', en: 'Export data' },
  'data:manage': { id: 'Mengelola data referensi', en: 'Manage reference data' },
};

const ROLES: Record<string, { name: { id: string; en: string }; perms: string[] }> = {
  ADMIN: { name: { id: 'Administrator', en: 'Administrator' }, perms: Object.keys(PERMISSIONS) },
  PENYELENGGARA: {
    name: { id: 'Penyelenggara', en: 'Operator' },
    perms: [
      'link:read',
      'link:write',
      'apiconfig:manage',
      'geo:upload',
      'pricing:manage',
      'ticket:manage',
      'insight:read',
      'addon:manage',
      'request:respond',
      'prebuild:manage',
    ],
  },
  PENYEWA: {
    name: { id: 'Penyewa', en: 'Buyer' },
    perms: [
      'link:read',
      'reservation:create',
      'ai:analyze',
      'ticket:create',
      'request:create',
      'prebuild:commit',
      'review:create',
    ],
  },
};

const SETTINGS: Record<string, { value: unknown; description: string }> = {
  'payment.provider': {
    value: 'mock',
    description: 'Active payment provider key (mock | midtrans)',
  },
  'ai.provider': {
    value: 'auto',
    description: 'AI provider (auto | anthropic | openai | rule-based)',
  },
  'ai.model.anthropic': { value: 'claude-sonnet-4-5', description: 'Anthropic model id' },
  'ai.model.openai': { value: 'gpt-4o-mini', description: 'OpenAI model id' },
  'ai.hourly_limit': { value: 30, description: 'AI analyses per user per hour' },
  'reservation.lock_ttl_seconds': { value: 900, description: 'Operator lock TTL during checkout' },
  'tax.rate': { value: 0.11, description: 'VAT rate applied at checkout' },
};

async function seedRbac() {
  for (const [key, d] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, description: d },
      update: { description: d },
    });
  }
  for (const [key, r] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { key },
      create: { key, name: r.name, isSystem: true },
      update: { name: r.name },
    });
    const perms = await prisma.permission.findMany({ where: { key: { in: r.perms } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }
  for (const [key, s] of Object.entries(SETTINGS)) {
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: s.value as Prisma.InputJsonValue, description: s.description },
      update: {},
    });
  }
  // Tunable thresholds (admins edit these; re-seeding never overwrites them).
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, description: 'Tunable threshold' },
      update: {},
    });
  }
  // DEMO SEED overrides: count demo rows, allow incident injection, sample telemetry on every sync.
  const demoOverrides: Record<string, unknown> = {
    'demo.countInMetrics': true,
    'demo.incidentInjection': true,
    'telemetry.pollMinutes': 0,
    'perf.previewDays': 0,
    'demo.showAccounts': true,
    'demo.accounts': {
      password: DEMO_PASSWORD,
      accounts: (
        [
          [
            'buyer@demo.wnmp.test',
            'Penyewa (aktif, saldo cukup)',
            'Buyer (active, healthy balance)',
          ],
          ['buyer.lowbalance@demo.wnmp.test', 'Penyewa (saldo rendah)', 'Buyer (low balance)'],
          ['buyer.overbudget@demo.wnmp.test', 'Penyewa (melebihi anggaran)', 'Buyer (over budget)'],
          [
            'buyer.earlybird@demo.wnmp.test',
            'Penyewa (early bird, sewa hampir habis)',
            'Buyer (early bird, rental expiring)',
          ],
          [
            'buyer.new@demo.wnmp.test',
            'Penyewa baru (permintaan link)',
            'New buyer (link requests)',
          ],
          [
            'buyer.suspended@demo.wnmp.test',
            'Penyewa ditangguhkan (tidak bisa masuk)',
            'Suspended buyer (cannot log in)',
          ],
          ['operator@nusalink.wnmp.test', 'Penyedia NusaLink (API)', 'Provider NusaLink (API)'],
          [
            'operator@garuda.wnmp.test',
            'Penyedia Garuda Fiber (API)',
            'Provider Garuda Fiber (API)',
          ],
          [
            'operator@borneo.wnmp.test',
            'Penyedia Borneo Link (manual + pra-bangun)',
            'Provider Borneo Link (manual + pre-build)',
          ],
          [
            'pending@operator.wnmp.test',
            'Penyedia menunggu persetujuan',
            'Provider pending approval',
          ],
          ['rejected@operator.wnmp.test', 'Penyedia ditolak', 'Provider rejected'],
          ['suspended@operator.wnmp.test', 'Penyedia ditangguhkan', 'Provider suspended'],
          ['admin@demo.wnmp.test', 'Admin', 'Admin'],
        ] as const
      ).map(([email, id, en]) => ({ email, label: { id, en } })),
    },
  };
  for (const [key, value] of Object.entries(demoOverrides)) {
    if (process.env.DEMO_MODE === 'false') break; // production-like seed keeps the safe defaults
    await prisma.platformSetting.update({
      where: { key },
      data: { value: value as Prisma.InputJsonValue },
    });
  }
}

async function upsertUser(email: string, fullName: string, roleKey: string, locale: 'ID' | 'EN') {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      fullName,
      locale,
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
    update: { fullName, locale, passwordHash, status: 'ACTIVE' },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });
  return user;
}

async function seedOperator(opts: {
  email: string;
  fullName: string;
  slug: string;
  displayName: string;
  legalName: string;
  approved: boolean;
  adminId: string;
}) {
  const user = await upsertUser(opts.email, opts.fullName, 'PENYELENGGARA', 'ID');
  const profile = await prisma.operatorProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      slug: opts.slug,
      legalName: opts.legalName,
      displayName: opts.displayName,
      description: {
        id: `${opts.displayName} - penyedia konektivitas backbone nasional.`,
        en: `${opts.displayName} - national backbone connectivity provider.`,
      },
      contactEmail: opts.email,
      approvalStatus: opts.approved ? 'APPROVED' : 'PENDING',
      reviewedById: opts.approved ? opts.adminId : null,
      reviewedAt: opts.approved ? new Date() : null,
    },
    update: {},
  });
  if (opts.approved) {
    await ledger.append({
      eventType: 'OPERATOR_APPROVAL',
      status: 'SUCCESS',
      action: 'operator.approved',
      actorUserId: opts.adminId,
      operatorProfileId: profile.id,
      entityType: 'OperatorProfile',
      entityId: profile.id,
      message: 'Seeded demo operator',
    });
  }
  return profile;
}

async function seedGeo(operatorProfileId: string, op: keyof typeof OPERATORS) {
  const kml = buildKml(
    `${OPERATORS[op].displayName} network`,
    OPERATORS[op].links.map((l) => ({ name: l.id, description: l.title, coords: l.waypoints })),
  );
  const zip = new AdmZip();
  zip.addFile('doc.kml', Buffer.from(kml, 'utf8'));
  const kmz = zip.toBuffer();
  const parsed = parseGeo(kmz, 'KMZ'); // same code path as a real upload
  await prisma.geospatialData.deleteMany({
    where: { operatorProfileId, originalFileName: `${op}-network.kmz` },
  });
  return prisma.geospatialData.create({
    data: {
      operatorProfileId,
      name: `${OPERATORS[op].displayName} backbone`,
      originalFileName: `${op}-network.kmz`,
      sourceFormat: 'KMZ',
      fileSizeBytes: kmz.length,
      parseStatus: 'PARSED',
      geoJson: parsed.geoJson as unknown as Prisma.InputJsonValue,
      featureCount: parsed.featureCount,
      totalLengthKm: parsed.totalLengthKm,
      bboxMinLat: parsed.bbox?.minLat,
      bboxMinLng: parsed.bbox?.minLng,
      bboxMaxLat: parsed.bbox?.maxLat,
      bboxMaxLng: parsed.bbox?.maxLng,
    },
  });
}

const NUSALINK_CONFIG = {
  name: 'NusaLink Inventory API',
  baseUrl: `${API}/api/mock-operator/nusalink/v1`,
  authType: 'BEARER' as const,
  credentials: { token: OPERATORS.nusalink.token },
  endpoints: {
    listLinks: { method: 'GET', path: '/links', itemsPath: 'data.links' },
    lock: {
      method: 'POST',
      path: '/links/{externalId}/lock',
      lockRefPath: 'lockId',
      expiresAtPath: 'expiresAt',
    },
    confirm: { method: 'POST', path: '/locks/{lockRef}/confirm' },
    release: { method: 'POST', path: '/locks/{lockRef}/release' },
  },
  fieldMapping: {
    fields: {
      externalId: 'id',
      name: 'title',
      category: 'type',
      originName: 'a_end.city',
      originLat: 'a_end.lat',
      originLng: 'a_end.lng',
      destinationName: 'z_end.city',
      destinationLat: 'z_end.lat',
      destinationLng: 'z_end.lng',
      distanceKm: 'distance_km',
      capacityMbps: 'capacity.total_mbps',
      availableMbps: 'capacity.free_mbps',
      latencyMs: 'metrics.rtt_ms',
      slaPercent: 'sla',
      redundancyScore: 'redundancy',
      basePrice: 'pricing.monthly',
      currency: 'pricing.currency',
      availability: 'status',
      status: 'status',
    },
    valueMaps: {
      availability: { free: 'AVAILABLE', busy: 'LOCKED', maintenance: 'UNAVAILABLE' },
      status: { free: 'ACTIVE', busy: 'ACTIVE', maintenance: 'MAINTENANCE' },
    },
    telemetry: {
      lossPct: 'metrics.loss_pct',
      status: 'metrics.oper_status',
      plannedMaintenance: 'metrics.maintenance',
      statusMap: { up: 'UP', down: 'DOWN', degraded: 'DEGRADED' },
    },
  },
};

const GARUDA_CONFIG = {
  name: 'Garuda Inventory API',
  baseUrl: `${API}/api/mock-operator/garuda/api`,
  authType: 'API_KEY' as const,
  credentials: { apiKeyName: 'X-Garuda-Key', apiKey: OPERATORS.garuda.token, apiKeyIn: 'header' },
  endpoints: {
    listLinks: { method: 'GET', path: '/inventory', itemsPath: 'items' },
    lock: {
      method: 'POST',
      path: '/inventory/{externalId}/hold',
      lockRefPath: 'hold.id',
      expiresAtPath: 'hold.valid_until',
    },
    confirm: { method: 'POST', path: '/holds/{lockRef}/commit' },
    release: { method: 'POST', path: '/holds/{lockRef}/release' },
  },
  fieldMapping: {
    fields: {
      externalId: 'link_ref',
      name: 'label',
      category: 'category',
      originName: 'from_city',
      originLat: 'from_lat',
      originLng: 'from_lon',
      destinationName: 'to_city',
      destinationLat: 'to_lat',
      destinationLng: 'to_lon',
      distanceKm: 'km',
      capacityMbps: 'cap_gbps',
      availableMbps: 'avail_gbps',
      latencyMs: 'latency',
      slaPercent: 'uptime_sla',
      redundancyScore: 'resilience',
      basePrice: 'price_idr_month',
      availability: 'state',
      status: 'state',
    },
    valueMaps: {
      availability: { AVAIL: 'AVAILABLE', HELD: 'LOCKED', DOWN: 'UNAVAILABLE' },
      status: { AVAIL: 'ACTIVE', HELD: 'ACTIVE', DOWN: 'MAINTENANCE' },
    },
    unit: { capacity: 'GBPS' },
    telemetry: {
      lossPct: 'loss',
      status: 'oper',
      plannedMaintenance: 'planned',
      statusMap: { ok: 'UP', down: 'DOWN', deg: 'DEGRADED' },
    },
  },
};

async function seedIntegration(
  operatorProfileId: string,
  op: keyof typeof OPERATORS,
  cfg: typeof NUSALINK_CONFIG | typeof GARUDA_CONFIG,
) {
  await prisma.dynamicApiConfig.deleteMany({ where: { operatorProfileId, name: cfg.name } });
  const config = await prisma.dynamicApiConfig.create({
    data: {
      operatorProfileId,
      name: cfg.name,
      baseUrl: cfg.baseUrl,
      authType: cfg.authType,
      credentialsEnc: crypto.encryptJson(cfg.credentials),
      endpoints: cfg.endpoints as Prisma.InputJsonValue,
      fieldMapping: cfg.fieldMapping as Prisma.InputJsonValue,
      syncMode: 'POLLING',
      pollingIntervalSec: 30,
      status: 'ACTIVE',
      nextSyncAt: new Date(Date.now() + 30_000),
      lastSyncedAt: new Date(),
    },
  });
  const sync = new SyncService(
    prisma as never,
    new AdapterRegistry([new GenericRestAdapter(crypto)]),
    ledger,
    telemetry,
  );
  const payload =
    op === 'nusalink'
      ? new MockNusaLinkController().list(`Bearer ${OPERATORS.nusalink.token}`).data.links
      : new MockGarudaController().list(OPERATORS.garuda.token).items;
  const stats = await sync.ingest(config, payload, false);
  await ledger.append({
    eventType: 'API_SYNC',
    status: 'SUCCESS',
    action: 'api.sync.seed',
    operatorProfileId,
    entityType: 'DynamicApiConfig',
    entityId: config.id,
    responsePayload: stats,
  });
  return stats;
}

async function seedPricing(
  operatorProfileId: string,
  rules: Prisma.PricingRuleUncheckedCreateInput[],
) {
  await prisma.pricingRule.deleteMany({ where: { operatorProfileId } });
  await prisma.pricingRule.createMany({ data: rules.map((r) => ({ ...r, operatorProfileId })) });
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Refusing to seed demo accounts with a known password in production');
  }
  await seedRbac();
  const admin = await upsertUser('admin@demo.wnmp.test', 'Platform Admin', 'ADMIN', 'EN');
  console.log('Reference locations:', await seedReferenceLocations(prisma));

  const nusa = await seedOperator({
    email: 'operator@nusalink.wnmp.test',
    fullName: 'Rina Operator',
    slug: 'nusalink',
    displayName: 'NusaLink Backbone',
    legalName: 'PT NusaLink Backbone Indonesia',
    approved: true,
    adminId: admin.id,
  });
  const garuda = await seedOperator({
    email: 'operator@garuda.wnmp.test',
    fullName: 'Budi Operator',
    slug: 'garuda-fiber',
    displayName: 'Garuda Fiber Nusantara',
    legalName: 'PT Garuda Fiber Nusantara',
    approved: true,
    adminId: admin.id,
  });
  await seedOperator({
    email: 'pending@operator.wnmp.test',
    fullName: 'Sari Pending',
    slug: 'samudra-net',
    displayName: 'Samudra Net',
    legalName: 'PT Samudra Net Telekomunikasi',
    approved: false,
    adminId: admin.id,
  });

  const buyerUser = await upsertUser('buyer@demo.wnmp.test', 'Andi Penyewa', 'PENYEWA', 'ID');
  await prisma.buyerProfile.upsert({
    where: { userId: buyerUser.id },
    create: {
      userId: buyerUser.id,
      companyName: 'PT Cloud Nusantara',
      billingEmail: 'finance@cloudnusantara.test',
    },
    update: {},
  });

  await seedGeo(nusa.id, 'nusalink');
  await seedGeo(garuda.id, 'garuda');
  console.log('NusaLink sync:', await seedIntegration(nusa.id, 'nusalink', NUSALINK_CONFIG));
  console.log('Garuda sync:', await seedIntegration(garuda.id, 'garuda', GARUDA_CONFIG));

  await seedPricing(nusa.id, [
    {
      operatorProfileId: nusa.id,
      name: 'Term 12-35 months: 5% off',
      type: 'TERM_DISCOUNT',
      conditions: { minTermMonths: 12, maxTermMonths: 35 },
      adjustment: { mode: 'PERCENT', value: -5 },
      priority: 10,
    },
    {
      operatorProfileId: nusa.id,
      name: 'Term 36+ months: 12% off',
      type: 'TERM_DISCOUNT',
      conditions: { minTermMonths: 36 },
      adjustment: { mode: 'PERCENT', value: -12 },
      priority: 10,
    },
    {
      operatorProfileId: nusa.id,
      name: '100G capacity tier: 3% off',
      type: 'CAPACITY_TIER',
      conditions: { minCapacityMbps: 100000 },
      adjustment: { mode: 'PERCENT', value: -3 },
      priority: 20,
    },
    {
      operatorProfileId: nusa.id,
      name: 'Hot route promo: Pantura 7% off',
      type: 'PROMOTION',
      networkLinkId: (
        await prisma.networkLink.findFirstOrThrow({
          where: { operatorProfileId: nusa.id, externalId: 'NL-JKT-SBY-N' },
        })
      ).id,
      adjustment: { mode: 'PERCENT', value: -7 },
      validUntil: new Date(Date.now() + 30 * 86400_000),
      priority: 30,
    },
  ]);
  await seedPricing(garuda.id, [
    {
      operatorProfileId: garuda.id,
      name: 'Launch promo (24+ months): 8% off',
      type: 'PROMOTION',
      conditions: { minTermMonths: 24 },
      adjustment: { mode: 'PERCENT', value: -8 },
      priority: 10,
    },
  ]);

  // Add-on catalogs (demo operators). NusaLink deliberately has no REDUNDANCY add-on so the AI advises creating one.
  await prisma.addOnService.deleteMany({
    where: { operatorProfileId: { in: [nusa.id, garuda.id] } },
  });
  await prisma.addOnService.createMany({
    data: [
      {
        operatorProfileId: nusa.id,
        kind: 'MONITORING',
        name: { id: 'Monitoring 24x7 proaktif', en: '24x7 proactive monitoring' },
        description: {
          id: 'Dashboard latensi, loss, dan alert.',
          en: 'Latency/loss dashboard with alerts.',
        },
        price: 4500000,
        priceUnit: 'MONTH',
      },
      {
        operatorProfileId: nusa.id,
        kind: 'PREMIUM_SLA',
        name: { id: 'SLA premium 99,99%', en: 'Premium 99.99% SLA' },
        price: 9000000,
        priceUnit: 'MONTH',
      },
      {
        operatorProfileId: garuda.id,
        kind: 'CAPACITY_UPGRADE',
        name: { id: 'Upgrade kapasitas burstable', en: 'Burstable capacity upgrade' },
        price: 12000000,
        priceUnit: 'MONTH',
      },
      {
        operatorProfileId: garuda.id,
        kind: 'DDOS_PROTECTION',
        name: { id: 'Proteksi DDoS', en: 'DDoS protection' },
        price: 7500000,
        priceUnit: 'MONTH',
      },
      {
        operatorProfileId: garuda.id,
        kind: 'REDUNDANCY',
        name: { id: 'Jalur cadangan diverse', en: 'Diverse backup path' },
        price: 30000000,
        priceUnit: 'MONTH',
      },
    ],
  });

  // DEMO SEED: telemetry history, demand, rentals and tickets (all flagged isDemo).
  const demo = await seedDemo(prisma, {
    buyerId: buyerUser.id,
    operatorUserIds: { nusa: nusa.userId, garuda: garuda.userId },
    bcryptHash: '',
  });
  console.log('Demo data:', demo);
  // Insight reports are snapshots: drop demo ones so the next generate reflects the fresh seed.
  await prisma.sellerInsightReport.deleteMany({ where: { includesDemo: true } });
  console.log(
    'Scenario accounts:',
    await seedScenarios(prisma, {
      upsertUser,
      adminId: admin.id,
      buyerId: buyerUser.id,
      operators: { nusa: nusa.id, garuda: garuda.id, nusaUser: nusa.userId },
    }),
  );
  const allLinks = await prisma.networkLink.findMany({ select: { id: true } });
  await new PerformanceService(prisma as never, settings, tickets, ledger).computeMany(
    allLinks.map((l) => l.id),
  );

  await applyLedgerTriggers(prisma);
  const counts = {
    links: await prisma.networkLink.count(),
    withGeometry: await prisma.networkLink.count({ where: { geospatialDataId: { not: null } } }),
    ledger: await prisma.transactionLog.count(),
  };
  console.log('Seed complete', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
