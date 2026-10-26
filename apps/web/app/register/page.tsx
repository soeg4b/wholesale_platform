'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { homeFor, useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ErrorNote } from '@/components/ui';

export default function RegisterPage() {
  const { t, locale } = useI18n();
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: '',
    companyName: '',
    email: '',
    password: '',
    role: 'PENYEWA',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await register({ ...form, locale: locale.toUpperCase() });
      router.push(homeFor(u));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold text-white">{t('auth.register.title')}</h1>
      <div className="grid grid-cols-2 gap-2">
        {(['PENYEWA', 'PENYELENGGARA'] as const).map((r) => (
          <button
            type="button"
            key={r}
            onClick={() => set('role', r)}
            className={`rounded-lg border px-3 py-3 text-left text-sm ${form.role === r ? 'border-brand-500 bg-brand-500/10 text-white' : 'border-slate-700 text-slate-300'}`}
          >
            <span className="block font-medium">{t(`role.${r}`)}</span>
            <span className="text-xs text-slate-400">{t(`role.${r}.desc`)}</span>
          </button>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="fullName">
          {t('auth.fullName')}
        </label>
        <input
          id="fullName"
          className="input"
          required
          minLength={2}
          value={form.fullName}
          onChange={(e) => set('fullName', e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="company">
          {t('auth.company')}
        </label>
        <input
          id="company"
          className="input"
          required
          minLength={2}
          value={form.companyName}
          onChange={(e) => set('companyName', e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="email">
          {t('auth.email')}
        </label>
        <input
          id="email"
          className="input"
          type="email"
          required
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
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
          minLength={8}
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">{t('auth.passwordHint')}</p>
      </div>
      {form.role === 'PENYELENGGARA' && (
        <p className="text-sm text-amber-300">{t('auth.operatorApproval')}</p>
      )}
      <ErrorNote error={error} />
      <button className="btn-primary w-full" disabled={busy}>
        {t('nav.register')}
      </button>
    </form>
  );
}
