'use client';

import Image from 'next/image';
import { useI18n } from '@/lib/i18n';

// Brand strip: the platform stays universal (vendor-agnostic, non-discriminative); the TBG logo
// only marks who it is built for.
export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-14 border-t border-slate-800">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-8 text-center">
        <p className="max-w-2xl text-sm text-slate-400">{t('brand.universal')}</p>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            {t('brand.poweredBy')}
          </span>
          <a
            href="https://www.tower-bersama.com/id"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-white/95 px-3 py-1.5"
            aria-label="Tower Bersama Group"
          >
            <Image
              src="/brand/tbig-logo.webp"
              alt="Tower Bersama Group"
              width={112}
              height={28}
              className="h-7 w-auto"
            />
          </a>
        </div>
        <p className="text-xs text-slate-600">{t('brand.rights')}</p>
      </div>
    </footer>
  );
}
