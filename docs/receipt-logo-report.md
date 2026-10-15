# Receipt organization logo

15 October 2026 · completed.

The receipt's placeholder C icon is replaced by the organization logo supplied at `F:\ทัณฑสถานบำบัดพิเศษกลาง.png`. The original 7.8 MB file is unchanged. The real local Super Admin settings UI saved a compact PNG copy (23,645 bytes), so receipts do not depend on the original drive/path. Existing organization, header/footer and information-QR settings were verified unchanged.

Original and COPY receipts place the image centrally above the organization name, preserving its proportions inside a 36 × 24 mm box on 80 mm paper. Circular logos remain circular. The adaptive receipt height includes the logo; actual print-media measurements show zero center offset, no horizontal overflow and one PDF page. Receipt printing waits for the logo to decode before opening the print dialog. Financial snapshots, settlement, receipt numbers/barcodes and copy audits retain their existing behavior.

Super Admin can change the image in **ตั้งค่า → โลโก้บนใบเสร็จ → อัปโหลดโลโก้ใบเสร็จ → บันทึกโลโก้**. PNG, JPEG and WebP sources up to 10 MB are accepted. The browser preserves aspect ratio and converts a bounded copy to PNG. Only a fully decoded PNG up to 384 × 256 pixels / 32 KB is accepted by the server, within the existing 64 KB JSON request limit. Unsafe URLs/SVG, corrupt files, oversized images and unauthorized settings changes are rejected. Empty branding displays the organization name without the former C icon.

Logo settings use the existing `receipt-layout` SystemSetting and audited `settings.save` operation; omitted fields retain their previous values. Database backup/restore includes the image. No migration, financial data reset, new upload endpoint or public file storage was needed. `sharp` is declared at the already-installed version 0.35.5 for full server-side image validation. The upload uses FileReader data URLs, so the existing image CSP remains unchanged.

Validation:

- Database/schema and all **13 migrations** current.
- Lint, typecheck, formatting, **48 tests across 18 files** and production build pass.
- **45 complete production-server/browser checks** pass, including real file upload, save/reload preview, centered screen/print logo, one-page 80 mm original/COPY receipts, independent QR/barcode decoding, lost-response recovery, closed-event copies and backups.
- Real organization logo installed through the live application; original-file SHA-256 unchanged and other receipt settings preserved.
- One unrelated randomized customer-QR decoding assertion failed during an initial acceptance run. The complete rerun passed without changes to QR generation or decoding; evidence is retained at `validation/receipt-logo/initial-qr-decode.json`.

Evidence: [receipt with supplied logo](validation/final/receipt-with-organization-logo.png), [80 mm PDF](validation/final/receipt-with-organization-logo-80mm.pdf), [Settings preview](validation/final/receipt-logo-settings.png), [actual print measurements](validation/final/receipt-organization-logo-layout.json), [complete acceptance](validation/final/results.json), [phase gates](validation/phase-8/results.md).
