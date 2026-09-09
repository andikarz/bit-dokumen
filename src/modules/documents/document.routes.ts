import { Router } from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { DocumentController } from './document.controller.js';
import { authenticateGatewayAssertion } from '../../middleware/gateway-assertion.js';

export const documentRouter = Router();
const controller = new DocumentController();

// Multer temporary upload destination
const upload = multer({
  dest: path.join(os.tmpdir(), 'beasiswa-uploads'),
  limits: {
    fileSize: 2097152, // 2MB max
    files: 1
  }
});

documentRouter.use(authenticateGatewayAssertion(true));

documentRouter.post('/', upload.single('file'), controller.upload);
documentRouter.get('/:id', controller.getDetail);
documentRouter.get('/:id/content', controller.download);
