-- Milestone 2: minimal family knowledge model.
--
-- Only relationships that are asserted get stored. Derived kinship (aunt,
-- niece, nephew) is computed at query time, never persisted -- see
-- src/family/graph.ts. Storing derivations would make later corrections in
-- Family Canon ambiguous about what was actually claimed.

CREATE TABLE household (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Maps the Alexa userId on an inbound request to a household. Seeded manually
-- for Weekend Charlie; account linking is deliberately out of scope.
CREATE TABLE alexa_user (
  alexa_user_id  text PRIMARY KEY,
  household_id   uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE person (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  full_name       text,
  preferred_name  text NOT NULL,
  -- Optional, and only ever set from an explicit statement. Never inferred
  -- from a name. NULL means we fall back to neutral kinship terms.
  gender          text CHECK (gender IN ('female', 'male')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX person_household ON person (household_id);

CREATE TABLE person_alias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  alias       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX person_alias_unique ON person_alias (person_id, lower(alias));

CREATE TABLE relationship (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  subject_person_id  uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  relationship_type  text NOT NULL CHECK (relationship_type IN ('parent_of', 'sibling_of')),
  object_person_id   uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,

  -- Provenance. CHARLIE.md treats the origin of a fact as fundamental, so even
  -- seeded rows carry it rather than being backfilled later.
  source_type        text NOT NULL CHECK (source_type IN ('seed', 'stated', 'inferred')),
  source_id          text,
  confidence         text NOT NULL CHECK (confidence IN ('confirmed', 'stated', 'inferred', 'uncertain', 'disputed')),

  created_at         timestamptz NOT NULL DEFAULT now(),

  CHECK (subject_person_id <> object_person_id)
);

CREATE INDEX relationship_household ON relationship (household_id);
