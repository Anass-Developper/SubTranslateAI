import 'dotenv/config';

import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();
const app = await buildServer({ config });
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Arrêt propre du serveur');
  await app.close();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Serveur disponible sur http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
