/**
 * Charlie's visual-understanding capability, expressed as what the product
 * needs rather than as a vendor's API — the same rule as knowledge extraction.
 */

export const MEDIA_SCHEMA_VERSION = '1';

export interface MediaInput {
  /** Stable id, so per-image results can be matched back deterministically. */
  mediaId: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface KnownPersonContext {
  preferredName: string;
  aliases: string[];
}

export interface MediaAnalysisContext {
  media: MediaInput[];
  /** The human's caption for the whole share, if they wrote one. */
  batchCaption?: string | undefined;
  sender: { preferredName: string };
  knownPeople: KnownPersonContext[];
}

export interface ProposedMediaAnalysis {
  /** Which image this is about; must match a supplied mediaId. */
  mediaId: string;
  /** One plain sentence. Not a paragraph, and not speculation. */
  description: string;
  /** How many people are visible. Used to judge caption evidence strength. */
  peopleVisible: number;
  /** Names from the known-people list the model believes appear here. */
  namedPeople: string[];
}

export interface MediaAnalysisProposal {
  schemaVersion: string;
  /** What the share as a whole appears to be, in a few words. */
  batchSummary: string;
  images: ProposedMediaAnalysis[];
}

export interface MediaAnalyzer {
  readonly provider: string;
  readonly model: string;
  analyze(context: MediaAnalysisContext): Promise<MediaAnalysisProposal>;
}
