-- ALTER TABLE ... RENAME TO does not rename the table's primary key index, so
-- 003 left group_message with a constraint still called family_message_pkey.
--
-- A separate migration rather than an edit to 003, for the same append-only
-- reason 003 itself gives: 003 has already been applied.

ALTER INDEX family_message_pkey RENAME TO group_message_pkey;
