// Demo fixtures that simulate two third-party operator systems with DIFFERENT payload shapes.
// They are only served by the bundled mock operator API; the platform itself never reads them directly.

export type LatLng = [number, number];

export const CITIES: Record<string, { lat: number; lng: number }> = {
  Jakarta: { lat: -6.2088, lng: 106.8456 },
  Bandung: { lat: -6.9175, lng: 107.6191 },
  Cirebon: { lat: -6.7063, lng: 108.557 },
  Semarang: { lat: -6.9667, lng: 110.4167 },
  Yogyakarta: { lat: -7.7956, lng: 110.3695 },
  Surabaya: { lat: -7.2575, lng: 112.7521 },
  Banyuwangi: { lat: -8.2192, lng: 114.3691 },
  Denpasar: { lat: -8.65, lng: 115.2167 },
  Makassar: { lat: -5.1477, lng: 119.4327 },
  Medan: { lat: 3.5952, lng: 98.6722 },
  Batam: { lat: 1.0456, lng: 104.0305 },
  Palembang: { lat: -2.9761, lng: 104.7754 },
  Lampung: { lat: -5.45, lng: 105.2667 },
};

const c = (name: string): LatLng => [CITIES[name].lat, CITIES[name].lng];

export interface FixtureLink {
  id: string;
  title: string;
  type: string;
  from: string;
  to: string;
  km: number;
  capMbps: number;
  freeMbps: number;
  rttMs: number;
  sla: number;
  priceIdr: number;
  redundancy: number;
  state: 'free' | 'busy' | 'maintenance';
  waypoints: LatLng[];
}

export const OPERATORS = {
  nusalink: {
    displayName: 'NusaLink Backbone',
    token: 'demo-token-nusalink',
    links: [
      {
        id: 'NL-JKT-SBY-N',
        title: 'Jakarta - Surabaya (Pantura)',
        type: 'dark_fiber',
        from: 'Jakarta',
        to: 'Surabaya',
        km: 790,
        capMbps: 100000,
        freeMbps: 60000,
        rttMs: 8.9,
        sla: 99.95,
        priceIdr: 95000000,
        redundancy: 0.82,
        state: 'free',
        waypoints: [c('Jakarta'), c('Cirebon'), c('Semarang'), c('Surabaya')],
      },
      {
        id: 'NL-JKT-SBY-S',
        title: 'Jakarta - Surabaya (Selatan via Yogyakarta)',
        type: 'dark_fiber',
        from: 'Jakarta',
        to: 'Surabaya',
        km: 930,
        capMbps: 40000,
        freeMbps: 20000,
        rttMs: 11.4,
        sla: 99.9,
        priceIdr: 68000000,
        redundancy: 0.9,
        state: 'free',
        waypoints: [c('Jakarta'), c('Bandung'), c('Yogyakarta'), c('Surabaya')],
      },
      {
        id: 'NL-JKT-BDG',
        title: 'Jakarta - Bandung Metro Fiber',
        type: 'wavelength',
        from: 'Jakarta',
        to: 'Bandung',
        km: 160,
        capMbps: 100000,
        freeMbps: 80000,
        rttMs: 2.1,
        sla: 99.99,
        priceIdr: 38000000,
        redundancy: 0.95,
        state: 'free',
        waypoints: [c('Jakarta'), c('Bandung')],
      },
      {
        id: 'NL-SBY-DPS',
        title: 'Surabaya - Denpasar',
        type: 'wavelength',
        from: 'Surabaya',
        to: 'Denpasar',
        km: 420,
        capMbps: 40000,
        freeMbps: 10000,
        rttMs: 5.2,
        sla: 99.9,
        priceIdr: 52000000,
        redundancy: 0.6,
        state: 'free',
        waypoints: [c('Surabaya'), c('Banyuwangi'), c('Denpasar')],
      },
      {
        id: 'NL-JKT-MDN',
        title: 'Jakarta - Medan (Sumatra Trunk)',
        type: 'ip_transit',
        from: 'Jakarta',
        to: 'Medan',
        km: 1900,
        capMbps: 20000,
        freeMbps: 0,
        rttMs: 21.5,
        sla: 99.8,
        priceIdr: 120000000,
        redundancy: 0.5,
        state: 'busy',
        waypoints: [c('Jakarta'), c('Lampung'), c('Palembang'), c('Medan')],
      },
    ] as FixtureLink[],
  },
  garuda: {
    displayName: 'Garuda Fiber Nusantara',
    token: 'demo-token-garuda',
    links: [
      {
        id: 'GF-1001',
        title: 'Jakarta Surabaya Express',
        type: 'wavelength',
        from: 'Jakarta',
        to: 'Surabaya',
        km: 810,
        capMbps: 100000,
        freeMbps: 40000,
        rttMs: 8.1,
        sla: 99.97,
        priceIdr: 112000000,
        redundancy: 0.88,
        state: 'free',
        waypoints: [c('Jakarta'), c('Semarang'), c('Surabaya')],
      },
      {
        id: 'GF-1002',
        title: 'Surabaya Makassar Subsea',
        type: 'dark_fiber',
        from: 'Surabaya',
        to: 'Makassar',
        km: 1100,
        capMbps: 40000,
        freeMbps: 30000,
        rttMs: 14.8,
        sla: 99.9,
        priceIdr: 98000000,
        redundancy: 0.55,
        state: 'free',
        waypoints: [c('Surabaya'), [-6.9, 116.0], c('Makassar')],
      },
      {
        id: 'GF-1003',
        title: 'Jakarta Batam Cable',
        type: 'ip_transit',
        from: 'Jakarta',
        to: 'Batam',
        km: 900,
        capMbps: 100000,
        freeMbps: 70000,
        rttMs: 10.2,
        sla: 99.95,
        priceIdr: 105000000,
        redundancy: 0.8,
        state: 'free',
        waypoints: [c('Jakarta'), c('Palembang'), c('Batam')],
      },
      {
        id: 'GF-1004',
        title: 'Medan Batam Link',
        type: 'wavelength',
        from: 'Medan',
        to: 'Batam',
        km: 620,
        capMbps: 40000,
        freeMbps: 25000,
        rttMs: 7.6,
        sla: 99.9,
        priceIdr: 61000000,
        redundancy: 0.7,
        state: 'free',
        waypoints: [c('Medan'), [2.2, 101.5], c('Batam')],
      },
      {
        id: 'GF-1005',
        title: 'Denpasar Makassar',
        type: 'dark_fiber',
        from: 'Denpasar',
        to: 'Makassar',
        km: 780,
        capMbps: 20000,
        freeMbps: 20000,
        rttMs: 9.9,
        sla: 99.5,
        priceIdr: 44000000,
        redundancy: 0.4,
        state: 'maintenance',
        waypoints: [c('Denpasar'), [-8.0, 117.0], c('Makassar')],
      },
    ] as FixtureLink[],
  },
} as const;

export type OperatorKey = keyof typeof OPERATORS;

// Small deterministic wobble so polling shows live-looking latency/availability changes.
export function wobble(seed: string, amplitude: number): number {
  const t = Math.floor(Date.now() / 20000);
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Math.sin(h + t * 0.7) * amplitude;
}
