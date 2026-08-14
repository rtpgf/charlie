-- Rename family_message -> group_message.
--
-- "Family" was too narrow for the container. The relationships Charlie stores
-- are kinship, but the group holding them need not be a family -- a care team
-- or a circle of friends is the same shape. A family is the first kind of group
-- Charlie serves, not the only one it could serve.
--
-- Applied as a new migration rather than by editing 002, because 002 has
-- already run against the development database and applied migrations are
-- treated as append-only. For the same reason 001_family.sql keeps its
-- filename: it is a historical record, and renaming it would make the runner
-- treat it as a new, unapplied migration.

ALTER TABLE family_message RENAME TO group_message;

ALTER INDEX family_message_provider_delivery RENAME TO group_message_provider_delivery;
ALTER INDEX family_message_household RENAME TO group_message_household;
