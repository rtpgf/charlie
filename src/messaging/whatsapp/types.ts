/**
 * The parts of Meta's webhook payload we read. Everything is optional because
 * the payload is attacker-reachable before parsing and Meta adds fields over
 * time -- the parser treats anything unexpected as "not a message".
 *
 * Shape per developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */

export interface WhatsAppWebhookBody {
  object?: unknown;
  entry?: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id?: unknown;
  changes?: WhatsAppChange[];
}

export interface WhatsAppChange {
  field?: unknown;
  value?: WhatsAppChangeValue;
}

export interface WhatsAppChangeValue {
  messaging_product?: unknown;
  metadata?: { display_phone_number?: unknown; phone_number_id?: unknown };
  contacts?: unknown;
  messages?: WhatsAppMessage[];
  /** Delivery/read receipts. Not messages; ignored. */
  statuses?: unknown;
}

export interface WhatsAppMessage {
  id?: unknown;
  from?: unknown;
  /** Unix seconds, as a string. */
  timestamp?: unknown;
  type?: unknown;
  text?: { body?: unknown };
  image?: WhatsAppMedia;
  video?: WhatsAppMedia;
  audio?: WhatsAppMedia;
  document?: WhatsAppMedia;
  sticker?: WhatsAppMedia;
}

export interface WhatsAppMedia {
  id?: unknown;
  mime_type?: unknown;
  caption?: unknown;
}
