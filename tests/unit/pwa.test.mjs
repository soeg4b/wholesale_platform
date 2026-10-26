import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUB = path.join(ROOT, 'apps', 'web', 'public');
const read = (p) => fs.readFileSync(p, 'utf8');

describe('PWA / Android installability', () => {
  const manifest = JSON.parse(read(path.join(PUB, 'manifest.webmanifest')));

  test('manifest has the fields Android requires for "Add to home screen"', () => {
    for (const k of [
      'name',
      'short_name',
      'start_url',
      'display',
      'background_color',
      'theme_color',
      'icons',
    ])
      assert.ok(manifest[k], `missing ${k}`);
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.start_url.startsWith('/'));
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  });

  test('icons exist as valid PNGs in the declared sizes (any + maskable)', () => {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    for (const size of [192, 512]) {
      for (const purpose of ['any', 'maskable']) {
        const icons = manifest.icons.filter(
          (i) => i.sizes === `${size}x${size}` && i.purpose === purpose,
        );
        assert.equal(icons.length, 1, `${size} ${purpose}`);
        const file = path.join(PUB, icons[0].src);
        const png = fs.readFileSync(file);
        assert.ok(png.subarray(0, 8).equals(sig), `${icons[0].src} is not a PNG`);
        assert.ok(png.length > 500, 'suspiciously small icon');
      }
    }
    assert.ok(fs.existsSync(path.join(PUB, 'icons', 'apple-touch-icon.png')));
  });

  test('service worker: app shell + offline fallback, API never cached', () => {
    const sw = read(path.join(PUB, 'sw.js'));
    for (const snippet of ["'/offline.html'", "startsWith('/api/')", 'network', 'caches.open'])
      assert.ok(sw.includes(snippet), `sw.js missing: ${snippet}`);
    assert.ok(fs.existsSync(path.join(PUB, 'offline.html')));
  });

  test('layout registers the manifest and theme color', () => {
    const layout = read(path.join(ROOT, 'apps', 'web', 'app', 'layout.tsx'));
    assert.ok(layout.includes("manifest: '/manifest.webmanifest'"));
    assert.ok(layout.includes(manifest.theme_color));
  });
});
