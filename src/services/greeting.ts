/**
 * Charlie's speech content lives in services, not in the Alexa handler, so that
 * later intents compose the same way: handler parses the request, service
 * authors the words.
 */

export function launchGreeting(): string {
  return "Hi. I'm Charlie. Weekend Charlie is alive.";
}

export function unsupportedRequest(): string {
  return "Sorry, I can't do that yet.";
}
