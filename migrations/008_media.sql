-- Milestone 5: group photos.
--
-- Three things this schema is careful about:
--
-- 1. A share is not a message. WhatsApp delivers each photo of a multi-photo
--    share as its own webhook message with no grouping identifier, and usually
--    puts the caption on only the first. media_batch reassembles the human's
--    single act of sharing from several provider messages.
--
-- 2. shared_at is not captured_at. When the family sent a photo is a fact;
--    when it was taken is evidence of varying quality. They are never
--    interchanged, and an absent capture time stays absent.
--
-- 3. Identity is evidence, not a fact. A caption saying "here's Natalie" and a
--    model thinking a face looks like Natalie are both associations, but they
--    are not equally strong, and a human correction must be able to outrank
--    anything a model concluded.

-- One human act of sharing: "Jenna sent these six photos with this caption."
CREATE TABLE media_batch (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  sender_person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,

  -- The human's words for the whole share, from whichever message carried them.
  caption          text,
  -- When the family shared it. Always known.
  shared_at        timestamptz NOT NULL,

  -- What the vision model made of the set as a whole, once validated.
  summary          text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_batch_recent ON media_batch (household_id, shared_at DESC);

CREATE TABLE group_media (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  -- The provider message this item arrived on. Provenance back to the human.
  group_message_id    uuid NOT NULL REFERENCES group_message(id) ON DELETE CASCADE,
  media_batch_id      uuid REFERENCES media_batch(id) ON DELETE SET NULL,

  -- Position within the share, so the gallery shows them in the order sent.
  sequence            integer NOT NULL,

  provider_media_id   text NOT NULL,
  mime_type           text,
  byte_size           integer,
  width               integer,
  height              integer,

  -- Key into Charlie's private bucket. Opaque ids only -- never a name, phone
  -- number, or caption, so storage leaks nothing on its own and deletion stays
  -- a matter of following ids.
  storage_key         text,

  -- Where this item is in the retrieval pipeline. Failures are recorded rather
  -- than retried forever, and are reprocessable.
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'stored', 'download_failed',
                                          'storage_failed', 'rejected')),
  status_detail       text,

  -- When the family shared it. Always known, always trusted.
  shared_at           timestamptz NOT NULL,

  -- When the photo appears to have been taken. Absent unless there is real
  -- evidence -- never inferred from how a scene or a person looks.
  captured_at         timestamptz,
  captured_at_source  text CHECK (captured_at_source IN ('exif', 'human_statement', 'provider')),
  captured_at_confidence text CHECK (captured_at_confidence IN ('exact', 'approximate', 'uncertain')),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: a redelivered webhook must not create a second media row or a
-- second stored object.
CREATE UNIQUE INDEX group_media_provider ON group_media (household_id, provider_media_id);
CREATE INDEX group_media_batch ON group_media (media_batch_id, sequence);
CREATE INDEX group_media_recent ON group_media (household_id, shared_at DESC);

-- Per-image visual understanding, kept separate from the media row so a failed
-- or re-run analysis never risks the photo itself.
CREATE TABLE media_analysis (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_media_id uuid NOT NULL REFERENCES group_media(id) ON DELETE CASCADE,
  provider       text NOT NULL,
  model          text NOT NULL,
  schema_version text NOT NULL,
  status         text NOT NULL CHECK (status IN ('accepted', 'rejected', 'failed')),
  error          text,

  description    text,
  people_visible integer,
  proposal       jsonb,

  created_at     timestamptz NOT NULL DEFAULT now()
);

-- At most one accepted analysis per image; failures may accumulate, which is
-- what makes retry safe.
CREATE UNIQUE INDEX media_analysis_accepted
  ON media_analysis (group_media_id) WHERE status = 'accepted';

-- Who is in a photo, and *why Charlie thinks so*. Never collapsed to a bare
-- person_id: the strength and origin of the claim is the point.
CREATE TABLE media_person_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_media_id    uuid NOT NULL REFERENCES group_media(id) ON DELETE CASCADE,
  person_id         uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,

  -- Ordered strongest to weakest; the hierarchy is enforced in code.
  evidence_type     text NOT NULL CHECK (evidence_type IN (
                      'human_correction',    -- "that's Hannah, not Natalie"
                      'explicit_assertion',  -- "that's Natalie on the left"
                      'strong_context',      -- one named person, one prominent subject
                      'visual_match',        -- model matched against known reference media
                      'weak_context')),      -- named in a caption covering many people

  confidence        text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),

  -- accepted evidence may be used to answer questions; proposed may not.
  status            text NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('accepted', 'proposed', 'rejected')),

  -- Provenance back to the human words that produced it, where there were any.
  source_message_id uuid REFERENCES group_message(id) ON DELETE SET NULL,
  -- Set when later evidence overrode this, so corrections leave a trail.
  superseded_by     uuid REFERENCES media_person_evidence(id) ON DELETE SET NULL,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_person_evidence_media ON media_person_evidence (group_media_id);
-- The query behind "show me pictures of Natalie": accepted evidence only.
CREATE INDEX media_person_evidence_person
  ON media_person_evidence (person_id, status) WHERE superseded_by IS NULL;

-- One association per person per photo per evidence type, so re-running
-- analysis cannot pile up duplicates.
CREATE UNIQUE INDEX media_person_evidence_unique
  ON media_person_evidence (group_media_id, person_id, evidence_type);
