import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';

// Unauthenticated liveness + DB readiness probe for Docker/CI/load balancers (GET /api/health).
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: true };
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', db: false });
    }
  }
}
