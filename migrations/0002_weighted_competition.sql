-- Who can see a competition: everyone signed in, or admins only (while it is being evaluated).
ALTER TABLE competition ADD COLUMN visibility TEXT NOT NULL DEFAULT 'members' CHECK (visibility IN ('members','admin'));

-- Per-race settings for one competition, e.g. the closing day and time of the weighted system.
CREATE TABLE competition_race_param (
  competition_id INTEGER NOT NULL REFERENCES competition(id),
  race_id        INTEGER NOT NULL REFERENCES race(id),
  params_json    TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  actor          TEXT    NOT NULL,
  PRIMARY KEY (competition_id, race_id)
);

-- Wes's weighted-by-basketing competition, admin-only until he decides to show members.
INSERT INTO competition (club_id, name, slug, system, display_order, active, created_at, visibility)
VALUES (1, 'Weighted points', 'weighted', 'weighted-by-basketing', 10, 1, '2026-11-18T13:00:00Z', 'admin');
INSERT INTO competition_version (competition_id, params_json, races_counted, best_x, created_at, actor)
SELECT id, '{}', 'all', NULL, '2026-11-18T13:00:00Z', 'system' FROM competition WHERE slug = 'weighted' AND club_id = 1;
