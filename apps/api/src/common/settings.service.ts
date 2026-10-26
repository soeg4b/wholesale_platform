import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SETTING_DEFAULTS } from './settings-defaults';

@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();
  private readonly log = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Typed read of a tunable threshold; falls back to the documented default.
  async cfg<T = number>(key: string): Promise<T> {
    const def = SETTING_DEFAULTS[key] as T;
    const value = await this.get<T>(key, def);
    const sameShape =
      typeof value === typeof def &&
      Array.isArray(value) === Array.isArray(def) &&
      (def === null || value !== null);
    if (!sameShape) {
      this.log.warn(`Setting "${key}" has an unexpected shape; using the default`);
      return def;
    }
    return value;
  }

  async cfgMany(keys: string[]): Promise<Record<string, any>> {
    const entries = await Promise.all(keys.map(async (k) => [k, await this.cfg<any>(k)] as const));
    return Object.fromEntries(entries);
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 15_000) return hit.value as T;
    const row = await this.prisma.platformSetting.findUnique({ where: { key } });
    const value = (row ? row.value : fallback) as T;
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async set(key: string, value: unknown, updatedById?: string) {
    this.cache.delete(key);
    return this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: value as object, updatedById },
      update: { value: value as object, updatedById },
    });
  }
}
