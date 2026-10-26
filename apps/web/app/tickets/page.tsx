'use client';

import { useI18n } from '@/lib/i18n';
import { RequireRole } from '@/components/ui';
import { TicketTable } from '@/components/TicketTable';

export default function Page() {
  const { t } = useI18n();
  return (
    <RequireRole roles={['PENYEWA', 'PENYELENGGARA', 'ADMIN']}>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-white">{t('nav.tickets')}</h1>
        <TicketTable />
      </div>
    </RequireRole>
  );
}
