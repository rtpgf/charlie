/**
 * Charlie's knowledge-extraction capability, expressed as what the application
 * needs rather than as a vendor's API.
 *
 * Application code knows it needs *knowledge extraction*. It does not know
 * which model provides it, and nothing outside src/knowledge/providers/ imports
 * a vendor SDK.
 */

/** Bumped when the contract below changes; persisted with every extraction. */
export const EXTRACTION_SCHEMA_VERSION = '3';

export interface KnownPerson {
  /** How Charlie will refer to them. */
  preferredName: string;
  /** Other names they answer to, for entity resolution only. */
  aliases: string[];
}

export interface ExtractionContext {
  /** The message text, exactly as the human wrote it. Treated as data. */
  text: string;
  sender: { preferredName: string };
  group: {
    /** IANA zone, e.g. America/Chicago. Relative dates resolve against this. */
    timezone: string;
    /** Minimum context for entity resolution -- not the whole group. */
    knownPeople: KnownPerson[];
  };
  /** When the provider says the message was received. */
  receivedAt: Date;
}

export type EventStatus = 'planned' | 'tentative' | 'cancelled';
export type EventConfidence = 'explicit' | 'inferred' | 'uncertain';
export type DatePrecision = 'exact' | 'day' | 'unknown';
export type TimePrecision = 'exact' | 'approximate' | 'none';

/**
 * A proposed event. Note what is absent: no database ids, and no absolute
 * timestamp. The model reports the *local* date and time it understood; Charlie
 * converts to an instant using the group's timezone.
 */
export interface ProposedEvent {
  /**
   * Who or what the event is about, as the message named them, or null when
   * the message named no subject. Charlie resolves it to a person; the model
   * only supplies the name.
   */
  subject?: string | null;
  /**
   * What is happening, phrased to complete "<subject> is ___" when a subject
   * is present, or "you have ___" when it is not. The model supplies the
   * words; Charlie conjugates around them.
   *
   * Third person, always: Charlie speaks to someone other than the sender, so
   * "coming over with me" is wrong and "coming over with Jenna" is right.
   */
  activity: string;
  description?: string | null;
  /** YYYY-MM-DD in the group's timezone, or null if no date was stated. */
  localDate?: string | null;
  /** HH:MM 24-hour in the group's timezone, or null if no time was stated. */
  localTime?: string | null;
  datePrecision: DatePrecision;
  timePrecision: TimePrecision;
  status: EventStatus;
  confidence: EventConfidence;
  /** Human-readable names only. Charlie resolves them to people, or doesn't. */
  participants: string[];
}

/**
 * Candidate facts and relationships are recognized but deliberately not
 * persisted in this milestone -- see README "Future considerations".
 */
export interface KnowledgeProposal {
  schemaVersion: string;
  peopleMentioned: string[];
  events: ProposedEvent[];
  facts: string[];
  relationships: string[];
  uncertainties: string[];
}

export interface KnowledgeExtractor {
  readonly provider: string;
  readonly model: string;
  extractFromMessage(context: ExtractionContext): Promise<KnowledgeProposal>;
}
