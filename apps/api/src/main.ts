import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

const isProd = process.env.NODE_ENV === 'production';
const WEAK_SECRETS = new Set([
  '',
  'change-me',
  'dev-only-insecure-secret',
  'dev-only-insecure-key',
]);

// Production must never run on the placeholder/fallback secrets baked into the code.
function assertProductionSecrets() {
  if (!isProd) return;
  for (const name of ['JWT_ACCESS_SECRET', 'CREDENTIALS_ENCRYPTION_KEY']) {
    const v = process.env[name] ?? '';
    if (WEAK_SECRETS.has(v) || v.length < 32) {
      throw new Error(`${name} must be a random value of at least 32 characters in production`);
    }
  }
}

// Minimal helmet equivalent for a JSON API (no new dependency).
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

// Per-IP fixed window held in process memory; a shared limiter (proxy/Redis) is still needed when scaled out.
const buckets = new Map<string, { n: number; reset: number }>();
function rateLimiter(general: number, heavy: number) {
  const HEAVY = /^\/api\/(auth\/|explorer\/|ai\/|seller\/insights\/generate)/;
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/webhooks/')) return next();
    const isHeavy = HEAVY.test(req.path);
    const key = `${isHeavy ? 'h' : 'g'}|${req.ip}`;
    const now = Date.now();
    if (buckets.size > 20_000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    const b = buckets.get(key);
    if (!b || b.reset <= now) {
      buckets.set(key, { n: 1, reset: now + 60_000 });
      return next();
    }
    if (++b.n > (isHeavy ? heavy : general)) {
      res.setHeader('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests' });
      return;
    }
    next();
  };
}

async function bootstrap() {
  assertProductionSecrets();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.disable('x-powered-by');
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (hops > 0) app.set('trust proxy', hops);
  else if (isProd) console.warn('[security] TRUST_PROXY_HOPS unset: req.ip is the proxy IP');
  app.setGlobalPrefix('api');
  app.use(securityHeaders);
  const perMin = Number(process.env.RATE_LIMIT_PER_MIN) || (isProd ? 1200 : 0);
  if (perMin > 0) {
    app.use(rateLimiter(perMin, Number(process.env.RATE_LIMIT_HEAVY_PER_MIN) || 120));
  }
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: true });
  app.enableCors({
    origin: (process.env.WEB_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT || 4000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api`);
}

bootstrap();
