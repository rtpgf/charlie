-- Speech grammar belongs to Charlie, not to the model.
--
-- 005 stored a single `title` string that the model composed ("Jenna coming
-- over"), which the agenda then decorated with a time and a day. That reads
-- like a headline rather than a sentence, and the grammar was whatever the
-- model happened to produce.
--
-- Splitting subject from activity lets deterministic code build the clause:
--   subject present -> "<subject> is <activity>"   ("Jenna is coming over")
--   subject absent  -> "you have <activity>"       ("you have a dentist appointment")
-- and conjugate for certainty ("might be", "might have") without a model.

ALTER TABLE group_event RENAME COLUMN title TO activity;

-- Who or what the event is about, as the message named them. NULL when the
-- message named no subject ("dentist appointment at four").
ALTER TABLE group_event ADD COLUMN subject text;
