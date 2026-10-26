'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

interface SlaTicket {
  status: string;
  ackAt?: string | null;
  resolvedAt?: string | null;
  ackDueAt: string;
  resolveDueAt: string;
  ackBreachedAt?: string | null;
  resolveBreachedAt?: string | null;
}

const fmt = (ms: number) => {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

// Shows the next SLA deadline; colour is paired with an icon and text, and ticks silently.
export function SlaCountdown({ ticket }: { ticket: SlaTicket }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const done = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';
  if (done) {
    const breached = !!(ticket.ackBreachedAt || ticket.resolveBreachedAt);
    return breached ? (
      <span className="text-red-300">&#9888; {t('ticket.sla.breached')}</span>
    ) : (
      <span className="text-emerald-300">&#10003; {t('ticket.sla.met')}</span>
    );
  }
  const waitingAck = ticket.status === 'OPEN';
  const due = new Date(waitingAck ? ticket.ackDueAt : ticket.resolveDueAt).getTime();
  const late = now > due || (waitingAck ? ticket.ackBreachedAt : ticket.resolveBreachedAt);
  return late ? (
    <span className="text-red-300">&#9888; {t('ticket.sla.late', { t: fmt(now - due) })}</span>
  ) : (
    <span className="text-slate-300">
      {waitingAck ? t('ticket.sla.ack') : t('ticket.sla.resolve')}{' '}
      {t('ticket.sla.left', { t: fmt(due - now) })}
    </span>
  );
}
