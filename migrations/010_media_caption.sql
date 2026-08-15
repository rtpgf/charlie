-- The words that arrived with this particular photograph.
--
-- The batch already has a caption, but it belongs to the share, not to any one
-- photo: WhatsApp puts a caption on the first image of a set and sends the rest
-- bare. Attributing "Here's Natalie at the beach!" to every photo in the share
-- means a photo of her brother is recorded as being her, at strong_context --
-- the second-strongest tier there is, and one Charlie will answer questions
-- from.
--
-- Nullable: most photos in a share genuinely arrive with nothing said about
-- them, and that absence is the point.
ALTER TABLE group_media
  ADD COLUMN IF NOT EXISTS caption text;

COMMENT ON COLUMN group_media.caption IS
  'Caption sent with this photo specifically. Never the batch caption -- see media_batch.caption for that.';
