-- Milestone 3: family messaging transport.
--
-- Channel-neutral by design. WhatsApp is the first transport, SMS is expected
-- next, and neither appears in the family model itself -- a person's messaging
-- identities live in person_contact rather than as columns on person.

CREATE TABLE person_contact (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  -- Normalized for the channel. For WhatsApp this is the wa_id: digits only,
  -- no leading '+'.
  external_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One identity per channel maps to at most one person. The channel is part of
-- the key on purpose: the same digits on WhatsApp and SMS are two separate
-- provider identities, and nothing here assumes they are the same human.
CREATE UNIQUE INDEX person_contact_identity ON person_contact (channel, external_id);
CREATE INDEX person_contact_person ON person_contact (person_id);

CREATE TABLE family_message (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  sender_person_id      uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,

  channel               text NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  external_message_id   text NOT NULL,
  sender_external_id    text NOT NULL,
  recipient_external_id text,

  -- The message exactly as the human sent it. Never a summary, never rewritten.
  body                  text NOT NULL,

  -- When the provider says it was received, versus when Charlie stored it.
  provider_received_at  timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Idempotency. Meta retries webhook deliveries, and a retry must not produce a
-- second family message. Inserts use ON CONFLICT DO NOTHING against this index,
-- which also makes "was this new?" answerable without a prior read.
CREATE UNIQUE INDEX family_message_provider_delivery
  ON family_message (channel, external_message_id);

CREATE INDEX family_message_household ON family_message (household_id, created_at DESC);
