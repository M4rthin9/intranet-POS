# GitHub production release preparation

15 October 2026 · repository: [M4rthin9/intranet-POS](https://github.com/M4rthin9/intranet-POS) · branch: `main`.

The release contains the complete Event POS implementation, thirteen additive migrations, role-separated cashier workspaces, user/event assignments, automatic staff sessions, exact-money and idempotent transaction services, verified PromptPay settlement, controls/audit/reporting/stock/closing, 80 mm QR/receipt printing and configurable organization branding. Existing working architecture and financial history are preserved.

Published material includes source, tests, guarded demo-data generators, CI, deployment templates, the compact organization logo at `public/receipt-logo.png`, operator guides, phase reports and synthetic acceptance evidence. Runtime `.env` files, database clusters, backup archives, dependencies/build output and customer-containing local previews are excluded. The original logo source remains unchanged. A candidate-file scan found no private keys/service tokens or matching runtime secret values.

Release gates use the separate `_test` database: schema/migration status, lint, typecheck, all regression tests, production build, formatting, complete HTTP/browser acceptance, ordinary HTTP LAN checkout, concurrency/reconciliation and dependency audit. Current exact results are in [phase 8](validation/phase-8/results.md), [browser acceptance](validation/final/results.json), [HTTP LAN](validation/final/http-lan.json) and [performance](validation/final/performance.json). The pre-release dependency audit reports zero vulnerabilities.

Local release acceptance passes **48 tests across 18 files**, **45 production-server/browser checks**, all thirteen migrations, lint, typecheck, production build and formatting. HTTP LAN checkout and Thai-timezone checks pass. Ten concurrent independent-account sales all commit and reconcile; this host recorded 232 ms total wall time and a 22 ms report query. These are local measurements, not target-host capacity certification.

[GitHub Actions](../.github/workflows/validate.yml) runs the same application checks on Node 24/PostgreSQL 17 and then tests the production Compose stack in a new CI project. The second job builds the production/maintenance images, starts PostgreSQL/app/backup worker, verifies health through the restricted application role, bootstraps an administrator, checks authentication/settings access and reapplies migrations without resetting data. CI-only credentials and volumes are confined to the hosted runner. GitHub publication does not deploy or change an operational server.

The first Linux acceptance run passed receipt/logo sizing, original/COPY printing and financial flows, then exposed an immediate assertion racing the scheduled next-customer scanner focus. Acceptance now waits up to two seconds for the existing animation-frame focus operation rather than checking before the browser frame runs; the focus requirement and production behavior remain unchanged.

A recurring 203 dpi QR validation failure was reproduced with its exact raster. An independent full-image reader decoded it correctly; the previous reader had misidentified finder patterns for that payload. The validation helper now uses jsQR's full-image QR detector before the existing ZXing fallback, and retains ZXing for CODE128. A captured-raster regression test checks the decoded content hash. QR generation, print dimensions, payloads and physical-scanner commissioning requirements are unchanged; no pure-symbol bypass is used.

This regression brings the complete suite to **49 tests across 19 files**. The new decoder test and existing receipt-layout integrations pass together, and all **45 browser/API checks** pass again after the validation fixes. CI runs the complete suite and the production container gate on the pushed commit; the README badge links to its live result.

## Live production status

**Application release candidate; live commissioning required.** Local validation and GitHub CI certify the checked code/images, not the institution's operational configuration. Following the authorized clean setup, the local runtime connection is healthy and contains one real account per role, with no events, products, financial transactions or demo accounts. Passwords are generated securely, stored privately and excluded from Git. Automated fixtures use a separate validation database. See [clean setup](clean-start-report.md).

Before serving real transactions:

1. Configure reachable production database credentials with separate migration-owner/application roles, using [the production template](../deploy/production.env.example).
2. Apply migrations, bootstrap a strong administrator and configure staff/event assignments, products, stock and the actual institutional PromptPay recipient.
3. Upload `public/receipt-logo.png` in Settings on a fresh database; existing installations keep their saved branding. Transfer any operational data only by the protected backup/restore procedure, never through Git.
4. Configure LAN DNS, trusted HTTPS and matching `APP_ORIGIN`/Caddy hostname.
5. Confirm a controlled bank payment, physical 80 mm printer/scanner output, target-host capacity and protected backup/restore operation.

See [deployment](deployment.md), [final implementation report](final-implementation-report.md), [operator guide](operator-guide.md) and [backup/restore](backup-restore.md). Source readiness and remaining target-host requirements are reported separately; no operational data was deleted, reset or replaced during release preparation.
