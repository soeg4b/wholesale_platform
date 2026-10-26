import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { GeoModule } from './geo/geo.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { LinksModule } from './links/links.module';
import { AiModule } from './ai/ai.module';
import { ReservationsModule } from './reservations/reservations.module';
import { InteractionsModule } from './interactions/interactions.module';
import { ExplorerModule } from './explorer/explorer.module';
import { QualityModule } from './quality/quality.module';
import { TicketsModule } from './tickets/tickets.module';
import { InsightsModule } from './insights/insights.module';
import { AddOnsModule } from './addons/addons.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProfileModule } from './profile/profile.module';
import { LinkRequestsModule } from './link-requests/link-requests.module';
import { PrebuildModule } from './prebuild/prebuild.module';
import { ProviderModule } from './provider/provider.module';
import { DataModule } from './data/data.module';
import { HealthController } from './health.controller';
import {
  MockNusaLinkController,
  MockGarudaController,
  MockIncidentController,
} from './mock-operator/mock-operator.controller';

// The simulated operator APIs hold hard-coded tokens, so they are never mounted in production unless explicitly enabled.
const MOCK_OPERATOR_ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.ENABLE_MOCK_OPERATOR === 'true';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule,
    AuthModule,
    AdminModule,
    GeoModule,
    IntegrationsModule,
    LinksModule,
    AiModule,
    ReservationsModule,
    InteractionsModule,
    ExplorerModule,
    QualityModule,
    TicketsModule,
    InsightsModule,
    AddOnsModule,
    NotificationsModule,
    ProfileModule,
    LinkRequestsModule,
    PrebuildModule,
    ProviderModule,
    DataModule,
  ],
  controllers: [
    HealthController,
    ...(MOCK_OPERATOR_ENABLED
      ? [MockNusaLinkController, MockGarudaController, MockIncidentController]
      : []),
  ],
})
export class AppModule {}
