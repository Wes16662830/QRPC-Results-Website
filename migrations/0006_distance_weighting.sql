-- Distance weighting per competition (agreed with Wes, 19 Nov 2026): race points × race average km ÷
-- the competition's first race average km this season. Versioned like the other settings; off by default.
ALTER TABLE competition_version ADD COLUMN distance_weighting INTEGER NOT NULL DEFAULT 0;
