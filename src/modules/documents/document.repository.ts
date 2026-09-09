import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../../db/pool.js';

export interface DocumentRecord {
  id: string;
  application_id: string;
  requirement_type_code: string;
  owner_id: string;
  original_filename: string;
  stored_filename: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  sha256_hash: string;
  status: string;
  scan_status: string;
  is_bound: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class DocumentRepository {
  async findById(id: string): Promise<DocumentRecord | null> {
    const pool = getPool();
    const res = await pool.query<DocumentRecord>(
      `SELECT * FROM documents WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  async saveCleanDocument(
    doc: {
      id: string;
      applicationId: string;
      requirementTypeCode: string;
      ownerId: string;
      originalFilename: string;
      storedFilename: string;
      storagePath: string;
      mimeType: string;
      fileSize: number;
      sha256Hash: string;
    },
    scanResult: {
      engine: string;
      engineVersion: string;
      scanDurationMs: number;
    }
  ): Promise<DocumentRecord> {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Insert or update document
      const docRes = await client.query<DocumentRecord>(
        `INSERT INTO documents (
          id, application_id, requirement_type_code, owner_id,
          original_filename, stored_filename, storage_path, mime_type,
          file_size, sha256_hash, status, scan_status, is_bound, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', 'CLEAN', TRUE, 1)
        ON CONFLICT (id) DO UPDATE SET
          stored_filename = EXCLUDED.stored_filename,
          storage_path = EXCLUDED.storage_path,
          mime_type = EXCLUDED.mime_type,
          file_size = EXCLUDED.file_size,
          sha256_hash = EXCLUDED.sha256_hash,
          status = 'ACTIVE',
          scan_status = 'CLEAN',
          is_bound = TRUE,
          version = documents.version + 1,
          updated_at = NOW()
        RETURNING *`,
        [
          doc.id,
          doc.applicationId,
          doc.requirementTypeCode,
          doc.ownerId,
          doc.originalFilename,
          doc.storedFilename,
          doc.storagePath,
          doc.mimeType,
          doc.fileSize,
          doc.sha256Hash
        ]
      );

      const savedDoc = docRes.rows[0];

      // 2. Insert document version
      await client.query(
        `INSERT INTO document_versions (
          id, document_id, version, stored_filename, storage_path, file_size, sha256_hash, scan_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'CLEAN')`,
        [
          uuidv4(),
          savedDoc.id,
          savedDoc.version,
          savedDoc.stored_filename,
          savedDoc.storage_path,
          savedDoc.file_size,
          savedDoc.sha256_hash
        ]
      );

      // 3. Insert scan result
      await client.query(
        `INSERT INTO scan_results (
          id, document_id, engine, engine_version, is_clean, threat_found, scan_duration_ms
        ) VALUES ($1, $2, $3, $4, TRUE, NULL, $5)`,
        [
          uuidv4(),
          savedDoc.id,
          scanResult.engine,
          scanResult.engineVersion,
          scanResult.scanDurationMs
        ]
      );

      await client.query('COMMIT');
      return savedDoc;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async recordAccessAudit(
    documentId: string,
    actorId: string,
    action: string,
    ipAddress?: string,
    requestId?: string
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO access_audit (id, document_id, actor_id, action, ip_address, request_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), documentId, actorId, action, ipAddress || null, requestId || null]
    );
  }
}
