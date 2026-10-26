import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class OperatorContext {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const op = await this.prisma.operatorProfile.findUnique({ where: { userId } });
    if (!op || op.deletedAt) throw new ForbiddenException('No operator profile');
    return op;
  }

  async getApproved(userId: string) {
    const op = await this.get(userId);
    if (op.approvalStatus !== 'APPROVED') {
      throw new ForbiddenException('Operator account is not approved yet');
    }
    return op;
  }
}
