-- 5-bird championship: the season's first race sets N for every race (agreed with Wes, 18 Nov 2026).
-- New settings version (versions are never edited); races counted / best X carry over.
INSERT INTO competition_version (competition_id, params_json, races_counted, best_x, created_at, actor)
SELECT c.id, '{"scoringBirds":5,"scale":"first-race"}', v.races_counted, v.best_x, '2026-11-18T18:00:00Z', 'system'
FROM competition c
JOIN competition_version v ON v.id = (SELECT MAX(id) FROM competition_version WHERE competition_id = c.id)
WHERE c.club_id = 1 AND c.slug = 'five-bird';
