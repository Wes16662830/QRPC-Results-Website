-- Best bird competitions: the first race of the season sets the points scale (agreed with Wes, 18 Nov 2026).
-- 1st = birds home in that race, then one point less per place in every race; places beyond it score 0.
UPDATE competition SET system = 'bird-points-base' WHERE club_id = 1 AND system = 'bird-points';
