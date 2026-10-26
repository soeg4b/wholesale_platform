import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Module,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { OperatorContext } from '../common/operator-context.service';
import { AuthGuard, AuthUser, CurrentUser, Perms } from '../common/auth.guard';
import { detectFormat, parseGeo } from './kmz-parser';

interface CreateFromGeoBody {
  featureIds?: string[];
  defaults?: { category?: string; capacityMbps?: number; basePrice?: number };
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly operators: OperatorContext,
  ) {}

  async upload(userId: string, file: Express.Multer.File | undefined, name?: string) {
    if (!file) throw new BadRequestException('file is required');
    const op = await this.operators.getApproved(userId);
    const format = detectFormat(file.originalname);
    if (!format) throw new BadRequestException('Only .kmz, .kml or .geojson files are supported');

    const base = {
      operatorProfileId: op.id,
      name: name?.trim() || file.originalname,
      originalFileName: file.originalname,
      sourceFormat: format,
      fileSizeBytes: file.size,
      checksum: createHash('sha256').update(file.buffer).digest('hex'),
    };
    try {
      const parsed = parseGeo(file.buffer, format);
      const row = await this.prisma.geospatialData.create({
        data: {
          ...base,
          parseStatus: 'PARSED',
          geoJson: parsed.geoJson as object,
          featureCount: parsed.featureCount,
          bboxMinLat: parsed.bbox?.minLat,
          bboxMinLng: parsed.bbox?.minLng,
          bboxMaxLat: parsed.bbox?.maxLat,
          bboxMaxLng: parsed.bbox?.maxLng,
          totalLengthKm: parsed.totalLengthKm,
        },
        select: {
          id: true,
          name: true,
          featureCount: true,
          totalLengthKm: true,
          parseStatus: true,
        },
      });
      await this.ledger.appendSafe({
        eventType: 'LINK_UPDATE',
        status: 'SUCCESS',
        action: 'geo.uploaded',
        actorUserId: userId,
        operatorProfileId: op.id,
        entityType: 'GeospatialData',
        entityId: row.id,
        responsePayload: { format, featureCount: parsed.featureCount },
      });
      return row;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Parse error';
      await this.prisma.geospatialData.create({
        data: { ...base, parseStatus: 'FAILED', parseError: message },
      });
      throw new BadRequestException(`Could not parse file: ${message}`);
    }
  }

  async listOwn(userId: string) {
    const op = await this.operators.get(userId);
    const rows = await this.prisma.geospatialData.findMany({
      where: { operatorProfileId: op.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        sourceFormat: true,
        parseStatus: true,
        parseError: true,
        featureCount: true,
        totalLengthKm: true,
        createdAt: true,
        geoJson: true,
      },
    });
    return rows.map(({ geoJson, ...r }) => ({
      ...r,
      features: ((geoJson as unknown as GeoJSON.FeatureCollection | null)?.features ?? []).map(
        (f) => ({
          id: String(f.id ?? ''),
          name: (f.properties?.name as string) ?? String(f.id ?? ''),
        }),
      ),
    }));
  }

  async attach(userId: string, geoId: string, linkId: string, featureId?: string) {
    const op = await this.operators.getApproved(userId);
    const [geo, link] = await Promise.all([
      this.prisma.geospatialData.findFirst({ where: { id: geoId, operatorProfileId: op.id } }),
      this.prisma.networkLink.findFirst({
        where: { id: linkId, operatorProfileId: op.id, deletedAt: null },
      }),
    ]);
    if (!geo || !link) throw new NotFoundException();
    await this.prisma.networkLink.update({
      where: { id: link.id },
      data: { geospatialDataId: geo.id, geometryFeatureId: featureId || null },
    });
    await this.ledger.appendSafe({
      eventType: 'LINK_UPDATE',
      status: 'SUCCESS',
      action: 'geo.attached',
      actorUserId: userId,
      operatorProfileId: op.id,
      networkLinkId: link.id,
      entityType: 'GeospatialData',
      entityId: geo.id,
      requestPayload: { featureId },
    });
    return { ok: true };
  }

  // Turns each route (LineString) in an uploaded KMZ into a DRAFT link; endpoints are named after
  // the nearest reference location so the operator only has to review price/capacity and activate.
  async createLinks(userId: string, geoId: string, b: CreateFromGeoBody) {
    const op = await this.operators.getApproved(userId);
    const geo = await this.prisma.geospatialData.findFirst({
      where: { id: geoId, operatorProfileId: op.id, parseStatus: 'PARSED' },
    });
    if (!geo) throw new NotFoundException();
    const d = b?.defaults ?? {};
    const okNum = (v: unknown, max: number) =>
      v === undefined || (typeof v === 'number' && v >= 0 && v <= max);
    if (
      !okNum(d.capacityMbps, 1e9) ||
      !okNum(d.basePrice, 1e12) ||
      (d.category !== undefined && (typeof d.category !== 'string' || d.category.length > 64))
    )
      throw new BadRequestException('Invalid defaults');
    const fc = geo.geoJson as unknown as GeoJSON.FeatureCollection;
    const wanted = Array.isArray(b?.featureIds) ? b.featureIds.map(String) : null;
    const [locations, existing] = await Promise.all([
      this.prisma.referenceLocation.findMany({ where: { isActive: true } }),
      this.prisma.networkLink.findMany({
        where: { geospatialDataId: geo.id, deletedAt: null },
        select: { geometryFeatureId: true },
      }),
    ]);
    const taken = new Set(existing.map((e) => e.geometryFeatureId));
    const nearest = (lat: number, lng: number) => {
      let best: { name: string; km: number } | null = null;
      for (const l of locations) {
        const km = haversineKm(lat, lng, l.lat, l.lng);
        if (!best || km < best.km) best = { name: l.name, km };
      }
      return best && best.km <= 50 ? best.name : `${lat.toFixed(4)},${lng.toFixed(4)}`;
    };
    const created: { id: string; featureId: string; route: string }[] = [];
    const skipped: { featureId: string; reason: string }[] = [];
    for (const f of fc?.features ?? []) {
      const fid = String(f.id ?? f.properties?.name ?? '');
      if (wanted && !wanted.includes(fid)) continue;
      const line =
        f.geometry?.type === 'LineString'
          ? f.geometry.coordinates
          : f.geometry?.type === 'MultiLineString'
            ? f.geometry.coordinates.flat()
            : null;
      if (!line || line.length < 2) {
        skipped.push({ featureId: fid, reason: 'NOT_A_ROUTE' });
        continue;
      }
      if (taken.has(fid)) {
        skipped.push({ featureId: fid, reason: 'ALREADY_LINKED' });
        continue;
      }
      const [aLng, aLat] = line[0];
      const [zLng, zLat] = line[line.length - 1];
      let km = 0;
      for (let i = 1; i < line.length; i++)
        km += haversineKm(line[i - 1][1], line[i - 1][0], line[i][1], line[i][0]);
      const originName = nearest(aLat, aLng);
      const destinationName = nearest(zLat, zLng);
      const label = (f.properties?.name as string) || `${originName} - ${destinationName}`;
      const row = await this.prisma.networkLink.create({
        data: {
          operatorProfileId: op.id,
          name: { id: label, en: label },
          category: (d.category || 'DARK_FIBER').toUpperCase(),
          status: 'DRAFT',
          originName,
          originLat: aLat,
          originLng: aLng,
          destinationName,
          destinationLat: zLat,
          destinationLng: zLng,
          distanceKm: Math.round(km * 10) / 10,
          capacityMbps: d.capacityMbps,
          availableMbps: d.capacityMbps,
          basePrice: d.basePrice,
          currency: op.defaultCurrency,
          geospatialDataId: geo.id,
          geometryFeatureId: fid,
        },
      });
      created.push({ id: row.id, featureId: fid, route: `${originName} - ${destinationName}` });
    }
    await this.ledger.appendSafe({
      eventType: 'LINK_UPDATE',
      status: 'SUCCESS',
      action: 'geo.links-created',
      actorUserId: userId,
      operatorProfileId: op.id,
      entityType: 'GeospatialData',
      entityId: geo.id,
      responsePayload: { created: created.length, skipped: skipped.length },
    });
    return { created, skipped };
  }

  async forLink(user: AuthUser, linkId: string): Promise<GeoJSON.FeatureCollection> {
    const link = await this.prisma.networkLink.findFirst({
      where: {
        id: linkId,
        deletedAt: null,
        // Draft/suspended routes are only visible to their owner and admins.
        ...(user.roles.includes('ADMIN')
          ? {}
          : {
              OR: [
                { status: 'ACTIVE', operatorProfile: { approvalStatus: 'APPROVED' } },
                { operatorProfile: { userId: user.sub } },
              ],
            }),
      },
      include: { geospatialData: { select: { geoJson: true } } },
    });
    if (!link) throw new NotFoundException();
    const fc = link.geospatialData?.geoJson as unknown as GeoJSON.FeatureCollection | undefined;
    if (!fc) return { type: 'FeatureCollection', features: [] };
    if (!link.geometryFeatureId) return fc;
    return {
      type: 'FeatureCollection',
      features: fc.features.filter(
        (f) =>
          String(f.id) === link.geometryFeatureId || f.properties?.name === link.geometryFeatureId,
      ),
    };
  }
}

@Controller('geo')
@UseGuards(AuthGuard)
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Post('upload')
  @Perms('geo:upload')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  upload(
    @CurrentUser() u: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name?: string,
  ) {
    return this.geo.upload(u.sub, file, name);
  }

  @Get()
  @Perms('geo:upload')
  list(@CurrentUser() u: AuthUser) {
    return this.geo.listOwn(u.sub);
  }

  @Post(':id/attach')
  @Perms('geo:upload')
  attach(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: { linkId: string; featureId?: string },
  ) {
    return this.geo.attach(u.sub, id, body.linkId, body.featureId);
  }

  @Post(':id/create-links')
  @Perms('geo:upload')
  createLinks(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: CreateFromGeoBody,
  ) {
    return this.geo.createLinks(u.sub, id, body);
  }

  @Get('link/:linkId')
  forLink(@CurrentUser() u: AuthUser, @Param('linkId') linkId: string) {
    return this.geo.forLink(u, linkId);
  }
}

@Module({ controllers: [GeoController], providers: [GeoService], exports: [GeoService] })
export class GeoModule {}
