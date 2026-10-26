// Demo over LAN: when the page is opened from another machine/phone and the API URL points at
// localhost, call the API on the same host as the page instead (port 4000).
const CONFIGURED = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const BASE = (() => {
  try {
    const host = new URL(CONFIGURED).hostname;
    if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(host)) {
      const page = window.location.hostname;
      if (!/^(localhost|127\.0\.0\.1)$/.test(page))
        return `${window.location.protocol}//${page}:4000/api`;
    }
  } catch {
    /* fall through to the configured value */
  }
  return `${CONFIGURED}/api`;
})();
const TOKEN_KEY = 'wnmp_token';

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => window.localStorage.setItem(TOKEN_KEY, t),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

// Maps an API error code to a bilingual message when the dictionary has one (err.<CODE>).
export function errMessage(e: unknown, t: (key: string) => string): string {
  if (e instanceof ApiError && e.code) {
    const m = t(`err.${e.code}`);
    if (m !== `err.${e.code}`) return m;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: {
      ...(opts.form ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    cache: 'no-store',
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401 && token && typeof window !== 'undefined') {
      tokenStore.clear();
      window.location.href = '/login';
    }
    const msg = Array.isArray(data?.message)
      ? data.message.join(', ')
      : data?.message || res.statusText;
    throw new ApiError(res.status, msg, data?.code ?? data?.message?.code);
  }
  return data as T;
}

// Saves an authenticated API response (CSV text or JSON) as a file.
export async function download(path: string, filename: string) {
  const data = await api(path);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const type = filename.endsWith('.csv') ? 'text/csv' : 'application/json';
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const money = (n: number | null | undefined, currency = 'IDR', locale = 'id-ID') =>
  n === null || n === undefined
    ? '-'
    : new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(n);

export const capacity = (mbps: number | null | undefined) =>
  mbps === null || mbps === undefined
    ? '-'
    : mbps >= 1000
      ? `${+(mbps / 1000).toFixed(1)} Gbps`
      : `${mbps} Mbps`;
