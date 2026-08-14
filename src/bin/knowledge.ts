/**
 * Retry knowledge extraction for one already-stored message:
 *
 *   npm run knowledge:reprocess -- <group_message_id>
 *
 * Deliberately a plain command, not a queue or worker. A message whose
 * extraction already succeeded is left alone; one that failed is retried.
 */
import { config } from '../config.js';
import { closePool, getPool } from '../db/index.js';
import { createAnthropicExtractor } from '../knowledge/providers/anthropic.js';
import { learnFromMessage } from '../knowledge/service.js';
import { logger } from '../logger.js';

const messageId = process.argv[2];

async function main(): Promise<void> {
  if (!messageId) {
    console.error('usage: npm run knowledge:reprocess -- <group_message_id>');
    process.exitCode = 1;
    return;
  }

  if (!config.ai.apiKey) {
    logger.error('no AI credentials configured', { hint: 'set ANTHROPIC_API_KEY' });
    process.exitCode = 1;
    return;
  }

  const extractor = createAnthropicExtractor({
    apiKey: config.ai.apiKey,
    model: config.ai.model,
    effort: config.ai.effort,
  });

  const result = await learnFromMessage(getPool(), messageId, extractor);
  logger.info('reprocess complete', { messageId, ...result });
  if (result.outcome === 'failed' || result.outcome === 'rejected') process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    logger.error('reprocess failed', {
      messageId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    process.exitCode = 1;
  })
  .finally(closePool);
