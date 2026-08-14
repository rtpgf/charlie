import type { ActivityMatcher } from './types.js';
import type { AcceptedEvent } from './validate.js';

/**
 * Deciding whether a newly extracted event is one Charlie already knows about.
 *
 * Split deliberately into a cheap deterministic narrowing (the *slot*) and a
 * decision within it. The slot is exact; the decision is judgement, and the
 * safe default is `distinct` — saying something twice is a far cheaper failure
 * than silently merging away a real appointment.
 */

export interface ExistingEvent {
  id: string;
  activity: string;
  startsAt: Date | null;
  timePrecision: 'exact' | 'approximate' | 'none';
  status: 'planned' | 'tentative' | 'cancelled';
}

export type IdentityDecision =
  /** Same event, already known. Keep the existing one; supersede the new one. */
  | { kind: 'duplicate'; existingId: string }
  /** Same event, but this message says something newer. Supersede the old one. */
  | { kind: 'updated'; existingId: string }
  /** This message cancels the existing event. */
  | { kind: 'cancelled'; existingId: string }
  /** Genuinely a different event. */
  | { kind: 'distinct' };

/** Two stated times this far apart are different events, not one restated. */
const SAME_TIME_TOLERANCE_MS = 60 * 60 * 1000;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Word overlap. Used only as the fallback when no matcher is configured: it
 * recognizes restatements that reuse vocabulary and misses genuine paraphrase
 * ("tagging along" vs "coming over" scores 0.33), which is precisely why the
 * real decision is delegated.
 */
function similarity(a: string, b: string): number {
  const left = new Set(normalize(a).split(' ').filter(Boolean));
  const right = new Set(normalize(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / new Set([...left, ...right]).size;
}

/** Above this, the fallback treats two phrasings as the same thing. */
const SAME_ACTIVITY_THRESHOLD = 0.5;

/** Identical wording never needs asking about. */
function trivallySame(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/**
 * Whether two activity phrasings describe the same occasion. Uses the matcher
 * when one is configured, and word overlap when not, so ingestion still works
 * with no AI credentials -- just less well.
 */
async function sameActivity(
  a: string,
  b: string,
  context: { subject: string | null; localDate: string },
  matcher: ActivityMatcher | undefined,
): Promise<boolean> {
  if (trivallySame(a, b)) return true;
  if (!matcher) return similarity(a, b) >= SAME_ACTIVITY_THRESHOLD;
  try {
    return await matcher.isSameActivity(a, b, context);
  } catch {
    // Never merge on the strength of a failed call.
    return false;
  }
}

/**
 * Decides how a candidate relates to one existing event in the same slot.
 *
 * Callers must only pass candidates that already share a slot (same group,
 * same resolved subject, same local day) — this function does not re-check
 * that, and would happily compare unrelated events.
 */
export async function decideIdentity(
  candidate: AcceptedEvent,
  existing: ExistingEvent,
  options: {
    localDate: string;
    matcher?: ActivityMatcher | undefined;
  },
): Promise<IdentityDecision> {
  const context = {
    subject: candidate.subject?.person?.preferredName ?? candidate.subject?.name ?? null,
    localDate: options.localDate,
  };

  // A cancellation refers to a plan rather than describing a new one, so it
  // matches on the slot and the activity, ignoring time entirely.
  if (candidate.status === 'cancelled' && existing.status !== 'cancelled') {
    return (await sameActivity(candidate.activity, existing.activity, context, options.matcher))
      ? { kind: 'cancelled', existingId: existing.id }
      : { kind: 'distinct' };
  }

  // Two stated times far apart are two plans regardless of wording, so this
  // deterministic check runs first and can skip the call entirely.
  const candidateTimed = candidate.timePrecision !== 'none' && candidate.startsAt !== null;
  const existingTimed = existing.timePrecision !== 'none' && existing.startsAt !== null;
  if (candidateTimed && existingTimed) {
    const apart = Math.abs(candidate.startsAt!.getTime() - existing.startsAt!.getTime());
    if (apart > SAME_TIME_TOLERANCE_MS) return { kind: 'distinct' };
  }

  if (!(await sameActivity(candidate.activity, existing.activity, context, options.matcher))) {
    return { kind: 'distinct' };
  }

  const candidateHasTime = candidate.timePrecision !== 'none' && candidate.startsAt !== null;
  const existingHasTime = existing.timePrecision !== 'none' && existing.startsAt !== null;

  if (candidateHasTime && existingHasTime) {
    // Same activity, same rough time: a restatement. Prefer the more precise
    // of the two rather than blindly keeping the newer.
    if (candidate.timePrecision === 'exact' && existing.timePrecision === 'approximate') {
      return { kind: 'updated', existingId: existing.id };
    }
    return { kind: 'duplicate', existingId: existing.id };
  }

  // One side never stated a time. The message that adds one is more useful,
  // so it supersedes; the one that adds nothing is a duplicate.
  if (candidateHasTime && !existingHasTime) return { kind: 'updated', existingId: existing.id };
  return { kind: 'duplicate', existingId: existing.id };
}

/**
 * Picks the single best match among a slot's existing events, preferring the
 * strongest relationship. Returns `distinct` when nothing matches.
 */
export async function matchWithinSlot(
  candidate: AcceptedEvent,
  existingEvents: ExistingEvent[],
  options: { localDate: string; matcher?: ActivityMatcher | undefined },
): Promise<IdentityDecision> {
  const ranked: IdentityDecision['kind'][] = ['cancelled', 'updated', 'duplicate'];
  let best: IdentityDecision = { kind: 'distinct' };

  for (const existing of existingEvents) {
    const decision = await decideIdentity(candidate, existing, options);
    if (decision.kind === 'distinct') continue;
    if (best.kind === 'distinct' || ranked.indexOf(decision.kind) < ranked.indexOf(best.kind)) {
      best = decision;
    }
  }

  return best;
}
