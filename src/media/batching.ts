/**
 * Reassembling one human act of sharing from several provider messages.
 *
 * WhatsApp's Cloud API delivers each photo of a multi-photo share as its own
 * webhook message, with **no grouping identifier of any kind**, and usually
 * puts the caption on only the first. There is nothing from the provider to
 * group on, so this is a policy Charlie chooses -- deliberately isolated here,
 * named, and documented, rather than buried as an implicit rule.
 *
 * The policy: consecutive images from the same sender in the same group, each
 * within BATCH_WINDOW_MS of the previous one, are one share.
 *
 * Known limitations, accepted for the prototype:
 *   - Two genuinely separate shares sent moments apart merge into one.
 *   - A slow upload can push the last photo of a share past the window and
 *     leave it stranded as a share of its own.
 *   - Provider delivery order is assumed to match send order; Meta does not
 *     guarantee it.
 *
 * All three are wrong in the direction of grouping too much or too little
 * *presentation*, never of losing a photo or attaching it to the wrong person:
 * the sender and group are exact, only the grouping is heuristic.
 */

/** How close together two photos must arrive to count as one share. */
export const BATCH_WINDOW_MS = 90 * 1000;

export interface BatchCandidate {
  householdId: string;
  senderPersonId: string;
  sharedAt: Date;
}

export interface OpenBatch {
  id: string;
  householdId: string;
  senderPersonId: string;
  /** When the most recent photo in this batch arrived. */
  lastSharedAt: Date;
}

/**
 * Whether an arriving photo belongs to an existing open batch.
 *
 * Pure, so the policy can be reasoned about and tested without a database.
 */
export function belongsToBatch(candidate: BatchCandidate, batch: OpenBatch): boolean {
  if (batch.householdId !== candidate.householdId) return false;
  if (batch.senderPersonId !== candidate.senderPersonId) return false;

  const gap = candidate.sharedAt.getTime() - batch.lastSharedAt.getTime();
  // Negative gaps happen when the provider delivers slightly out of order;
  // treat a small overlap as the same share rather than a new one.
  return gap >= -BATCH_WINDOW_MS && gap <= BATCH_WINDOW_MS;
}
