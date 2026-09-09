import { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import { DocumentService } from './document.service.js';

export class DocumentController {
  private service: DocumentService;

  constructor() {
    this.service = new DocumentService();
  }

  upload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Tidak terautentikasi' } });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: { code: 'MISSING_FILE', message: 'Berkas dokumen wajib diunggah' } });
        return;
      }

      const reservationId = req.body.reservationId;
      if (!reservationId) {
        res.status(400).json({ error: { code: 'MISSING_RESERVATION_ID', message: 'reservationId wajib disertakan' } });
        return;
      }

      const doc = await this.service.uploadAndScanDocument(
        req.file,
        reservationId,
        { id: req.user.id, role: req.user.role }
      );

      res.status(201).json({
        message: 'Dokumen berhasil diunggah, dipindai, dan diverifikasi',
        data: {
          id: doc.id,
          applicationId: doc.application_id,
          requirementTypeCode: doc.requirement_type_code,
          originalFilename: doc.original_filename,
          mimeType: doc.mime_type,
          fileSize: doc.file_size,
          sha256Hash: doc.sha256_hash,
          scanStatus: doc.scan_status,
          status: doc.status,
          createdAt: doc.created_at
        },
        requestId: req.headers['x-request-id'] || 'unknown'
      });
    } catch (err) {
      next(err);
    }
  };

  getDetail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Tidak terautentikasi' } });
        return;
      }

      const doc = await this.service.getDocumentDetail(req.params.id as string, {
        id: req.user.id,
        role: req.user.role
      });

      res.status(200).json({
        data: {
          id: doc.id,
          applicationId: doc.application_id,
          requirementTypeCode: doc.requirement_type_code,
          originalFilename: doc.original_filename,
          mimeType: doc.mime_type,
          fileSize: doc.file_size,
          sha256Hash: doc.sha256_hash,
          scanStatus: doc.scan_status,
          status: doc.status,
          createdAt: doc.created_at
        },
        requestId: req.headers['x-request-id'] || 'unknown'
      });
    } catch (err) {
      next(err);
    }
  };

  download = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Tidak terautentikasi' } });
        return;
      }

      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
      const requestId = (req.headers['x-request-id'] as string) || 'unknown';

      const { doc, filePath } = await this.service.getDocumentForDownload(
        req.params.id as string,
        { id: req.user.id, role: req.user.role },
        clientIp,
        requestId
      );

      res.setHeader('Content-Type', doc.mime_type);
      res.setHeader('Content-Length', doc.file_size);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.original_filename)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

      const stream = fs.createReadStream(filePath);
      stream.on('error', (streamErr) => {
        next(streamErr);
      });
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  };
}
