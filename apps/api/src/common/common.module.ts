import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { CryptoService } from './crypto.service';
import { LedgerService } from './ledger.service';
import { SettingsService } from './settings.service';
import { AuthGuard } from './auth.guard';
import { OperatorContext } from './operator-context.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_ACCESS_SECRET || 'dev-only-insecure-secret',
      signOptions: { expiresIn: '8h' },
    }),
  ],
  providers: [
    PrismaService,
    CryptoService,
    LedgerService,
    SettingsService,
    AuthGuard,
    OperatorContext,
  ],
  exports: [
    PrismaService,
    CryptoService,
    LedgerService,
    SettingsService,
    AuthGuard,
    OperatorContext,
  ],
})
export class CommonModule {}
