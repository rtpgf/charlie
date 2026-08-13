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
      const result = await seedWeekendCharlie(pool, { alexaUserId: config.dev.alexaUserId });
      logger.info('seed complete', {
        householdId: result.householdId,
        alexaUserMapped: result.alexaUserMapped,
      });
      if (!result.alexaUserMapped) {
        logger.warn('DEV_ALEXA_USER_ID is not set, so no Alexa account was mapped', {
          hint: 'See README "Alexa user mapping"',
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
