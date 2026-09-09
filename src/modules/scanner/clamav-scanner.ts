import net from 'node:net';
import fs from 'node:fs';
import { env } from '../../config/env.js';

export interface ScanResult {
  isClean: boolean;
  threatFound: string | null;
  scanDurationMs: number;
  engine: string;
  engineVersion: string;
}

interface QueuedScan {
  filePath: string;
  resolve: (result: ScanResult) => void;
  reject: (err: Error) => void;
  queuedAt: number;
}

export class ClamAVScanner {
  private static instance: ClamAVScanner | null = null;
  private activeScans = 0;
  private readonly maxConcurrentScans = 1; // revisi.txt §6: 1 active scan at a time
  private readonly maxQueueLength = 10;     // bounded queue for backpressure
  private readonly queue: QueuedScan[] = [];

  private constructor() {}

  public static getInstance(): ClamAVScanner {
    if (!ClamAVScanner.instance) {
      ClamAVScanner.instance = new ClamAVScanner();
    }
    return ClamAVScanner.instance;
  }

  /**
   * Check if ClamAV daemon is healthy (via socket or TCP)
   */
  public async ping(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = this.createConnection();
      let responded = false;

      socket.setTimeout(3000);

      socket.on('connect', () => {
        socket.write('PING\n');
      });

      socket.on('data', (data) => {
        responded = true;
        socket.destroy();
        resolve(data.toString().includes('PONG'));
      });

      socket.on('timeout', () => {
        socket.destroy();
        if (!responded) resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        if (!responded) resolve(false);
      });
    });
  }

  /**
   * Get ClamAV engine version string
   */
  public async getVersion(): Promise<string> {
    return new Promise((resolve) => {
      const socket = this.createConnection();
      let output = '';

      socket.setTimeout(3000);

      socket.on('connect', () => {
        socket.write('VERSION\n');
      });

      socket.on('data', (data) => {
        output += data.toString();
      });

      socket.on('end', () => {
        resolve(output.trim() || 'ClamAV');
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve('ClamAV');
      });

      socket.on('error', () => {
        socket.destroy();
        resolve('ClamAV');
      });
    });
  }

  /**
   * Scan a file on disk with strict concurrency limit and fail-closed security
   */
  public async scanFile(filePath: string): Promise<ScanResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File to scan does not exist: ${filePath}`);
    }

    if (this.queue.length >= this.maxQueueLength) {
      const err = new Error('Antivirus scanner queue is full. Please retry shortly.');
      (err as any).statusCode = 429;
      (err as any).code = 'SCANNER_BUSY';
      throw err;
    }

    return new Promise<ScanResult>((resolve, reject) => {
      this.queue.push({
        filePath,
        resolve,
        reject,
        queuedAt: Date.now()
      });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.activeScans >= this.maxConcurrentScans || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeScans++;
    this.executeScan(item.filePath)
      .then((res) => item.resolve(res))
      .catch((err) => item.reject(err))
      .finally(() => {
        this.activeScans--;
        this.processQueue();
      });
  }

  private executeScan(filePath: string): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const socket = this.createConnection();
      let buffer = '';
      let timedOut = false;

      socket.setTimeout(env.SCAN_TIMEOUT_MS);

      socket.on('connect', () => {
        // revisi.txt §6: Scan file via Unix socket directly from shared filesystem
        socket.write(`SCAN ${filePath}\n`);
      });

      socket.on('data', (chunk) => {
        buffer += chunk.toString();
      });

      socket.on('timeout', () => {
        timedOut = true;
        socket.destroy();
        const err = new Error(`ClamAV scan timed out after ${env.SCAN_TIMEOUT_MS}ms`);
        (err as any).statusCode = 503;
        (err as any).code = 'SCANNER_TIMEOUT';
        reject(err);
      });

      socket.on('error', (err) => {
        socket.destroy();
        if (!timedOut) {
          const scanErr = new Error(`ClamAV scan connection error: ${err.message}`);
          (scanErr as any).statusCode = 503;
          (scanErr as any).code = 'SCANNER_UNAVAILABLE';
          reject(scanErr);
        }
      });

      socket.on('end', () => {
        if (timedOut) return;
        const duration = Date.now() - startTime;
        const response = buffer.trim();

        // Response format:
        // /path/to/file: OK
        // /path/to/file: Eicar-Signature FOUND
        // /path/to/file: ERROR
        if (response.endsWith('OK')) {
          resolve({
            isClean: true,
            threatFound: null,
            scanDurationMs: duration,
            engine: 'ClamAV',
            engineVersion: '1.4'
          });
        } else if (response.includes('FOUND')) {
          const match = response.match(/:\s+(.+?)\s+FOUND/);
          const threat = match ? match[1] : 'Threat Detected';
          resolve({
            isClean: false,
            threatFound: threat,
            scanDurationMs: duration,
            engine: 'ClamAV',
            engineVersion: '1.4'
          });
        } else {
          // If scanner reported error or unexpected output, fail-closed!
          const scanErr = new Error(`ClamAV scan failed: ${response}`);
          (scanErr as any).statusCode = 503;
          (scanErr as any).code = 'SCANNER_ERROR';
          reject(scanErr);
        }
      });
    });
  }

  private createConnection(): net.Socket {
    const socket = new net.Socket();

    // Primary: Unix domain socket
    if (env.CLAMAV_SOCKET_PATH && (fs.existsSync(env.CLAMAV_SOCKET_PATH) || process.platform !== 'win32')) {
      socket.connect(env.CLAMAV_SOCKET_PATH);
    } else {
      // Fallback: TCP (for dev/test outside docker if configured)
      socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST);
    }

    return socket;
  }
}

export const scanner = ClamAVScanner.getInstance();
