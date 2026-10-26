import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';

// Applies prisma/sql/*.sql in order via psql (files hold multi-statement DDL, functions and DO blocks).
// Idempotent; re-run after every `db:push` because db:push drops indexes Prisma does not know.
function psqlBinary() {
  if (process.env.PSQL_BIN) return process.env.PSQL_BIN;
  const windows = 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';
  return existsSync(windows) ? windows : 'psql';
}

export function applySql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const u = new URL(url);
  const conn = [
    '-w',
    '-h',
    u.hostname,
    '-p',
    u.port || '5432',
    '-U',
    decodeURIComponent(u.username),
    '-d',
    u.pathname.slice(1),
  ];
  const dir = join(__dirname, 'sql');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    execFileSync(psqlBinary(), [...conn, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, file)], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(u.password ? { PGPASSWORD: decodeURIComponent(u.password) } : {}),
      },
    });
    console.log(`applied ${file}`);
  }
}

if (require.main === module) applySql();
