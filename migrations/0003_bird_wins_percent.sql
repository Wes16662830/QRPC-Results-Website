-- Race selection per competition: every included race, or only races the admin picks (distance bands).
ALTER TABLE competition ADD COLUMN race_selection TEXT NOT NULL DEFAULT 'all' CHECK (race_selection IN ('all','picked'));

-- Races picked for a 'picked' competition.
CREATE TABLE competition_inclusion (
  competition_id INTEGER NOT NULL REFERENCES competition(id),
  race_id        INTEGER NOT NULL REFERENCES race(id),
  PRIMARY KEY (competition_id, race_id)
);

-- Numerator / denominator behind a race score, for ratio competitions (top X % of basketed).
ALTER TABLE race_calc_score ADD COLUMN points REAL;
ALTER TABLE race_calc_score ADD COLUMN basketed INTEGER;

INSERT INTO competition (club_id, name, slug, system, display_order, active, created_at, visibility, race_selection) VALUES
  (1, 'Best overall bird',          'best-bird',        'bird-points', 1, 1, '2026-11-18T15:00:00Z', 'members', 'all'),
  (1, 'Best short distance bird',   'best-short-bird',  'bird-points', 2, 1, '2026-11-18T15:00:00Z', 'members', 'picked'),
  (1, 'Best middle distance bird',  'best-middle-bird', 'bird-points', 3, 1, '2026-11-18T15:00:00Z', 'members', 'picked'),
  (1, 'Best long distance bird',    'best-long-bird',   'bird-points', 4, 1, '2026-11-18T15:00:00Z', 'members', 'picked'),
  (1, 'Race wins',                  'wins',             'wins',        5, 1, '2026-11-18T15:00:00Z', 'members', 'all'),
  (1, 'Top 25% of basketed',        'top-25',           'top-percent', 6, 1, '2026-11-18T15:00:00Z', 'members', 'all');

INSERT INTO competition_version (competition_id, params_json, races_counted, best_x, created_at, actor)
SELECT id, CASE WHEN system = 'top-percent' THEN '{"percent":25}' ELSE '{}' END, 'all', NULL, '2026-11-18T15:00:00Z', 'system'
FROM competition WHERE club_id = 1 AND slug IN ('best-bird','best-short-bird','best-middle-bird','best-long-bird','wins','top-25');
