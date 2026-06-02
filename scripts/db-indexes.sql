-- ── GIN trigram indexes for ILIKE logo search ─────────────────────────────
-- Required because supabaseSearch() uses:
--   name_he.ilike.*term*  (wildcard prefix → B-tree can't help)
--   name.ilike.*term*
--   slug.ilike.*term*
-- pg_trgm GIN indexes make these O(log n) instead of full-table scans.
--
-- Run once in Supabase SQL editor:
--   supabase.com → project → SQL Editor → paste & run

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_name_he_trgm
  ON teams USING gin (name_he gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_name_trgm
  ON teams USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_slug_trgm
  ON teams USING gin (slug gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leagues_name_he_trgm
  ON leagues USING gin (name_he gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leagues_name_trgm
  ON leagues USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leagues_slug_trgm
  ON leagues USING gin (slug gin_trgm_ops);

-- ── Indexes for manual_results queries ────────────────────────────────────
-- _mrFetch() does: .eq("game_date", today)  — needs an index on game_date

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_manual_results_game_date
  ON manual_results (game_date);

-- ── Indexes for recommendation-db daily_stats ─────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_stats_stat_date
  ON daily_stats (stat_date DESC);
