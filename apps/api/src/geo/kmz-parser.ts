import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';
import * as toGeoJSON from '@tmcw/togeojson';

export type GeoFormat = 'KMZ' | 'KML' | 'GEOJSON';

export interface ParsedGeo {
  geoJson: GeoJSON.FeatureCollection;
  featureCount: number;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null;
  totalLengthKm: number;
}

const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

export function detectFormat(fileName: string): GeoFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'kmz') return 'KMZ';
  if (ext === 'kml') return 'KML';
  if (ext === 'geojson' || ext === 'json') return 'GEOJSON';
  return null;
}

function haversineKm(a: number[], b: number[]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function walkCoords(
  geom: GeoJSON.Geometry | null,
  visit: (c: number[]) => void,
  lines: (l: number[][]) => void,
) {
  if (!geom) return;
  switch (geom.type) {
    case 'Point':
      visit(geom.coordinates);
      break;
    case 'MultiPoint':
      geom.coordinates.forEach(visit);
      break;
    case 'LineString':
      geom.coordinates.forEach(visit);
      lines(geom.coordinates);
      break;
    case 'MultiLineString':
      geom.coordinates.forEach((l) => {
        l.forEach(visit);
        lines(l);
      });
      break;
    case 'Polygon':
      geom.coordinates.forEach((r) => r.forEach(visit));
      break;
    case 'MultiPolygon':
      geom.coordinates.forEach((p) => p.forEach((r) => r.forEach(visit)));
      break;
    case 'GeometryCollection':
      geom.geometries.forEach((g) => walkCoords(g, visit, lines));
      break;
  }
}

function kmlToGeoJson(xml: string): GeoJSON.FeatureCollection {
  // Uploaded XML is untrusted: refusing a DTD rules out entity expansion and external entities.
  if (/<!(DOCTYPE|ENTITY)/i.test(xml))
    throw new Error('DOCTYPE/ENTITY declarations are not allowed');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return toGeoJSON.kml(doc as unknown as Document) as GeoJSON.FeatureCollection;
}

export function parseGeo(buffer: Buffer, format: GeoFormat): ParsedGeo {
  let fc: GeoJSON.FeatureCollection;
  if (format === 'KMZ') {
    const zip = new AdmZip(buffer);
    const entries = zip
      .getEntries()
      .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.kml'));
    if (!entries.length) throw new Error('KMZ does not contain a .kml file');
    const total = zip.getEntries().reduce((s, e) => s + e.header.size, 0);
    if (total > MAX_UNCOMPRESSED_BYTES || zip.getEntries().length > 1000)
      throw new Error('KMZ uncompressed size too large');
    const main = entries.find((e) => e.entryName.toLowerCase() === 'doc.kml') ?? entries[0];
    const data = main.getData();
    if (data.length > MAX_UNCOMPRESSED_BYTES) throw new Error('KMZ uncompressed size too large');
    fc = kmlToGeoJson(data.toString('utf8'));
  } else if (format === 'KML') {
    fc = kmlToGeoJson(buffer.toString('utf8'));
  } else {
    const parsed = JSON.parse(buffer.toString('utf8'));
    fc =
      parsed.type === 'FeatureCollection'
        ? parsed
        : parsed.type === 'Feature'
          ? { type: 'FeatureCollection', features: [parsed] }
          : {
              type: 'FeatureCollection',
              features: [{ type: 'Feature', properties: {}, geometry: parsed }],
            };
  }

  let minLat = 90,
    minLng = 180,
    maxLat = -90,
    maxLng = -180,
    any = false,
    km = 0;
  fc.features = (fc.features ?? []).filter((f) => f.geometry);
  fc.features.forEach((f, i) => {
    if (f.id === undefined) f.id = (f.properties?.name as string) ?? `feature-${i}`;
    walkCoords(
      f.geometry,
      (c) => {
        any = true;
        minLng = Math.min(minLng, c[0]);
        maxLng = Math.max(maxLng, c[0]);
        minLat = Math.min(minLat, c[1]);
        maxLat = Math.max(maxLat, c[1]);
      },
      (line) => {
        for (let k = 1; k < line.length; k++) km += haversineKm(line[k - 1], line[k]);
      },
    );
  });
  return {
    geoJson: fc,
    featureCount: fc.features.length,
    bbox: any ? { minLat, minLng, maxLat, maxLng } : null,
    totalLengthKm: Math.round(km * 10) / 10,
  };
}

export function buildKml(
  name: string,
  placemarks: { name: string; description?: string; coords: [number, number][] }[],
): string {
  const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>
${placemarks
  .map(
    (p) =>
      `<Placemark><name>${esc(p.name)}</name><description>${esc(p.description ?? '')}</description><LineString><tessellate>1</tessellate><coordinates>${p.coords
        .map(([lat, lng]) => `${lng},${lat},0`)
        .join(' ')}</coordinates></LineString></Placemark>`,
  )
  .join('\n')}
</Document></kml>`;
}
