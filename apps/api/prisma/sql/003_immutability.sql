-- Append-only enforcement. Idempotent. Section 1 is identical to apply-triggers.ts (ledger, new event
-- types TICKET/ADDON_CHANGE/INSIGHT need no trigger change); section 2 extends it to ticket updates.

-- 1. transaction_logs: no UPDATE/DELETE/TRUNCATE, ever.
CREATE OR REPLACE FUNCTION transaction_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transaction_logs is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transaction_logs_no_update ON transaction_logs;
CREATE TRIGGER transaction_logs_no_update BEFORE UPDATE OR DELETE ON transaction_logs
  FOR EACH ROW EXECUTE FUNCTION transaction_logs_immutable();
DROP TRIGGER IF EXISTS transaction_logs_no_truncate ON transaction_logs;
CREATE TRIGGER transaction_logs_no_truncate BEFORE TRUNCATE ON transaction_logs
  FOR EACH STATEMENT EXECUTE FUNCTION transaction_logs_immutable();

-- 2. link_ticket_updates: UPDATE/TRUNCATE rejected; DELETE only for rows of demo tickets (idempotent seed).
CREATE OR REPLACE FUNCTION link_ticket_updates_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM link_tickets t WHERE t."id" = OLD."ticketId" AND t."isDemo") THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'link_ticket_updates is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS link_ticket_updates_no_change ON link_ticket_updates;
CREATE TRIGGER link_ticket_updates_no_change BEFORE UPDATE OR DELETE ON link_ticket_updates
  FOR EACH ROW EXECUTE FUNCTION link_ticket_updates_immutable();
DROP TRIGGER IF EXISTS link_ticket_updates_no_truncate ON link_ticket_updates;
CREATE TRIGGER link_ticket_updates_no_truncate BEFORE TRUNCATE ON link_ticket_updates
  FOR EACH STATEMENT EXECUTE FUNCTION link_ticket_updates_immutable();
