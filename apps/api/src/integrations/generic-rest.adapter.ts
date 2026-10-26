import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { DynamicApiConfig } from '@prisma/client';
import { createHmac } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { CryptoService } from '../common/crypto.service';
import {
  AdapterEndpoints,
  EndpointSpec,
  FieldMapping,
  LockResult,
  NormalizedLink,
  OperatorAdapter,
} from './adapter.types';

interface Credentials {
  token?: string;
  apiKeyName?: string;
  apiKey?: string;
  apiKeyIn?: 'header' | 'query';
  username?: string;
  password?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  hmacSecret?: string;
}

export function getPath(obj: unknown, path?: string): unknown {
  if (!path) return undefined;
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' && Object.prototype.hasOwnProperty.call(acc, key)
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase();
  // WHATWG URL rewrites [::ffff:127.0.0.1] to hex form, so decode mapped/NAT64 forms before checking.
  const mapped = a.match(
    /^(?:::ffff:|::|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/,
  );
  if (mapped) {
    const hi = parseInt(mapped[2] ?? '0', 16);
    const lo = parseInt(mapped[3] ?? '0', 16);
    return isPrivateAddress(mapped[1] ?? [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
  }
  if (a === '::' || a === '::1' || /^(f[cdf]|fe[89ab])/.test(a)) return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [o1, o2, o3] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return (
    o1 === 10 ||
    o1 === 127 ||
    o1 === 0 ||
    o1 >= 224 ||
    (o1 === 100 && o2 >= 64 && o2 <= 127) ||
    (o1 === 169 && o2 === 254) ||
    (o1 === 172 && o2 >= 16 && o2 <= 31) ||
    (o1 === 192 && o2 === 168) ||
    (o1 === 192 && o2 === 0 && o3 === 0) ||
    (o1 === 198 && (o2 === 18 || o2 === 19))
  );
}

// Operator URLs are user supplied, so block SSRF to internal addresses unless explicitly allowed (demo).
export async function assertSafeUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new BadRequestException('Only http(s) URLs are allowed');
  if (process.env.ALLOW_PRIVATE_OPERATOR_URLS === 'true') return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new BadRequestException('Operator URL resolves to a private address');
  }
}

@Injectable()
export class GenericRestAdapter implements OperatorAdapter {
  readonly key = 'generic-rest';
  private tokenCache = new Map<string, { token: string; exp: number }>();

  constructor(private readonly crypto: CryptoService) {}

  private async headers(
    config: DynamicApiConfig,
    body?: string,
  ): Promise<{ headers: Record<string, string>; query: Record<string, string> }> {
    const creds = this.crypto.decryptJson<Credentials>(config.credentialsEnc);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((config.staticHeaders as Record<string, string> | null) ?? {}),
    };
    const query: Record<string, string> = {};
    switch (config.authType) {
      case 'BEARER':
        headers.Authorization = `Bearer ${creds.token}`;
        break;
      case 'BASIC':
        headers.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
        break;
      case 'API_KEY':
        if (creds.apiKeyIn === 'query') query[creds.apiKeyName || 'api_key'] = creds.apiKey ?? '';
        else headers[creds.apiKeyName || 'X-API-Key'] = creds.apiKey ?? '';
        break;
      case 'OAUTH2_CLIENT_CREDENTIALS':
        headers.Authorization = `Bearer ${await this.oauthToken(config.id, creds)}`;
        break;
      case 'HMAC': {
        const ts = Date.now().toString();
        headers['X-Timestamp'] = ts;
        headers['X-Signature'] = createHmac('sha256', creds.hmacSecret ?? '')
          .update(ts + (body ?? ''))
          .digest('hex');
        break;
      }
    }
    return { headers, query };
  }

  private async oauthToken(configId: string, creds: Credentials): Promise<string> {
    const cached = this.tokenCache.get(configId);
    if (cached && cached.exp > Date.now() + 30_000) return cached.token;
    if (!creds.tokenUrl) throw new BadRequestException('tokenUrl missing in credentials');
    await assertSafeUrl(creds.tokenUrl);
    const res = await fetch(creds.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId ?? '',
        client_secret: creds.clientSecret ?? '',
        ...(creds.scope ? { scope: creds.scope } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!res.ok) throw new BadGatewayException(`OAuth token request failed (${res.status})`);
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    this.tokenCache.set(configId, {
      token: json.access_token,
      exp: Date.now() + (json.expires_in ?? 300) * 1000,
    });
    return json.access_token;
  }

  private async call(
    config: DynamicApiConfig,
    spec: EndpointSpec,
    vars: Record<string, string> = {},
    body?: unknown,
  ) {
    const path = spec.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] ?? ''));
    const url = new URL(config.baseUrl.replace(/\/+$/, '') + path);
    await assertSafeUrl(url.toString());
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const { headers, query } = await this.headers(config, payload);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    if (payload) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(url, {
        method: spec.method ?? 'GET',
        headers,
        body: payload,
        redirect: 'error',
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      throw new BadGatewayException(
        `Operator API unreachable: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (!res.ok) throw new BadGatewayException(`Operator API responded ${res.status}`);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new BadGatewayException('Operator API returned non-JSON');
    }
    return { json, status: res.status };
  }

  private endpoints(config: DynamicApiConfig) {
    return config.endpoints as unknown as AdapterEndpoints;
  }

  async fetchRaw(config: DynamicApiConfig) {
    const spec = this.endpoints(config).listLinks;
    const { json, status } = await this.call(config, spec);
    const items = spec.itemsPath ? getPath(json, spec.itemsPath) : json;
    if (!Array.isArray(items))
      throw new BadGatewayException('listLinks response does not contain an array at itemsPath');
    return { items, httpStatus: status };
  }

  normalize(config: DynamicApiConfig, raw: unknown): NormalizedLink | null {
    const map = config.fieldMapping as unknown as FieldMapping;
    const f = (name: string) => getPath(raw, map.fields[name]);
    const externalId = f('externalId');
    const originName = f('originName');
    const destinationName = f('destinationName');
    if (externalId === undefined || externalId === null || !originName || !destinationName)
      return null;

    const toMbps = (v: unknown) => {
      const n = num(v);
      return n === null
        ? null
        : map.unit?.capacity === 'GBPS'
          ? Math.round(n * 1000)
          : Math.round(n);
    };
    const lower = (m?: Record<string, string>) =>
      Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const availMap = lower(map.valueMaps?.availability);
    const statusMap = lower(map.valueMaps?.status);

    const rawAvail = f('availability');
    let availability: NormalizedLink['availability'] = 'AVAILABLE';
    if (typeof rawAvail === 'boolean') availability = rawAvail ? 'AVAILABLE' : 'UNAVAILABLE';
    else if (rawAvail !== undefined && rawAvail !== null) {
      availability =
        (availMap[String(rawAvail).toLowerCase()] as NormalizedLink['availability']) ??
        'UNAVAILABLE';
    }
    const availableMbps = toMbps(f('availableMbps'));
    if (availableMbps === 0) availability = 'UNAVAILABLE';

    const rawStatus = f('status');
    const status =
      rawStatus === undefined || rawStatus === null
        ? 'ACTIVE'
        : ((statusMap[String(rawStatus).toLowerCase()] as NormalizedLink['status']) ?? 'ACTIVE');

    const attributes: Record<string, unknown> = {};
    Object.entries(map.attributePaths ?? {}).forEach(([k, p]) => {
      const v = getPath(raw, p);
      if (v !== undefined) attributes[k] = v;
    });

    const tm = map.telemetry;
    let telemetry: NormalizedLink['telemetry'];
    if (tm) {
      const rawOp = tm.status ? getPath(raw, tm.status) : undefined;
      const statusMap = lower(tm.statusMap as Record<string, string> | undefined);
      const opStatus =
        rawOp === undefined || rawOp === null
          ? null
          : ((statusMap[String(rawOp).toLowerCase()] as 'UP' | 'DOWN' | 'DEGRADED' | undefined) ??
            null);
      const planned = tm.plannedMaintenance ? getPath(raw, tm.plannedMaintenance) : undefined;
      const loss = tm.lossPct ? num(getPath(raw, tm.lossPct)) : null;
      telemetry = {
        // Out-of-range operator values are treated as "no data" rather than poisoning the time series.
        lossPct: loss !== null && loss >= 0 && loss <= 100 ? loss : null,
        opStatus,
        plannedMaintenance: planned === true || planned === 'true' || planned === 1,
      };
    }

    return {
      externalId: String(externalId),
      name: String(f('name') ?? `${originName} - ${destinationName}`),
      category: String(f('category') ?? 'UNSPECIFIED').toUpperCase(),
      originName: String(originName),
      originLat: num(f('originLat')),
      originLng: num(f('originLng')),
      destinationName: String(destinationName),
      destinationLat: num(f('destinationLat')),
      destinationLng: num(f('destinationLng')),
      distanceKm: num(f('distanceKm')),
      capacityMbps: toMbps(f('capacityMbps')),
      availableMbps,
      latencyMs: num(f('latencyMs')),
      slaPercent: num(f('slaPercent')),
      redundancyScore: num(f('redundancyScore')),
      basePrice: num(f('basePrice')),
      currency: (f('currency') as string) ?? null,
      availability,
      status,
      attributes,
      telemetry,
    };
  }

  async lock(
    config: DynamicApiConfig,
    externalId: string,
    ttlSeconds: number,
    buyerRef: string,
  ): Promise<LockResult> {
    const spec = this.endpoints(config).lock;
    if (!spec)
      return {
        lockRef: `local-${externalId}-${Date.now()}`,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      };
    const { json } = await this.call(
      config,
      spec,
      { externalId },
      { ttlSeconds, reference: buyerRef },
    );
    const lockRef = getPath(json, spec.lockRefPath ?? 'lockId');
    if (!lockRef) throw new BadGatewayException('Operator lock response missing lock reference');
    const exp = spec.expiresAtPath ? getPath(json, spec.expiresAtPath) : undefined;
    return {
      lockRef: String(lockRef),
      expiresAt: exp ? new Date(String(exp)) : new Date(Date.now() + ttlSeconds * 1000),
      raw: json,
    };
  }

  async confirm(config: DynamicApiConfig, lockRef: string, externalId: string) {
    const spec = this.endpoints(config).confirm;
    if (spec) await this.call(config, spec, { lockRef, externalId }, { lockRef });
  }

  async release(config: DynamicApiConfig, lockRef: string, externalId: string) {
    const spec = this.endpoints(config).release;
    if (spec) await this.call(config, spec, { lockRef, externalId }, { lockRef });
  }
}
