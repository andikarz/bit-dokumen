# bit-dokumen

Dokumen service for the Beasiswa Pelatihan platform.

## Features
- Secure file upload processing with reservation validation via internal Gateway
- Magic bytes verification using file-type (preventing extension spoofing)
- ClamAV antivirus scanning prior to making file available (fail-closed)
- Private storage layout: `/storage/permohonan/{kode}/{uuid}.{ext}`
- Streaming download with authentication and anti-IDOR checks

## Database
- PostgreSQL 16 (`document_db`)
- Native access using `pg.Pool` (no ORM)

## Scripts
- `npm run dev`: Start service in development mode
- `npm run build`: Compile TypeScript
- `npm run db:migrate`: Run database migrations
- `npm run db:migrate:status`: Check migration status
- `npm run db:seed`: Ensure storage directory exists
