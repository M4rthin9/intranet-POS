# Customer feedback

The public `/feedback` page is a mobile/desktop customer form with the configured institution name and receipt logo. It requires no staff login and has no staff navigation. Super Admin reviews responses at `/feedback-responses` using **ความคิดเห็น** in the sidebar. Existing Admin, registration, POS and payment cashier permissions and landing pages remain unchanged.

## Form and event attribution

- Required overall satisfaction score: 1–5 stars, with Thai labels and keyboard-accessible radio buttons.
- Optional service and speed scores: 1–5.
- Optional event selection: only OPEN and CLOSED events are published. No event is required for general feedback, so an empty installation remains usable without creating demo events.
- Comment type: suggestion, compliment or issue; optional comment up to 2,000 characters.
- Optional name and phone/email contact under a collapsed section. Leaving them blank stores an anonymous response. The form explains that payment details and passwords should not be entered.
- A confirmation screen appears only after the server acknowledges the saved response.

An event-specific link uses `/feedback?event=<event UUID>`. The server validates the event, supplies its authoritative name/code and checks its status again on submission. Invalid, draft or archived event links are rejected instead of recording feedback against another event. Closed events remain available for post-event feedback. Super Admin can still review historical responses for an archived event, but its new-submission link is hidden.

## Review and receipt QR

The Super Admin review page provides event filters, total responses, mean overall/service/speed scores, low-score counts, a five-level rating distribution, and twenty responses per page. General and event-specific customer links are shown in a selectable read-only field. Names/contact details appear only in this protected view; no public endpoint lists responses.

To put the form on a receipt:

1. Open **ความคิดเห็น** and choose the event, or leave the filter on all responses for a general link.
2. Copy the displayed feedback link.
3. Open **ตั้งค่า → ข้อมูล QR ท้ายใบเสร็จ**, paste the link and set the QR label to `แสดงความคิดเห็น`.
4. Save and test a newly issued 80 mm receipt with an actual phone. Existing immutable receipt snapshots retain their historical layout.

Use a URL reachable by customers. `localhost` refers to the phone itself when scanned on a phone. A localhost-only Docker deployment must first enable its documented LAN setting, with a matching canonical `POS_APP_ORIGIN`, before printing customer-accessible links. For example, after LAN deployment on the supplied host, the general form URL is `http://192.168.1.46:8081/feedback`. Trusted HTTPS is preferred for actual customer traffic. No QR setting is replaced automatically by this feature.

## Storage, retry and controls

The fourteenth forward migration creates the `Feedback` table and its optional event relation, unique UUID submission key, rating/category checks and date indexes. Existing users, branding, events and financial history are preserved. Apply `npm run db:migrate` before serving the new code; regenerate Prisma/build with owned Windows app processes stopped when replacing the loaded Prisma engine.

The form validates its payload and keeps a pending request with the original key in that tab's session storage before submission. On a lost response or reload it offers the same pending submission. Concurrent retries produce one feedback row and one `FEEDBACK_SUBMIT` audit entry. Changed data under a previously saved key returns a conflict. A definitive validation rejection allows editing; unresolved network/server errors retain the original request. Session storage is cleared after acknowledgment.

Public POST uses the existing exact-origin check and 64 KB body limit, bounded fields, a bot field and an atomic database rate bucket permitting 120 new requests per minute. An already saved request can still be acknowledged while the rate bucket is full. No customer IP is stored by feedback. Responses are not automatically verified as purchases or limited to one per attendee; the key prevents retries from duplicating a submission.

Only Super Admin has `feedback.view`. Public submission returns a generic acknowledgment without customer details. Audit entries contain the response ID, event, score and category, and omit comment text/contact details. Comments and contact values render as text rather than HTML. Both feedback API responses and review data bypass caching, and the existing service worker excludes `/api/`.

## Validation

Current checks pass schema/fourteen migrations, formatting, lint, typecheck, 56 regression tests across 20 files and the production build. The feedback browser scenario adds seven checks to the existing 45-check POS/payment acceptance flow. Validation creates fixtures only in `ccida_validation_test`; the operational database is checked separately.

Use only the separate `_test` validation database. These commands create test responses and events; do not run them against the clean operational database:

```powershell
npm run db:migrate:test
npm test
npm run build
npm run test:feedback
npm run test:e2e
```

The feedback integration suite exercises anonymous/optional contact data, redacted audit records, concurrent retries, mismatched keys, event publication/status rules, invalid scores and lengths, SQL constraints, restricted review/statistics, CSRF, body limits and throttled replay. Browser acceptance checks the actual built production server, receipt-event links, institution logo, desktop/mobile layouts, a dropped response followed by reload/retry, anonymous storage, Super Admin review, denial of Admin access, escaped comments and absence of external requests.

See [feedback acceptance results](validation/feedback/results.json), [desktop form](validation/feedback/desktop.png), [mobile form](validation/feedback/mobile.png), [confirmation](validation/feedback/thank-you.png) and [Super Admin review](validation/feedback/superadmin-review.png). Acceptance screenshots use synthetic test data. Native operational data is checked separately after validation to ensure the five-account clean installation has not been repopulated with fixtures.
