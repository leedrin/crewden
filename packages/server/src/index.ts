import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { buildApp } from './app.js';
import { initDb } from './db.js';

bootstrapEnv();

const PORT = Number(process.env.PORT ?? 3000);

await initDb();
const app = await buildApp({ logger: true });

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server listening on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

function bootstrapEnv(): void {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(currentDir, '.env'),
    resolve(currentDir, '../.env'),
    resolve(currentDir, '../../.env'),
    resolve(currentDir, '../../../.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      loadEnvFile(file);
      return;
    } catch {
      // ignore invalid env files and continue probing
    }
  }
}
