'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ErrorNote } from '@/components/ui';

interface DemoAccounts {
  password: string;
  accounts: { email: string; label: { id: string; en: string } }[];
}

export default function LoginPage() {
  const { t, tr } = useI18n();
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Demo logins come from platform_settings (demo.accounts) and are empty unless demo.showAccounts is on.
  const [demo, setDemo] = useState<DemoAccounts>({ password: '', accounts: [] });
  useEffect(() => {
    api<DemoAccounts>('/public/demo-accounts')
      .then(setDemo)
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      router.push(homeFor(u));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-300">
          {t('brand.tagline')}
        </p>
        <p className="mt-1 text-sm text-slate-400">{t('brand.universal')}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={submit} className="card space-y-4">
          <h1 className="text-xl font-semibold text-white">{t('auth.login.title')}</h1>
          <div>
            <label className="label" htmlFor="email">
              {t('auth.email')}
            </label>
            <input
              id="email"
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              {t('auth.password')}
            </label>
            <input
              id="password"
              className="input"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <ErrorNote error={error} />
          <button className="btn-primary w-full" disabled={busy}>
            {t('nav.login')}
          </button>
          <p className="text-sm text-slate-400">
            {t('auth.noAccount')}{' '}
            <Link className="text-sky-400" href="/register">
              {t('nav.register')}
            </Link>
          </p>
        </form>

        {demo.accounts.length > 0 && (
          <div className="card space-y-3">
            <h2 className="font-semibold text-white">{t('auth.demo.title')}</h2>
            <p className="text-sm text-slate-400">{t('auth.demo.hint')}</p>
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
              {demo.accounts.map((d) => (
                <li key={d.email}>
                  <button
                    type="button"
                    className="btn-ghost w-full justify-between text-left"
                    onClick={() => {
                      setEmail(d.email);
                      setPassword(demo.password);
                    }}
                  >
                    <span>{tr(d.label)}</span>
                    <span className="text-xs text-slate-400">{d.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
