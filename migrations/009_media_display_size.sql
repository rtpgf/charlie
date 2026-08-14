-- The shape of the screen-sized copy of each photo.
--
-- Not decoration: an Echo Show pans across a photograph by laying it out larger
-- than the screen along one axis and sliding it. Which axis depends on whether
-- the photograph is taller or wider than it is the other, so the presentation
-- cannot be built without knowing the shape.
--
-- Nullable, because photos stored before this existed have no measurement and a
-- photo that cannot be measured is still a photo. Absent means "do not pan".
ALTER TABLE group_media
  ADD COLUMN IF NOT EXISTS display_width  integer,
  ADD COLUMN IF NOT EXISTS display_height integer;

COMMENT ON COLUMN group_media.display_width IS
  'Pixel width of the display copy, not the original. Null when unmeasured.';
COMMENT ON COLUMN group_media.display_height IS
  'Pixel height of the display copy, not the original. Null when unmeasured.';
