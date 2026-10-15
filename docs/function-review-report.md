# Complete function review and fixes

Date: 14 October 2026. Status: **COMPLETE — all validation gates passed**.

Reviewed the components, service functions, API routes, database schema/migrations, role rules, audit/idempotency controls, startup/build/seed scripts, backup worker, exports, PWA and deployment configuration against the master specification. The existing architecture was extended. Existing data, runtime `.env`, financial snapshots and audit history were preserved. No migration or database reset was needed.

## Corrected defects

- **Startup/login:** `npm run dev` and `dev:test` select the guarded test connection, preventing repeated login 503 errors from the unavailable runtime database. `dev:runtime` and production `npm start` explicitly retain runtime configuration.
- **CSP:** React debugging can use eval in development; production excludes unsafe-eval and restricts workers/objects. Configured development hostnames are admitted explicitly.
- **Financial retries:** order and payment intents are saved before dispatch, validated on restoration, and replayed with the original keys across reloads/authentication loss. HTML/truncated replies, throttling and authorization failures preserve uncertain requests.
- **Payment display:** generation rechecks central payment/account state. Confirmed/corrected payments no longer show a usable payment QR or invalid confirmation form. Confirmation updates settled details and order statuses.
- **Registration:** settled customer details can be corrected without submitting an invalid status or reopening the account. QR/status-change reasons reject whitespace-only input.
- **Event context:** registration, stock, shifts, closing and controls remount for the selected event. In-flight requests prevent context changes. Storage failures cannot prevent metadata loading. Distinct shift-bar keys remove React duplicate-key warnings.
- **Forms:** successful creation resets inputs; failed submissions retain them. Accessible field labels remain stable, required textareas/password limits are enforced, and in-flight confirmations cannot be cancelled into duplicate actions. Closed/archived events cannot use ordinary edit controls.
- **Users/history:** user search and automatic selection of the saved username expose accounts beyond the 300-row list. Control screens search older financial records. Open shifts remain visible beyond 100 closed shifts. Cashier ownership rules remain enforced.
- **User controls:** shifts must close before disabling a user/changing role. Last-active-super-admin protection applies to active accounts, allowing safe reassignment of a disabled administrator.
- **Stock:** opening/adjustment selectors distinguish uninitialized/existing inventory. Exhausted product tiles are unavailable and low stock has a visible warning. Opening balances/movements remain intact.
- **Reports:** exports/dashboard share payment confirmation/void/pending date rules. Trend filters honor Thai dates while preserving prior balance history. Missing events return a not-found error.
- **Backups:** claims compare their JSON state; completion/failure respects the owning lease. Recording schedule success cannot overwrite concurrent configuration edits.
- **Windows build:** matching schema/SDK/client/engine files are reused so an unchanged client DLL is not replaced while the app runs. Missing/changed clients still invoke real Prisma generation.

## Validation

| Check                                       | Result                                                  |
| ------------------------------------------- | ------------------------------------------------------- |
| Schema and all nine migrations              | PASS                                                    |
| Lint, TypeScript, formatting                | PASS                                                    |
| Full regression suite                       | 29 PASS across eleven files                             |
| `npm run build`, with dev app still running | PASS                                                    |
| Production-server/browser acceptance        | 32 PASS                                                 |
| Ordinary HTTP LAN checkout                  | PASS                                                    |
| Concurrent checkout                         | 10 committed, zero failures, 503 ms                     |
| Reconciled report                           | PASS, 31 ms                                             |
| Dependency audit                            | Zero vulnerabilities                                    |
| Live health/login                           | HTTP 200                                                |
| Development browser                         | No page errors, eval warnings or duplicate-key warnings |

Acceptance includes the complete master scenario, real catalog/stock/user/station forms, settled edits, event switching, draft/open/close/archive controls, all eleven CSV exports, PWA rules, actual backup/download and concurrent workers. Tests commit and drop order/payment responses, lose authentication, reload and replay the original request without duplicate transactions or confirmation. Printer failures preserve settlement; repeat printing produces audited COPY.

Final command logs are under `validation/phase-8`; browser results/artifacts are under `validation/final`. Earlier form-label/list-limit failures are retained in `validation/function-review` as diagnostic history.

## Run and readiness

```powershell
npm run db:seed
npm run dev
```

Open http://localhost:3000 and select DEMO-CCIDA-TEST. See [test logins](test-seed.md). The app is running against `ccida_test`; production credentials are never substituted automatically.

Production readiness remains **READY WITH CONDITIONS**: configure the real runtime database, deploy on the target host and commission bank evidence, physical peripherals, trusted LAN HTTPS/DNS and protected backups. Docker is unavailable here, and development-host timing does not certify target capacity. Runtime `.env` is preserved and unavailable; the guarded test-development command is functional.
