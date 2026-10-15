# Sale recording conflict correction

The reported failure occurs after saving a sale. Repository and database inspection found an active `demo.superadmin` shift on a REGISTRATION station. Automatic context resolution correctly retains that shift, but order and payment services previously rejected its station type. This was inconsistent with `shift.open`, which already allows a super administrator to open any active station type.

A real PostgreSQL regression reproduced the sale failure before the fix: `order.create` returned `Station is inactive or has the wrong type.` (409). The station check now accepts any active station for the authenticated SUPER_ADMIN role across registration, sales, payment generation and confirmation. Other roles retain their type restrictions. Open-period, own-shift, account, stock, settlement and idempotency checks remain enforced.

No user shift was closed or reassigned and no historical station type, transaction or audit record was rewritten. The same original shift/station remains attached to new authorized transactions.

Operation conflicts now log the action and application reason beside the generic HTTP status. Logs omit request bodies, passwords, session cookies, customer QR tokens and bank evidence. Genuine conflicts still return 409; they are not converted into successful responses.

Validation passes database/schema/migration checks, lint, typecheck, **33 regression tests across 12 files**, production build and formatting. **34 production-server/browser checks** pass, including authenticated HTTP registration, sale creation and settlement under an existing SUPER_ADMIN registration shift. Original shift/station IDs and station type remain unchanged. Other-role, inactive-station, closed-period and duplicate-request protections also pass. The development server is healthy at http://localhost:3000.

Evidence: [phase gates](validation/phase-8/results.md), [regression log](validation/phase-8/test.log), [production acceptance](validation/final/results.json), [server conflict diagnostics](validation/final/server.log). The ordinary HTTP LAN checkout result from the preceding interface validation remains applicable; its cashier behavior is unchanged.
