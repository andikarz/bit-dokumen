import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ISSUER: z.string().default('beasiswa-rbac'),
  JWT_AUDIENCE: z.string().default('beasiswa-api'),
  JWT_PUBLIC_KEY_FILE: z.string().optional(),
  INTERNAL_SIGNING_KEY_FILE: z.string().optional(),
  INTERNAL_GATEWAY_URL: z.string().default('http://api-gateway:9080'),
  GATEWAY_ASSERTION_PUBLIC_KEY_FILE: z.string().optional(),
  STORAGE_ROOT: z.string().default('/storage/permohonan'),
  MAX_FILE_BYTES: z.coerce.number().default(2097152),
  CLAMAV_HOST: z.string().default('clamav'),
  CLAMAV_PORT: z.coerce.number().default(3310),
  SCAN_TIMEOUT_MS: z.coerce.number().default(30000),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
