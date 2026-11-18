-- QRPC Results: initial schema (Cloudflare D1 / SQLite).
-- Times are ISO-8601 UTC strings unless named *_local (SAST, Africa/Johannesburg).
-- Every table carries club_id so multi-club support (Phase 2) needs no migration.

CREATE TABLE club (
  id              INTEGER PRIMARY KEY,
  benzing_org_id  INTEGER NOT NULL UNIQUE,
  country         TEXT    NOT NULL,          -- Benzing country path, e.g. 'za'
  name            TEXT    NOT NULL,
  short_name      TEXT    NOT NULL
);
INSERT INTO club (id, benzing_org_id, country, name, short_name)
VALUES (1, 48, 'za', 'Queenstown Racing Pigeon Club', 'QRPC');

CREATE TABLE fancier (
  id                 INTEGER PRIMARY KEY,
  club_id            INTEGER NOT NULL REFERENCES club(id),
  name               TEXT    NOT NULL,
  benzing_fancier_id INTEGER,
  UNIQUE (club_id, name)
);
CREATE UNIQUE INDEX fancier_benzing ON fancier (club_id, benzing_fancier_id) WHERE benzing_fancier_id IS NOT NULL;

CREATE TABLE race (
  id                  INTEGER PRIMARY KEY,
  club_id             INTEGER NOT NULL REFERENCES club(id),
  benzing_race_id     INTEGER NOT NULL,
  season              INTEGER NOT NULL,
  race_number         INTEGER,
  name                TEXT    NOT NULL,
  slug                TEXT    NOT NULL,
  race_date           TEXT    NOT NULL,       -- YYYY-MM-DD (local)
  liberation_time_local TEXT,                 -- HH:MM:SS, NULL if not yet known
  liberation_point    TEXT,
  min_distance_m      INTEGER,
  max_distance_m      INTEGER,
  basketed_total      INTEGER,
  fanciers_total      INTEGER,
  benzing_status      TEXT,
  kind                TEXT    NOT NULL CHECK (kind IN ('race','training')),
  included            INTEGER NOT NULL DEFAULT 1,   -- counts for the championship
  full_result_id      INTEGER,                      -- Benzing result id with percentage = 100
  results_json        TEXT,                         -- Benzing results[] summary (id, type, percentage)
  live_mode           TEXT    NOT NULL DEFAULT 'auto' CHECK (live_mode IN ('auto','on','off')),
  live_last_polled_at TEXT,
  synced_at           TEXT,
  UNIQUE (club_id, benzing_race_id)
);

-- One captured copy of Benzing data. Stored only when its content changes.
CREATE TABLE snapshot (
  id             INTEGER PRIMARY KEY,
  race_id        INTEGER NOT NULL REFERENCES race(id),
  source         TEXT    NOT NULL CHECK (source IN ('sheet','live')),
  fetched_at     TEXT    NOT NULL,
  source_url     TEXT    NOT NULL,
  content_sha256 TEXT    NOT NULL,
  header_json    TEXT,
  arrivals_json  TEXT    NOT NULL,      -- normalised arrivals (see src/server/types.ts)
  arrival_count  INTEGER NOT NULL,
  benzing_recalculated TEXT            -- "Last re-calculation" on the sheet
);
CREATE INDEX snapshot_race ON snapshot (race_id, source, id);

-- Basketed / returned per fancier per race, from the latest sheet snapshot.
CREATE TABLE race_entry (
  race_id     INTEGER NOT NULL REFERENCES race(id),
  fancier_id  INTEGER NOT NULL REFERENCES fancier(id),
  basketed    INTEGER NOT NULL,
  returned    INTEGER NOT NULL,
  PRIMARY KEY (race_id, fancier_id)
);

CREATE TABLE override (
  id          INTEGER PRIMARY KEY,
  race_id     INTEGER NOT NULL REFERENCES race(id),
  scope       TEXT    NOT NULL CHECK (scope IN ('bird','fancier')),
  target      TEXT    NOT NULL,              -- ring, or fancier id as text
  reason      TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  revoked_at  TEXT,
  revoked_by  TEXT
);

-- Championship settings. Rows are never updated: each change inserts a new version.
CREATE TABLE settings_version (
  id             INTEGER PRIMARY KEY,
  club_id        INTEGER NOT NULL REFERENCES club(id),
  scoring_birds  INTEGER NOT NULL CHECK (scoring_birds >= 1),
  races_counted  TEXT    NOT NULL CHECK (races_counted IN ('all','best')),
  best_x         INTEGER,
  created_at     TEXT    NOT NULL,
  actor          TEXT    NOT NULL
);
INSERT INTO settings_version (club_id, scoring_birds, races_counted, best_x, created_at, actor)
VALUES (1, 5, 'all', NULL, '2026-11-18T00:00:00Z', 'system');

-- A stored 5-bird calculation for one race, with everything needed to audit or redo it.
CREATE TABLE race_calc (
  id                  INTEGER PRIMARY KEY,
  race_id             INTEGER NOT NULL REFERENCES race(id),
  snapshot_id         INTEGER NOT NULL REFERENCES snapshot(id),
  settings_version_id INTEGER NOT NULL REFERENCES settings_version(id),
  overrides_json      TEXT    NOT NULL,
  result_json         TEXT    NOT NULL,       -- RaceCalculation from the engine
  inputs_sha256       TEXT    NOT NULL,
  status              TEXT    NOT NULL CHECK (status IN ('draft','published','superseded')),
  created_at          TEXT    NOT NULL,
  created_by          TEXT    NOT NULL,
  published_at        TEXT,
  published_by        TEXT
);
CREATE INDEX race_calc_race ON race_calc (race_id, status);

CREATE TABLE race_calc_score (
  race_calc_id  INTEGER NOT NULL REFERENCES race_calc(id),
  fancier_id    INTEGER NOT NULL REFERENCES fancier(id),
  birds_scored  INTEGER NOT NULL,
  score         INTEGER NOT NULL,
  PRIMARY KEY (race_calc_id, fancier_id)
);

CREATE TABLE alert (
  id           INTEGER PRIMARY KEY,
  at           TEXT NOT NULL,
  level        TEXT NOT NULL CHECK (level IN ('info','warning','error')),
  source       TEXT NOT NULL,
  race_id      INTEGER REFERENCES race(id),
  message      TEXT NOT NULL,
  resolved_at  TEXT
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail_json TEXT
);

-- Key/value settings that are not championship rules (e.g. the member password hash).
CREATE TABLE app_setting (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Failed member logins, for simple brute-force limiting (10 per IP per 15 minutes).
CREATE TABLE login_failure (
  ip  TEXT NOT NULL,
  at  TEXT NOT NULL
);
CREATE INDEX login_failure_ip ON login_failure (ip, at);
