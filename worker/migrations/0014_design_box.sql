-- Round 14: per-design shop box look (frame colour) and the black outline picture shown inside the box (uploaded in the admin "Designs" tab).
-- Run once BEFORE deploying the new Worker:
--   npx wrangler d1 execute ofst-orders --remote --file=./migrations/0014_design_box.sql
-- box_color     : hex colour of the frame around the design's box in the shop (NULL = default sky blue).
-- outline       : the outline picture (a cleaned SVG, vector shapes only) shown on the right of the box.
-- outline_scale : how big the outline is drawn, in percent (NULL = 100).
-- outline_ver   : goes up every time the outline changes, so browsers fetch the new picture.
ALTER TABLE designs ADD COLUMN box_color TEXT;
ALTER TABLE designs ADD COLUMN outline TEXT;
ALTER TABLE designs ADD COLUMN outline_scale INTEGER;
ALTER TABLE designs ADD COLUMN outline_ver INTEGER NOT NULL DEFAULT 0;
