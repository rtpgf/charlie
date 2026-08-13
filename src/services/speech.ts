/**
 * The words Charlie says, kept out of the Alexa handler so that protocol
 * concerns and phrasing stay separable. Answers about family members are built
 * from the family model instead -- see src/family/describe.ts.
 */

export function launchGreeting(): string {
  return "Hi. I'm Charlie. Weekend Charlie is alive.";
}

export function unsupportedRequest(): string {
  return "Sorry, I can't do that yet.";
}

/** Alexa account with no household mapping. Never mentions ids or errors. */
export function unrecognizedAccount(): string {
  return "I don't recognize this Alexa account yet.";
}

export function helpMessage(): string {
  return 'You can ask me about someone in the family. Try asking, who is Natalie?';
}

export function goodbye(): string {
  return 'Goodbye.';
}

/** The family question arrived without a name attached. */
export function missingPersonName(): string {
  return "Sorry, I didn't catch who you were asking about.";
}

/**
 * Something failed on our side -- usually the database being unreachable.
 * Says so in Charlie's voice rather than letting Alexa fall back to
 * "there was a problem with the requested skill's response", and without
 * hinting at what broke.
 */
export function havingTrouble(): string {
  return "I'm having trouble remembering right now. Please try again in a moment.";
}
