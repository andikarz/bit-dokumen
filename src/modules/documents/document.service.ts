import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { DocumentRepository, DocumentRecord } from './document.repository.js';
import { scanner } from '../scanner/clamav-scanner.js';
import { env } from '../../config/env.js';

export class DocumentService {
  private repo: DocumentRepository;
  private quarantineDir: string;
  private activeDir: string;

  constructor() {
    this.repo = new DocumentRepository();
    this.quarantineDir = path.join(env.STORAGE_ROOT, 'quarantine');
    this.activeDir = path.join(env.STORAGE_ROOT, 'active');

    if (!fs.existsSync(this.quarantineDir)) {
      fs.mkdirSync(this.quarantineDir, { recursive: true });
    }
    if (!fs.existsSync(this.activeDir)) {
      fs.mkdirSync(this.activeDir, { recursive: true });
    }
  }

  /**
   * Process uploaded document:
   * 1. Validate reservation via Gateway internal route
   * 2. Save to quarantine
   * 3. Validate magic bytes / MIME
   * 4. Antivirus scan via ClamAV Unix socket
   * 5. Move clean file to active storage
   * 6. Save metadata to PostgreSQL
   * 7. Commit binding via Gateway internal route
   */
  async uploadAndScanDocument(
    file: Express.Multer.File,
    reservationId: string,
    user: { id: string; role: string }
  ): Promise<DocumentRecord> {
    const documentId = uuidv4();

    // ── 1. Validate Reservation via Internal Gateway :9080 ─────────
    const reservation = await this.validateReservationWithTransaksi(reservationId);
    if (!reservation) {
      throw new Error('Gagal memvalidasi izin reservasi dokumen');
    }

    if (reservation.applicantId !== user.id) {
      const err = new Error('Izin reservasi tidak cocok dengan pengguna aktif') as any;
      err.statusCode = 403;
      err.code = 'FORBIDDEN_RESERVATION';
      throw err;
    }

    // ── 2. Move file to Quarantine Storage ───────────────────────
    const tempExtension = path.extname(file.originalname).toLowerCase() || '.bin';
    const quarantinePath = path.join(this.quarantineDir, `${documentId}${tempExtension}`);

    fs.copyFileSync(file.path, quarantinePath);
    try {
      fs.unlinkSync(file.path);
    } catch {
      // Ignored
    }

    try {
      const { fileTypeFromFile } = await (import('file-type') as Promise<any>);
      const detectedType = await fileTypeFromFile(quarantinePath);
      const allowedMimes: string[] = reservation.allowedTypes || ['application/pdf', 'image/jpeg', 'image/png'];

      const effectiveMime = detectedType ? detectedType.mime : file.mimetype;
      if (!allowedMimes.includes(effectiveMime)) {
        throw {
          statusCode: 422,
          code: 'INVALID_FILE_TYPE',
          message: `Format berkas tidak diizinkan (${effectiveMime}). Format yang didukung: ${allowedMimes.join(', ')}`
        };
      }

      // Check file size (max 2MB)
      const stats = fs.statSync(quarantinePath);
      if (stats.size > env.MAX_FILE_BYTES) {
        throw {
          statusCode: 413,
          code: 'FILE_TOO_LARGE',
          message: `Ukuran berkas (${stats.size} bytes) melebihi batas maksimum ${env.MAX_FILE_BYTES} bytes`
        };
      }

      // ── 4. Scan with ClamAV via Unix Domain Socket (revisi.txt §6)
      const scanResult = await scanner.scanFile(quarantinePath);
      if (!scanResult.isClean) {
        throw {
          statusCode: 422,
          code: 'VIRUS_DETECTED',
          message: `Berkas ditolak: Terdeteksi ancaman (${scanResult.threatFound || 'Ancaman tidak dikenal'})`
        };
      }

      // ── 5. Move clean file to permanent active storage ──────────
      const registrationCode = reservation.registrationCode || 'REG-UNKNOWN';
      const programActiveDir = path.join(this.activeDir, registrationCode);
      if (!fs.existsSync(programActiveDir)) {
        fs.mkdirSync(programActiveDir, { recursive: true });
      }

      const activeFilename = `${documentId}${tempExtension}`;
      const activePath = path.join(programActiveDir, activeFilename);
      fs.renameSync(quarantinePath, activePath);

      // Compute SHA256
      const fileBuffer = fs.readFileSync(activePath);
      const sha256Hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // ── 6. Save metadata in PostgreSQL ──────────────────────────
      const savedDoc = await this.repo.saveCleanDocument(
        {
          id: documentId,
          applicationId: reservation.applicationId,
          requirementTypeCode: reservation.requirementTypeCode,
          ownerId: user.id,
          originalFilename: file.originalname,
          storedFilename: activeFilename,
          storagePath: activePath,
          mimeType: effectiveMime,
          fileSize: stats.size,
          sha256Hash
        },
        {
          engine: scanResult.engine,
          engineVersion: scanResult.engineVersion,
          scanDurationMs: scanResult.scanDurationMs
        }
      );

      // ── 7. Commit Binding to Transaksi via Internal Gateway ─────
      await this.commitBindingToTransaksi(reservationId, {
        documentId: savedDoc.id,
        originalFilename: savedDoc.original_filename,
        mimeType: savedDoc.mime_type,
        fileSize: savedDoc.file_size,
        sha256Hash: savedDoc.sha256_hash,
        storagePath: savedDoc.storage_path,
        isClean: true
      });

      return savedDoc;
    } catch (err) {
      // Clean up quarantine file on failure
      if (fs.existsSync(quarantinePath)) {
        try {
          fs.unlinkSync(quarantinePath);
        } catch {
          // Ignored
        }
      }
      throw err;
    }
  }

  async getDocumentDetail(id: string, user: { id: string; role: string }): Promise<DocumentRecord> {
    const doc = await this.repo.findById(id);
    if (!doc) {
      const err = new Error('Dokumen tidak ditemukan') as any;
      err.statusCode = 404;
      err.code = 'DOCUMENT_NOT_FOUND';
      throw err;
    }

    const isStaff = ['ADMIN', 'VERIFIKATOR', 'LEMBAGA_SELEKSI'].includes(user.role);
    if (!isStaff && doc.owner_id !== user.id) {
      const err = new Error('Anda tidak berhak mengakses dokumen ini') as any;
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    return doc;
  }

  async getDocumentForDownload(
    id: string,
    user: { id: string; role: string },
    ipAddress?: string,
    requestId?: string
  ): Promise<{ doc: DocumentRecord; filePath: string }> {
    const doc = await this.getDocumentDetail(id, user);

    // revisi.txt §7: Dilarang melayani file dalam status karantina
    if (doc.status === 'QUARANTINED' || doc.scan_status !== 'CLEAN') {
      const err = new Error('Berkas ini berada dalam status karantina dan tidak dapat diunduh') as any;
      err.statusCode = 403;
      err.code = 'DOCUMENT_QUARANTINED';
      throw err;
    }

    if (!fs.existsSync(doc.storage_path)) {
      const err = new Error('Berkas fisik tidak ditemukan di media penyimpanan') as any;
      err.statusCode = 404;
      err.code = 'FILE_NOT_FOUND_ON_DISK';
      throw err;
    }

    // Record access audit
    await this.repo.recordAccessAudit(id, user.id, 'DOWNLOAD', ipAddress, requestId);

    return { doc, filePath: doc.storage_path };
  }

  private async validateReservationWithTransaksi(reservationId: string): Promise<any> {
    const gatewayUrl = env.INTERNAL_GATEWAY_URL || 'http://api-gateway:9080';
    const response = await fetch(
      `${gatewayUrl}/internal/v1/transaksi/document-reservations/${reservationId}/validate`,
      {
        headers: {
          'x-caller-service': 'bit-dokumen'
        }
      }
    );

    if (!response.ok) {
      const body: any = await response.json().catch(() => ({}));
      const err = new Error(body.error?.message || 'Reservasi dokumen tidak valid atau telah kedaluwarsa') as any;
      err.statusCode = response.status;
      err.code = body.error?.code || 'INVALID_RESERVATION';
      throw err;
    }

    const data: any = await response.json();
    return data.data;
  }

  private async commitBindingToTransaksi(reservationId: string, docData: any): Promise<void> {
    const gatewayUrl = env.INTERNAL_GATEWAY_URL || 'http://api-gateway:9080';
    const response = await fetch(
      `${gatewayUrl}/internal/v1/transaksi/document-reservations/${reservationId}/commit`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-caller-service': 'bit-dokumen'
        },
        body: JSON.stringify(docData)
      }
    );

    if (!response.ok) {
      console.error(`[bit-dokumen] Gagal commit document reservation ke Transaksi (${response.status})`);
    }
  }
}
