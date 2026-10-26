'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from './api';
import { useI18n } from './i18n';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  locale: 'ID' | 'EN';
  roles: string[];
  perms: string[];
  operator: { id: string; approvalStatus: string; displayName: string } | null;
  buyer: { id: string; companyName: string } | null;
}

interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (data: Record<string, unknown>) => Promise<SessionUser>;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
}

const Ctx = createContext<AuthCtx>(null as never);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { setLocale } = useI18n();

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api<{ user: SessionUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const accept = useCallback(
    (r: { token: string; user: SessionUser }) => {
      tokenStore.set(r.token);
      setUser(r.user);
      setLocale(r.user.locale === 'EN' ? 'en' : 'id');
      return r.user;
    },
    [setLocale],
  );

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      login: async (email, password) =>
        accept(await api('/auth/login', { body: { email, password } })),
      register: async (data) => accept(await api('/auth/register', { body: data })),
      logout: () => {
        tokenStore.clear();
        setUser(null);
        window.location.href = '/';
      },
      hasRole: (...roles) => !!user && roles.some((r) => user.roles.includes(r)),
    }),
    [user, loading, accept],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const homeFor = (u: SessionUser) =>
  u.roles.includes('ADMIN')
    ? '/admin'
    : u.roles.includes('PENYELENGGARA')
      ? '/operator'
      : '/explore';
