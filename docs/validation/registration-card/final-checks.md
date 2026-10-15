# Registration card validation

15 October 2026.

| Check                                          | Result                          |
| ---------------------------------------------- | ------------------------------- |
| Database schema and twelve existing migrations | PASS; no migration added        |
| Lint                                           | PASS                            |
| Typecheck                                      | PASS                            |
| Regression suite                               | PASS; 44 tests, 16 files        |
| Production build after final layout correction | PASS                            |
| Formatting                                     | PASS                            |
| Production server/browser suite                | PASS; 42 checks                 |
| Normal and maximum-length card PDFs            | PASS; one 80 × 120 mm page each |
| Maximum event/customer text containment        | PASS; no clipping/truncation    |
| 203 dpi customer QR decode                     | PASS; exact database credential |
| Live development health                        | PASS; `status: ok`              |

Commands: `npm run validate:phase -- 8 --isolated`, followed by `npm run build`, `npm run lint`, `npm run format:check` and `npm run test:e2e` after correcting long-text pagination. The final build also runs Next's TypeScript check. Business-service regression tests passed before the CSS-only correction.

Evidence: [phase gates](../phase-8/results.md), [browser results](../final/results.json), [paper/QR measurements](../final/qr-print-layout.json), [maximum-length measurements](../final/registration-card-long-layout.json), [preview](../final/registration-card-design-80mm.png), [normal PDF](../final/customer-qr-80mm.pdf), [maximum-length PDF](../final/customer-qr-long-name-80mm.pdf).

Initial browser attempts exposed build/start timing and a two-page maximum-length card. Their evidence is retained here as `initial-build-timing.json` and `initial-long-text.json`; final acceptance passes. Physical printer and scanner checks remain on-site.
