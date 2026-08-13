/**
 * Shapes of real Alexa request envelopes, trimmed to the fields our handler reads.
 * Verification is disabled in tests (see vitest.config.ts), so these are unsigned.
 */

const application = { applicationId: 'amzn1.ask.skill.test-skill-id' };
const user = { userId: 'amzn1.ask.account.test-user' };

function base(requestId: string) {
  return {
    version: '1.0',
    session: { new: true, sessionId: 'amzn1.echo-api.session.test', application, user },
    context: { System: { application, user, device: { deviceId: 'test-device' } } },
    request: { requestId, timestamp: '2026-01-01T00:00:00Z', locale: 'en-US' },
  };
}

export function launchRequest() {
  const envelope = base('amzn1.echo-api.request.launch');
  return { ...envelope, request: { ...envelope.request, type: 'LaunchRequest' } };
}

export function intentRequest(intentName: string) {
  const envelope = base('amzn1.echo-api.request.intent');
  return {
    ...envelope,
    request: { ...envelope.request, type: 'IntentRequest', intent: { name: intentName } },
  };
}

export function sessionEndedRequest() {
  const envelope = base('amzn1.echo-api.request.ended');
  return {
    ...envelope,
    request: { ...envelope.request, type: 'SessionEndedRequest', reason: 'USER_INITIATED' },
  };
}
