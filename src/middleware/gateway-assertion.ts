import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import { env } from '../config/env.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        permissions?: string[];
        isTempPassword?: boolean;
        serviceCaller?: string;
      };
    }
  }
}

let assertionPublicKey: string | null = null;

function getAssertionPublicKey(): string | null {
  if (assertionPublicKey) return assertionPublicKey;
  if (env.GATEWAY_ASSERTION_PUBLIC_KEY_FILE && fs.existsSync(env.GATEWAY_ASSERTION_PUBLIC_KEY_FILE)) {
    assertionPublicKey = fs.readFileSync(env.GATEWAY_ASSERTION_PUBLIC_KEY_FILE, 'utf8');
    return assertionPublicKey;
  }
  return null;
}

export function authenticateGatewayAssertion(required = true) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const assertionHeader = req.headers['x-gateway-assertion'] as string;

    if (!assertionHeader) {
      if (required) {
        res.status(401).json({
          error: {
            code: 'MISSING_ASSERTION',
            message: 'Gateway assertion tidak ditemukan'
          },
          requestId: req.headers['x-request-id'] || 'unknown'
        });
        return;
      }
      return next();
    }

    try {
      const pubKey = getAssertionPublicKey();
      let payload: any;

      if (pubKey) {
        payload = jwt.verify(assertionHeader, pubKey, {
          algorithms: ['RS256'],
          issuer: 'bit-api-gateway',
          audience: 'bit-dokumen'
        });
      } else {
        // Fallback in local development if assertion key file not mounted
        payload = jwt.decode(assertionHeader);
      }

      if (!payload || !payload.sub) {
        throw new Error('Payload assertion tidak valid');
      }

      req.user = {
        id: payload.sub,
        role: payload.role || 'PESERTA',
        permissions: payload.permissions || [],
        isTempPassword: payload.isTempPassword || false,
        serviceCaller: payload.serviceCaller
      };

      next();
    } catch (err: any) {
      res.status(401).json({
        error: {
          code: 'INVALID_ASSERTION',
          message: err.name === 'TokenExpiredError' ? 'Gateway assertion expired' : 'Gateway assertion invalid'
        },
        requestId: req.headers['x-request-id'] || 'unknown'
      });
    }
  };
}

export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Tidak terautentikasi' } });
      return;
    }

    if (allowedRoles.includes(req.user.role) || req.user.role === 'ADMIN') {
      next();
      return;
    }

    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Peran tidak memiliki izin' },
      requestId: req.headers['x-request-id'] || 'unknown'
    });
  };
}
