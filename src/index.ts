import { config } from './config.js';
import { logger } from './logger.js';
import { createServer } from './server.js';

const app = createServer();

app.listen(config.port, config.host, () => {
  logger.info('weekend charlie listening', {
    host: config.host,
    port: config.port,
    nodeEnv: config.nodeEnv,
    verifyAlexaRequests: config.alexa.verifyRequests,
    skillIdConfigured: Boolean(config.alexa.skillId),
  });
});
