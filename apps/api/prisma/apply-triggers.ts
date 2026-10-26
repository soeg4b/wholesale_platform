import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

// Makes transaction_logs append-only at the database level.
export async function applyLedgerTriggers(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION transaction_logs_immutable() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'transaction_logs is append-only (% not allowed)', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS transaction_logs_no_update ON transaction_logs;`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER transaction_logs_no_update BEFORE UPDATE OR DELETE ON transaction_logs
    FOR EACH ROW EXECUTE FUNCTION transaction_logs_immutable();
  `);
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS transaction_logs_no_truncate ON transaction_logs;`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER transaction_logs_no_truncate BEFORE TRUNCATE ON transaction_logs
    FOR EACH STATEMENT EXECUTE FUNCTION transaction_logs_immutable();
  `);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  applyLedgerTriggers(prisma)
    .then(() => console.log('Ledger immutability triggers applied'))
    .finally(() => prisma.$disconnect());
}
