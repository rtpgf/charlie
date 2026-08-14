/**
 * The transport-neutral group message model.
 *
 * Everything downstream of an adapter works on these types. Nothing here knows
 * that Meta exists: adding SMS later means writing another adapter that
 * produces an InboundGroupMessage, with no change to the messaging service or
 * the database.
 */

export type MessageChannel = 'whatsapp' | 'sms';

export interface InboundMedia {
  /** Provider-side handle, enough for a later milestone to fetch the bytes. */
  externalMediaId: string;
  mediaType?: string | undefined;
  caption?: string | undefined;
}

export interface InboundGroupMessage {
  channel: MessageChannel;
  /** Provider's message id. Used for idempotency. */
  externalMessageId: string;
  /** Normalized sender identity, e.g. a WhatsApp wa_id. */
  senderExternalId: string;
  recipientExternalId?: string | undefined;
  /** Present for text messages. Absent for media-only messages. */
  text?: string | undefined;
  media: InboundMedia[];
  receivedAt: Date;
}

/**
 * Outbound side, kept to the one operation this milestone needs. Injected into
 * the messaging service so tests never make network calls.
 */
export interface Messenger {
  sendText(toExternalId: string, text: string): Promise<void>;
}

/**
 * Why an outbound send failed. Distinguishing an expired credential from a
 * network blip matters: an expired token produces a deceptive partial failure
 * where inbound ingestion keeps working and only replies stop.
 */
export type OutboundFailureCategory =
  | 'authentication'
  | 'rate_limit'
  | 'provider_error'
  | 'network'
  | 'unknown';

export class OutboundMessageError extends Error {
  readonly category: OutboundFailureCategory;
  readonly httpStatus?: number | undefined;
  readonly providerCode?: string | number | undefined;

  constructor(
    message: string,
    details: {
      category: OutboundFailureCategory;
      httpStatus?: number | undefined;
      providerCode?: string | number | undefined;
    },
  ) {
    super(message);
    this.name = 'OutboundMessageError';
    this.category = details.category;
    this.httpStatus = details.httpStatus;
    this.providerCode = details.providerCode;
  }
}

/** Digits only -- WhatsApp wa_ids carry no '+' or separators. */
export function normalizePhoneIdentity(value: string): string {
  return value.replace(/\D/g, '');
}

/** For logs: keep enough to correlate, not enough to identify. */
export function maskIdentity(value: string): string {
  const digits = normalizePhoneIdentity(value);
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
}
