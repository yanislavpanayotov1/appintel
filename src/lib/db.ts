import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS apps (
  id            INTEGER PRIMARY KEY,         -- Apple trackId
  bundle_id     TEXT,
  name          TEXT NOT NULL,
  developer     TEXT,
  developer_id  INTEGER,
  genre_id      INTEGER,
  genre_name    TEXT,
  price         REAL DEFAULT 0,               -- US price (or first country seen)
  currency      TEXT,
  icon_url      TEXT,
  url           TEXT,
  release_date  TEXT,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  details_at    TEXT                          -- last successful details lookup
);

CREATE TABLE IF NOT EXISTS chart_ranks (
  date      TEXT NOT NULL,
  country   TEXT NOT NULL,
  chart     TEXT NOT NULL CHECK (chart IN ('grossing','free','paid')),
  genre_id  INTEGER NOT NULL,                 -- 0 = overall
  rank      INTEGER NOT NULL,
  app_id    INTEGER NOT NULL,
  PRIMARY KEY (date, country, chart, genre_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_ranks_app ON chart_ranks(app_id, country, date);

CREATE TABLE IF NOT EXISTS app_snapshots (
  date          TEXT NOT NULL,
  country       TEXT NOT NULL,
  app_id        INTEGER NOT NULL,
  price         REAL,
  currency      TEXT,
  rating_count  INTEGER,
  rating_avg    REAL,
  version       TEXT,
  PRIMARY KEY (date, country, app_id)
);

CREATE TABLE IF NOT EXISTS rank_maps (
  date      TEXT NOT NULL,
  country   TEXT NOT NULL,
  chart     TEXT NOT NULL,
  genre_id  INTEGER NOT NULL,
  alpha     REAL NOT NULL,                    -- ln(overall) = alpha + beta * ln(category)
  beta      REAL NOT NULL,
  n_points  INTEGER NOT NULL,
  method    TEXT NOT NULL,                    -- fitted | anchored | pooled | unmapped
  PRIMARY KEY (date, country, chart, genre_id)
);

CREATE TABLE IF NOT EXISTS estimates (
  date               TEXT NOT NULL,
  country            TEXT NOT NULL,
  app_id             INTEGER NOT NULL,
  revenue            REAL,                    -- gross USD/day
  revenue_low        REAL,
  revenue_high       REAL,
  revenue_method     TEXT,
  confidence         TEXT,
  grossing_eq_rank   REAL,
  downloads          REAL,
  downloads_eq_rank  REAL,
  downloads_chart    TEXT,
  calibrated         INTEGER NOT NULL DEFAULT 0,
  model_version      TEXT NOT NULL,
  PRIMARY KEY (date, country, app_id)
);
CREATE INDEX IF NOT EXISTS idx_est_app ON estimates(app_id, date);
CREATE INDEX IF NOT EXISTS idx_est_date ON estimates(date, country);

CREATE TABLE IF NOT EXISTS calibration_points (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id        INTEGER NOT NULL,
  country       TEXT NOT NULL,                -- ISO code, or 'ww' = all tracked countries combined
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,                -- inclusive
  revenue_usd   REAL NOT NULL,
  revenue_type  TEXT NOT NULL CHECK (revenue_type IN ('gross','proceeds')),
  source        TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_params (
  scope       TEXT NOT NULL,                  -- 'global' or a country code
  chart       TEXT NOT NULL,
  scale       REAL NOT NULL,                  -- multiplier on prior A
  b           REAL NOT NULL,
  n_points    INTEGER NOT NULL,
  log_rmse    REAL,                           -- residual std in ln space
  mape        REAL,
  fitted_at   TEXT NOT NULL,
  PRIMARY KEY (scope, chart)
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  date           TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  status         TEXT NOT NULL,               -- running | ok | partial | failed
  countries      TEXT NOT NULL,
  feeds_ok       INTEGER DEFAULT 0,
  feeds_failed   INTEGER DEFAULT 0,
  ranks_saved    INTEGER DEFAULT 0,
  apps_detailed  INTEGER DEFAULT 0,
  details_source TEXT,
  error          TEXT
);
`;

let instance: Database.Database | null = null;

export function dbPath(): string {
  return path.resolve(process.env.APPINTEL_DB ?? path.join(process.cwd(), 'data', 'appintel.db'));
}

export function getDb(): Database.Database {
  if (instance) return instance;
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  instance = db;
  return db;
}

/** For tests: an isolated in-memory database with the full schema. */
export function createMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

export type DB = Database.Database;
