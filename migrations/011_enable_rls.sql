-- Deny the Data API everything, by enabling row-level security with no policies.
--
-- Supabase exposes every table in `public` over PostgREST to the `anon` role,
-- which authenticates with a key designed to be published in client apps.
-- Charlie has no client app and never hands that key out, but it exists, and a
-- family's messages, photographs and relationships are one leaked string away
-- from being readable and writable by anyone.
--
-- Enabling RLS without policies is a deny-all: with no policy granting access,
-- no row matches, so `anon` and `authenticated` can read nothing and write
-- nothing. There is deliberately no policy here, because there is no case in
-- which the Data API should reach this data at all.
--
-- Charlie is unaffected. It connects over Postgres as the table owner, and
-- owners bypass RLS. FORCE ROW LEVEL SECURITY would change that and is
-- deliberately not used -- it would lock Charlie out of its own database.
ALTER TABLE household              ENABLE ROW LEVEL SECURITY;
ALTER TABLE alexa_user             ENABLE ROW LEVEL SECURITY;
ALTER TABLE person                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_alias           ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_contact         ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship           ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_membership       ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_message          ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_extraction   ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_event            ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_event_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_batch            ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_media            ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_analysis         ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_person_evidence  ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations      ENABLE ROW LEVEL SECURITY;
