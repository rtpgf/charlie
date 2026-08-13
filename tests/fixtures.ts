/**
 * Shapes of real Alexa request envelopes, trimmed to the fields our handler reads.
 * Verification is disabled in tests (see vitest.config.ts), so these are unsigned.
 */

export const TEST_ALEXA_USER_ID = 'amzn1.ask.account.test-user';

const application = { applicationId: 'amzn1.ask.skill.test-skill-id' };

function base(requestId: string, userId: string) {
  const user = { userId };
  return {
    version: '1.0',
    session: { new: true, sessionId: 'amzn1.echo-api.session.test', application, user },
    context: { System: { application, user, device: { deviceId: 'test-device' } } },
    request: { requestId, timestamp: '2026-01-01T00:00:00Z', locale: 'en-US' },
  };
}

export function launchRequest() {
  const envelope = base('amzn1.echo-api.request.launch', TEST_ALEXA_USER_ID);
  return { ...envelope, request: { ...envelope.request, type: 'LaunchRequest' } };
}

export function intentRequest(
  intentName: string,
  options: { slots?: Record<string, string>; userId?: string } = {},
) {
  const envelope = base('amzn1.echo-api.request.intent', options.userId ?? TEST_ALEXA_USER_ID);
  const slots = Object.fromEntries(
    Object.entries(options.slots ?? {}).map(([name, value]) => [name, { name, value }]),
  );
  return {
    ...envelope,
    request: {
      ...envelope.request,
      type: 'IntentRequest',
      intent: { name: intentName, slots },
    },
  };
}

/** "Alexa, ask Charlie who <name> is." */
export function whoIsRequest(personName: string, options: { userId?: string } = {}) {
  return intentRequest('WhoIsPersonIntent', { slots: { personName }, ...options });
}

export function sessionEndedRequest() {
  const envelope = base('amzn1.echo-api.request.ended', TEST_ALEXA_USER_ID);
  return {
    ...envelope,
    request: { ...envelope.request, type: 'SessionEndedRequest', reason: 'USER_INITIATED' },
  };
}
