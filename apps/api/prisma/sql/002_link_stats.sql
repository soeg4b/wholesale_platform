-- Per-link latency statistics and outage minutes. Call via prisma.$queryRaw, e.g.
--   SELECT * FROM link_latency_stats($1::text[], $2::timestamptz, $3::timestamptz, $4::boolean)
-- $4 = include demo rows (true only when setting demo.countInMetrics = true). Percentiles are exact (percentile_cont).

CREATE OR REPLACE FUNCTION link_latency_stats(
  p_link_ids text[], p_from timestamptz, p_to timestamptz, p_include_demo boolean
) RETURNS TABLE (
  network_link_id text, samples bigint, latency_samples bigint,
  mean_ms double precision, p50_ms double precision, p95_ms double precision, stddev_ms double precision,
  p95_util_pct double precision, first_at timestamptz, last_at timestamptz, coverage_days double precision,
  includes_demo boolean
) LANGUAGE sql STABLE AS $$
  SELECT s."networkLinkId",
         count(*) FILTER (WHERE NOT s."plannedMaintenance" AND (s."latencyMs" IS NOT NULL OR s."opStatus" IS NOT NULL)),
         count(s."latencyMs") FILTER (WHERE NOT s."plannedMaintenance"),
         avg(s."latencyMs") FILTER (WHERE NOT s."plannedMaintenance"),
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY s."latencyMs") FILTER (WHERE NOT s."plannedMaintenance"),
         percentile_cont(0.95) WITHIN GROUP (ORDER BY s."latencyMs") FILTER (WHERE NOT s."plannedMaintenance"),
         stddev_samp(s."latencyMs") FILTER (WHERE NOT s."plannedMaintenance"),
         percentile_cont(0.95) WITHIN GROUP (ORDER BY s."utilizationPct") FILTER (WHERE s."utilizationPct" IS NOT NULL),
         min(s."recordedAt"), max(s."recordedAt"),
         extract(epoch FROM (max(s."recordedAt") - min(s."recordedAt"))) / 86400.0,
         bool_or(s."isDemo")
  FROM link_metric_snapshots s
  WHERE s."networkLinkId" = ANY (p_link_ids)
    AND s."recordedAt" >= p_from AND s."recordedAt" < p_to
    AND (p_include_demo OR NOT s."isDemo")
  GROUP BY s."networkLinkId"
$$;

-- Measured outage intervals (SYSTEM OUTAGE tickets) clipped to the window; open incidents run to now().
CREATE OR REPLACE FUNCTION link_outage_minutes(
  p_link_ids text[], p_from timestamptz, p_to timestamptz, p_include_demo boolean
) RETURNS TABLE (network_link_id text, outage_count bigint, outage_minutes double precision)
LANGUAGE sql STABLE AS $$
  SELECT t."networkLinkId", count(*),
         sum(extract(epoch FROM (least(coalesce(t."incidentEndAt", now()), p_to)
                               - greatest(t."incidentStartAt", p_from))) / 60.0)
  FROM link_tickets t
  WHERE t."networkLinkId" = ANY (p_link_ids)
    AND t."source" = 'SYSTEM' AND t."kind" = 'OUTAGE' AND t."incidentStartAt" IS NOT NULL
    AND t."incidentStartAt" < p_to AND coalesce(t."incidentEndAt", now()) > p_from
    AND (p_include_demo OR NOT t."isDemo")
  GROUP BY t."networkLinkId"
$$;
