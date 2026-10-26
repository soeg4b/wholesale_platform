import { DynamicApiConfig } from '@prisma/client';

export interface NormalizedLink {
  externalId: string;
  name: string;
  category: string;
  originName: string;
  originLat?: number | null;
  originLng?: number | null;
  destinationName: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
  distanceKm?: number | null;
  capacityMbps?: number | null;
  availableMbps?: number | null;
  latencyMs?: number | null;
  slaPercent?: number | null;
  redundancyScore?: number | null;
  basePrice?: number | null;
  currency?: string | null;
  availability: 'AVAILABLE' | 'LOCKED' | 'RESERVED' | 'UNAVAILABLE';
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
  attributes?: Record<string, unknown>;
  telemetry?: {
    lossPct: number | null;
    opStatus: 'UP' | 'DOWN' | 'DEGRADED' | null;
    plannedMaintenance: boolean;
  };
}

export interface EndpointSpec {
  method?: string;
  path: string;
  itemsPath?: string; // where the array lives in the response
  lockRefPath?: string;
  expiresAtPath?: string;
}

export interface AdapterEndpoints {
  listLinks: EndpointSpec;
  lock?: EndpointSpec;
  confirm?: EndpointSpec;
  release?: EndpointSpec;
}

export interface FieldMapping {
  fields: Record<string, string>; // platform field -> JSON path in operator payload
  valueMaps?: {
    availability?: Record<string, NormalizedLink['availability']>;
    status?: Record<string, NormalizedLink['status']>;
  };
  attributePaths?: Record<string, string>; // extra attribute name -> JSON path
  unit?: { capacity?: 'MBPS' | 'GBPS' };
  // Optional operator-reported health: JSON paths plus a map from the operator's status text.
  telemetry?: {
    lossPct?: string;
    status?: string;
    plannedMaintenance?: string;
    statusMap?: Record<string, 'UP' | 'DOWN' | 'DEGRADED'>;
  };
}

export interface LockResult {
  lockRef: string;
  expiresAt?: Date;
  raw?: unknown;
}

export interface OperatorAdapter {
  readonly key: string;
  fetchRaw(config: DynamicApiConfig): Promise<{ items: unknown[]; httpStatus: number }>;
  normalize(config: DynamicApiConfig, raw: unknown): NormalizedLink | null;
  lock(
    config: DynamicApiConfig,
    externalId: string,
    ttlSeconds: number,
    buyerRef: string,
  ): Promise<LockResult>;
  confirm(config: DynamicApiConfig, lockRef: string, externalId: string): Promise<void>;
  release(config: DynamicApiConfig, lockRef: string, externalId: string): Promise<void>;
}

export const OPERATOR_ADAPTERS = Symbol('OPERATOR_ADAPTERS');
