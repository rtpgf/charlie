/**
 * Database commands: `npm run db:migrate` and `npm run db:seed`.
 */
import { config } from '../config.js';
import { closePool, getPool } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { seedWeekendCharlie } from '../db/seed.js';
import { logger } from '../logger.js';

const command = process.argv[2];

async function main(): Promise<void> {
  const pool = getPool();

  switch (command) {
    case 'migrate': {
      const applied = await migrate(pool);
      logger.info(applied.length ? 'migrations complete' : 'already up to date', {
        applied: applied.length,
      });
      break;
    }

    case 'seed': {
      const result = await seedWeekendCharlie(pool, {
        alexaUserId: config.dev.alexaUserId,
        whatsappSenderId: config.dev.whatsappSenderId,
      });
      if (result.ingestedRowsRemoved > 0) {
        logger.warn('seed removed previously ingested data', {
          messagesRemoved: result.ingestedRowsRemoved,
          note: 'db:seed rebuilds the group, which cascades to messages and events',
        });
      }
      logger.info('seed complete', {
        householdId: result.householdId,
        alexaUserMapped: result.alexaUserMapped,
        whatsappSenderMapped: result.whatsappSenderMapped,
      });
      if (!result.alexaUserMapped) {
        logger.warn('DEV_ALEXA_USER_ID is not set, so no Alexa account was mapped', {
          hint: 'See README "Alexa user mapping"',
        });
      }
      if (!result.whatsappSenderMapped) {
        logger.warn('DEV_WHATSAPP_SENDER_ID is not set, so no WhatsApp sender was mapped', {
          hint: 'See README "Seeded sender mapping"',
        });
      }
      break;
    }

    default:
      console.error('usage: tsx src/bin/db.ts <migrate|seed>');
      process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    logger.error('database command failed', {
      command,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    process.exitCode = 1;
  })
  .finally(closePool);
