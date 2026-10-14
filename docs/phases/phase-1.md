# Phase 1 — Foundation and architecture

Reuse: the directory was empty; reuse the installed PostgreSQL binaries in an independent test cluster. No production database or existing code changed.

Implemented: Next.js/TypeScript structure, PostgreSQL/Prisma models, scrypt passwords, cryptographically random hashed sessions, database-backed login rate limits, fixed four-role permission policy, validated Origin, user/station/organization management services, immutable audit write API, login and role navigation foundation. The entire relational foundation is created first so later workflows share identities and relationships.

Deliverables: `architecture.md` includes the database diagram; `rbac.md` contains the matrix; `routes.md` documents route boundaries. See `validation/phase-1` for actual command evidence. Completion is conditional on all phase checks passing.
