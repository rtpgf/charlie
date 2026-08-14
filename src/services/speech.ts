/**
 * The words Charlie says, kept out of the Alexa handler so that protocol
 * concerns and phrasing stay separable. Answers about people in the group are
 * built from the group model instead -- see src/group/describe.ts.
 *
 * Note: what Charlie *says* still uses natural words like "family". The model
 * underneath is a group; a family is the first kind of group Charlie serves.
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
  return (
    'You can ask me about someone in the family, or about what is happening on a day. ' +
    'Try asking, who is Natalie? Or, what is happening tomorrow?'
  );
}

/** The agenda question arrived without a day Alexa could resolve. */
export function missingAgendaDate(): string {
  return "Sorry, I didn't catch which day you meant.";
}

export function goodbye(): string {
  return 'Goodbye.';
}

/** The who-is question arrived without a name attached. */
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
