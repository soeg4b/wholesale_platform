import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.service';
import { LedgerService } from '../common/ledger.service';
import { AuthGuard, AuthUser, CurrentUser } from '../common/auth.guard';

export class RegisterDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(100) password: string;
  @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @IsString() @MinLength(2) @MaxLength(160) companyName: string;
  @IsIn(['PENYEWA', 'PENYELENGGARA']) role: 'PENYEWA' | 'PENYELENGGARA';
  @IsOptional() @IsIn(['ID', 'EN']) locale?: 'ID' | 'EN';
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MaxLength(100) password: string;
}

const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60_000;

const blocked = (key: string, max: number) => {
  const rec = attempts.get(key);
  return !!rec && Date.now() - rec.first < WINDOW_MS && rec.count >= max;
};

function recordFailure(key: string) {
  const now = Date.now();
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (now - v.first >= WINDOW_MS) attempts.delete(k);
    if (attempts.size > 50_000) attempts.clear();
  }
  const rec = attempts.get(key);
  if (rec && now - rec.first < WINDOW_MS) rec.count++;
  else attempts.set(key, { count: 1, first: now });
}

// Compared against when the account does not exist so response time does not reveal registered emails.
let dummyHash: string | undefined;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly ledger: LedgerService,
  ) {}

  private async issue(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
        operatorProfile: { select: { id: true, approvalStatus: true, displayName: true } },
        buyerProfile: { select: { id: true, companyName: true } },
      },
    });
    const roles = user.roles.map((r) => r.role.key);
    const perms = [
      ...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))),
    ];
    const payload: AuthUser = {
      sub: user.id,
      email: user.email,
      roles,
      perms,
      locale: user.locale,
    };
    return {
      token: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        locale: user.locale,
        roles,
        perms,
        operator: user.operatorProfile,
        buyer: user.buyerProfile,
      },
    };
  }

  async register(dto: RegisterDto, ip?: string) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email already registered');
    }
    const role = await this.prisma.role.findUnique({ where: { key: dto.role } });
    if (!role) throw new BadRequestException('Role not configured');
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        fullName: dto.fullName,
        locale: dto.locale ?? 'ID',
        status: 'ACTIVE',
        roles: { create: { roleId: role.id } },
        ...(dto.role === 'PENYELENGGARA'
          ? {
              operatorProfile: {
                create: {
                  slug: `${dto.companyName
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '')}-${Date.now().toString(36)}`,
                  legalName: dto.companyName,
                  displayName: dto.companyName,
                },
              },
            }
          : { buyerProfile: { create: { companyName: dto.companyName } } }),
      },
    });
    await this.ledger.appendSafe({
      eventType: 'USER_EVENT',
      status: 'SUCCESS',
      action: 'user.registered',
      actorUserId: user.id,
      entityType: 'User',
      entityId: user.id,
      requestPayload: { email, role: dto.role },
      ipAddress: ip,
    });
    return this.issue(user.id);
  }

  async login(dto: LoginDto, ip?: string) {
    const email = dto.email.toLowerCase();
    const key = `${ip}|${email}`;
    const keys = [
      [key, 8],
      [`ip:${ip}`, 50],
      [`email:${email}`, 30],
    ] as const;
    if (keys.some(([k, max]) => blocked(k, max))) {
      throw new UnauthorizedException('Too many attempts, try again later');
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    let ok = false;
    if (user?.passwordHash && user.status !== 'SUSPENDED' && !user.deletedAt) {
      ok = await bcrypt.compare(dto.password, user.passwordHash);
    } else {
      dummyHash ??= await bcrypt.hash('timing-equalizer', 12);
      await bcrypt.compare(dto.password, dummyHash);
    }
    if (!user || !ok) {
      keys.forEach(([k]) => recordFailure(k));
      await this.ledger.appendSafe({
        eventType: 'USER_EVENT',
        status: 'FAILED',
        action: 'user.login',
        actorUserId: user?.id,
        requestPayload: { email },
        ipAddress: ip,
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    attempts.delete(key);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.ledger.appendSafe({
      eventType: 'USER_EVENT',
      status: 'SUCCESS',
      action: 'user.login',
      actorUserId: user.id,
      ipAddress: ip,
    });
    return this.issue(user.id);
  }

  me(userId: string) {
    return this.issue(userId);
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: { ip?: string }) {
    return this.auth.register(dto, req.ip);
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: { ip?: string }) {
    return this.auth.login(dto, req.ip);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }
}

@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
