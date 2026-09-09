import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
try { (process as any).loadEnvFile?.(); } catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

async function run() {
  const isStatusMode = process.argv.includes('--status');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const ADVISORY_LOCK_ID = 884729104;

  try {
    // 1. Acquire advisory lock
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);

    // 2. Ensure schema_migrations exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Read migration files
    const migrationsDir = path.join(__dirname, '../db/migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found.');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const appliedRes = await client.query(
      'SELECT version, filename, checksum, status, applied_at FROM schema_migrations ORDER BY version ASC'
    );

    const appliedMap = new Map<string, { filename: string; checksum: string; status: string; applied_at: Date }>();
    for (const row of appliedRes.rows) {
      appliedMap.set(row.version, {
        filename: row.filename,
        checksum: row.checksum,
        status: row.status,
        applied_at: row.applied_at
      });
    }

    if (isStatusMode) {
      console.log('=== Migration Status (Dokumen) ===');
      for (const file of files) {
        const version = file.split('_')[0];
        const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const checksum = computeChecksum(content);
        const applied = appliedMap.get(version);

        if (applied) {
          const checksumMatch = applied.checksum === checksum ? 'MATCH' : 'MISMATCH!';
          console.log(`[${applied.status}] ${file} (checksum: ${checksumMatch}, applied: ${applied.applied_at})`);
        } else {
          console.log(`[PENDING] ${file}`);
        }
      }
      return;
    }

    // 4. Apply migrations in transactions
    for (const file of files) {
      const version = file.split('_')[0];
      const filePath = path.join(migrationsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const checksum = computeChecksum(content);
      const applied = appliedMap.get(version);

      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(`Checksum mismatch for applied migration ${file}! Expected ${applied.checksum}, got ${checksum}`);
        }
        if (applied.status === 'failed') {
          throw new Error(`Migration ${file} previously failed! Manual intervention required.`);
        }
        console.log(`Skipping already applied migration: ${file}`);
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(
          'INSERT INTO schema_migrations (version, filename, checksum, status) VALUES ($1, $2, $3, $4)',
          [version, file, checksum, 'started']
        );

        await client.query(content);

        await client.query(
          'UPDATE schema_migrations SET status = $1, applied_at = NOW() WHERE version = $2',
          ['applied', version]
        );
        await client.query('COMMIT');
        console.log(`Successfully applied: ${file}`);
      } catch (migrationErr) {
        await client.query('ROLLBACK');
        console.error(`Failed to apply migration ${file}:`, migrationErr);

        // Mark failed outside the rolled back transaction
        try {
          await client.query(
            'INSERT INTO schema_migrations (version, filename, checksum, status) VALUES ($1, $2, $3, $4) ON CONFLICT (version) DO UPDATE SET status = $4',
            [version, file, checksum, 'failed']
          );
        } catch {}
        throw migrationErr;
      }
    }

    console.log('All migrations completed successfully.');
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
    } catch {}
    await client.end();
  }
}

run().catch((err) => {
  console.error('PostgreSQL migration error:', err);
  process.exit(1);
});
