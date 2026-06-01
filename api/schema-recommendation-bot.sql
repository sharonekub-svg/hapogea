create table if not exists public.recommendations (
  id text primary key,
  event_id text,
  result_key text,
  sport text not null,
  sport_id integer,
  match_date date not null,
  kickoff_time text,
  league text,
  home_team text,
  away_team text,
  match_name text,
  market_id text,
  outcome_id text,
  market text,
  algorithm_pick text,
  pick_team text,
  odds_at_recommendation numeric,
  odds_source text default 'Winner',
  recommendation_type text default 'premium',
  score numeric,
  probability numeric,
  status text not null default 'pending' check (status in ('pending','won','lost','cancelled','unknown')),
  result text,
  actual_winner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.match_results (
  id text primary key,
  event_id text,
  result_key text,
  sport text,
  sport_id integer,
  match_date date,
  kickoff_time text,
  league text,
  home_team text,
  away_team text,
  match_name text,
  final_score text,
  actual_winner text,
  result_status text not null default 'unknown' check (result_status in ('final','cancelled','unknown')),
  source text,
  verified_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.daily_stats (
  stat_date date primary key,
  total integer not null default 0,
  won integer not null default 0,
  lost integer not null default 0,
  pending integer not null default 0,
  cancelled integer not null default 0,
  unknown integer not null default 0,
  success_rate numeric not null default 0,
  average_odds numeric not null default 0,
  theoretical_profit_ils integer not null default 0,
  roi_percent numeric not null default 0,
  settled integer not null default 0,
  generated_at timestamptz not null default now()
);

-- Migration: add roi_percent if upgrading from older schema
alter table if exists public.daily_stats add column if not exists roi_percent numeric not null default 0;

create index if not exists recommendations_match_date_idx on public.recommendations(match_date);
create index if not exists recommendations_status_idx on public.recommendations(status);
create index if not exists recommendations_sport_idx on public.recommendations(sport);
create index if not exists recommendations_type_idx on public.recommendations(recommendation_type);
create index if not exists match_results_match_date_idx on public.match_results(match_date);
