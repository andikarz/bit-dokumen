import fs from 'node:fs';
import { env } from '../src/config/env.js';

async function run() {
  console.log('Dokumen database seed — ensuring storage root exists...');
  const storageRoot = env.STORAGE_ROOT;
  if (!fs.existsSync(storageRoot)) {
    fs.mkdirSync(storageRoot, { recursive: true });
    console.log(`Created storage directory: ${storageRoot}`);
  }
  console.log('Dokumen seed finished.');
}

run().catch((err) => {
  console.error('Dokumen seed failed:', err);
  process.exit(1);
});
