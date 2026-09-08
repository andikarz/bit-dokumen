# ADR 001: SQL Access Without ORM or Query Builder

## Status
Accepted (Mandatory per PRD v1.3 §7.1 and PT-07)

## Context
Per Petunjuk Testing and user instructions, database access across all microservices must NOT use Object-Relational Mapping (ORM) tools (such as Prisma, TypeORM, Sequelize, or Drizzle) or query builders (such as Knex or Kysely). The application must execute explicit parameterized SQL statements directly through native driver pools.

## Decision
1. **Driver Selection**:
   - MySQL services (`bit-rbac`, `bit-master`, `bit-transaksi`): Use `mysql2/promise` connection pool.
   - PostgreSQL service (`bit-dokumen`): Use `pg.Pool` (`node-postgres`).
2. **Parameterized Statements**:
   - All user inputs must be passed via parameters (`?` for MySQL, `$1, $2` for PostgreSQL).
   - String concatenation or template literal interpolation into SQL text is strictly prohibited.
   - Dynamic sorting or column names must be validated against a strict server-side allowlist.
3. **Transaction Management**:
   - Atomic multi-statement operations must acquire a single connection/client explicitly, begin a transaction, execute queries, commit or rollback, and always release the connection in a `finally` block.
4. **Schema Migrations**:
   - Migrations are versioned SQL scripts (`db/migrations/0001_initial.sql`, etc.).
   - Migrations are tracked via the `schema_migrations` table with SHA-256 checksums and executed with database advisory locks.

## Consequences
- **Positive**: Total control over query performance, zero ORM generation overhead, strict compliance with testing instructions, predictable transactions without ORM magic.
- **Negative**: Requires writing SQL statements, manual DTO mapping, and explicit migration scripts.
