-- Milestone 4: group governance, AI knowledge extraction, and events.
--
-- Three concerns kept deliberately separate:
--   membership + role  -> who is in the group, and who may administer it
--   ingestion_status   -> whose messages Charlie may learn from
--   Alexa/query access -> who may ask Charlie things (NOT modelled yet)
-- Being an admin does not imply Alexa access, and being a member does not imply
-- ingestion permission. Collapsing them later is easy; separating them later is not.

-- Relative dates ("tomorrow", "around three") are meaningless without a local
-- timezone. Resolved deterministically in code, never by the model.
ALTER TABLE household ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';

CREATE TABLE group_membership (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  person_id        uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,

  -- Authorization, not kinship. Never inferred from relationships.
  role             text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),

  -- Whether Charlie may ingest this member's messages as knowledge.
  -- Defaults to 'pending': being known is not consent.
  ingestion_status text NOT NULL DEFAULT 'pending'
                     CHECK (ingestion_status IN ('allowed', 'blocked', 'pending')),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX group_membership_person ON group_membership (household_id, person_id);

-- Audit trail for how Charlie learned something. Holds the structured proposal
-- only -- never model reasoning, never the provider's raw request/response.
CREATE TABLE knowledge_extraction (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_message_id uuid NOT NULL REFERENCES group_message(id) ON DELETE CASCADE,
  provider         text NOT NULL,
  model            text NOT NULL,
  schema_version   text NOT NULL,
  status           text NOT NULL CHECK (status IN ('accepted', 'rejected', 'failed')),
  error            text,
  proposal         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- At most one accepted extraction per message. Failed attempts may accumulate,
-- which is what makes retry safe: reprocessing a message that already succeeded
-- is a no-op, reprocessing one that failed is allowed.
CREATE UNIQUE INDEX knowledge_extraction_accepted
  ON knowledge_extraction (group_message_id) WHERE status = 'accepted';

CREATE INDEX knowledge_extraction_message ON knowledge_extraction (group_message_id);

CREATE TABLE group_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,

  title           text NOT NULL,
  description     text,
  starts_at       timestamptz,

  -- How precisely the source actually pinned the event down. "Around three
  -- tomorrow" is a known day at an approximate time -- not an exact instant.
  date_precision  text NOT NULL CHECK (date_precision IN ('exact', 'day', 'unknown')),
  time_precision  text NOT NULL CHECK (time_precision IN ('exact', 'approximate', 'none')),

  -- Conversational certainty is preserved: "might stop by" must not become a
  -- planned visit. Cancellation is representable; reconciling a cancellation
  -- against an existing event is a later milestone.
  status          text NOT NULL CHECK (status IN ('planned', 'tentative', 'cancelled')),
  confidence      text NOT NULL CHECK (confidence IN ('explicit', 'inferred', 'uncertain')),

  -- Provenance back to the human's original words.
  source_type     text NOT NULL CHECK (source_type IN ('group_message')),
  source_id       uuid NOT NULL REFERENCES group_message(id) ON DELETE CASCADE,
  -- Position within that message's proposal; with source_id it makes event
  -- creation idempotent under reprocessing.
  source_sequence integer NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX group_event_source ON group_event (source_id, source_sequence);
CREATE INDEX group_event_agenda ON group_event (household_id, starts_at);

-- A normalized join rather than an array of ids on the event. Participants the
-- model named but Charlie could not resolve are kept as text: no person row is
-- ever invented from a message.
CREATE TABLE group_event_participant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES group_event(id) ON DELETE CASCADE,
  person_id       uuid REFERENCES person(id) ON DELETE CASCADE,
  unresolved_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (person_id IS NOT NULL OR unresolved_name IS NOT NULL)
);

CREATE INDEX group_event_participant_event ON group_event_participant (event_id);
