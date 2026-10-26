-- Iteration 2 constraints/indexes Prisma cannot express. Idempotent; re-apply after every `db:push`
-- (db:push drops indexes it does not know, e.g. partial ones). Columns are camelCase (no @map in schema).

-- One open SYSTEM ticket per link (race loser gets P2002 and reads the existing ticket).
CREATE UNIQUE INDEX IF NOT EXISTS link_tickets_one_open_system_per_link
  ON link_tickets ("networkLinkId")
  WHERE "source" = 'SYSTEM' AND "status" IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS');

-- One public (right-of-reply) update per ticket.
CREATE UNIQUE INDEX IF NOT EXISTS link_ticket_updates_one_public_reply
  ON link_ticket_updates ("ticketId")
  WHERE "isPublicReply";

-- Hot aggregation scans counted rows only.
CREATE INDEX IF NOT EXISTS link_interactions_counted_link_idx
  ON link_interactions ("networkLinkId", "type", "createdAt") WHERE "counted";
CREATE INDEX IF NOT EXISTS link_interactions_counted_route_idx
  ON link_interactions ("routeKey", "createdAt") WHERE "counted" AND "routeKey" IS NOT NULL;

-- Unmet-demand scan.
CREATE INDEX IF NOT EXISTS link_interactions_unmet_idx
  ON link_interactions ("routeKey", "createdAt") WHERE "unmet" AND "counted";

DO $$
BEGIN
  -- Dedupe key exists exactly when the row is counted ("countedKey" itself is UNIQUE via Prisma).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'link_interactions_counted_chk') THEN
    ALTER TABLE link_interactions ADD CONSTRAINT link_interactions_counted_chk
      CHECK ("counted" = ("countedKey" IS NOT NULL));
  END IF;
  -- Every interaction targets a link or a node pair.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'link_interactions_target_chk') THEN
    ALTER TABLE link_interactions ADD CONSTRAINT link_interactions_target_chk
      CHECK ("networkLinkId" IS NOT NULL OR "routeKey" IS NOT NULL);
  END IF;
  -- SYSTEM tickets have no reporter; all others must.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'link_tickets_reporter_chk') THEN
    ALTER TABLE link_tickets ADD CONSTRAINT link_tickets_reporter_chk
      CHECK (("source" = 'SYSTEM') = ("reporterUserId" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'link_tickets_due_chk') THEN
    ALTER TABLE link_tickets ADD CONSTRAINT link_tickets_due_chk
      CHECK ("ackDueAt" <= "resolveDueAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'link_metric_snapshots_loss_chk') THEN
    ALTER TABLE link_metric_snapshots ADD CONSTRAINT link_metric_snapshots_loss_chk
      CHECK ("lossPct" IS NULL OR ("lossPct" >= 0 AND "lossPct" <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'link_performance_score_chk') THEN
    ALTER TABLE link_performance ADD CONSTRAINT link_performance_score_chk
      CHECK ("score" IS NULL OR ("score" BETWEEN 0 AND 100));
  END IF;
END $$;
