-- Event identity: two messages describing the same gathering should not
-- produce two events.
--
-- Not a unique key. No field combination gets this right -- keying on
-- (subject, day) merges two genuine visits on the same day, keying on the
-- stated time cannot match an event whose time was never stated, and keying on
-- the activity text fails because "coming over with Jenna" and "coming along
-- with Jenna" are the same event in different words. The variance is semantic,
-- not structural.
--
-- Instead: a cheap deterministic *slot* narrows candidates, a decision is made
-- within the slot, and the loser is superseded rather than deleted. Both rows
-- keep pointing at the message they came from, so "why does Charlie think
-- this?" stays answerable -- the provenance rule in CHARLIE.md.

-- The resolved subject, when Charlie recognized them. `subject` keeps the
-- spoken name; this is what slot matching keys on, so an unresolved subject
-- can never be matched against a known person by name alone.
ALTER TABLE group_event ADD COLUMN subject_person_id uuid REFERENCES person(id) ON DELETE SET NULL;

-- The local calendar day the event falls on, in the group's timezone.
-- Denormalized from starts_at because the slot is a *day*, and deriving it per
-- query would mean doing timezone maths in SQL.
ALTER TABLE group_event ADD COLUMN local_date text;

-- Points at the event that replaced this one. NULL means live.
ALTER TABLE group_event ADD COLUMN superseded_by uuid REFERENCES group_event(id) ON DELETE SET NULL;

-- Why it was superseded, for debugging and for explaining Charlie's reasoning.
ALTER TABLE group_event ADD COLUMN superseded_reason text
  CHECK (superseded_reason IN ('duplicate', 'updated', 'cancelled'));

-- The agenda reads live events only; this is the query it makes.
CREATE INDEX group_event_live
  ON group_event (household_id, starts_at)
  WHERE superseded_by IS NULL;

-- The candidate slot. Deliberately not unique: a slot may legitimately hold
-- several distinct events (two separate visits on the same day).
CREATE INDEX group_event_slot ON group_event (household_id, subject_person_id, local_date);
