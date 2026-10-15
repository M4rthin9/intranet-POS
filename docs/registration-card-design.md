# Registration QR card design

15 October 2026 · Asia/Bangkok.

The registration desk now creates and reprints a professional monochrome customer pass on **80 × 120 mm paper**, with 4 mm margins and a 46 mm QR centered horizontally and vertically. Event information sits above the QR; customer identification and use instructions sit below it. The registration card and payment QR keep distinct headings and purposes.

## Printed information

- CCIDA wordmark and registration heading.
- Event name and event code, taken from the registration's actual event.
- Card issue date/time in Thailand; a reprint keeps the credential's original issue time, while a reissue uses the replacement credential's issue time.
- Customer name and registration number, including wrapping for maximum-length values.
- Three instructions: show the QR at a POS to record a purchase; use the same card for all purchases in this event; present the card at the payment desk before leaving.
- Lost-card assistance: contact the registration desk.

The QR continues to contain only the existing opaque credential. It does not embed event/customer details or a balance. Updated event names appear on subsequent prints; the browser's selected event cannot substitute another event's details. Reprints and reissues retain the existing permission and audit checks. Financial rows and the database schema are unchanged.

## Recommended optional information

Add the actual event date, venue and organizer contact number when those fields are available in event settings. The current Event model stores a name/code/status, so this design does not mistake the record creation date for the event date or invent a venue. Group/table information can be useful for assigned seating. Avoid printing a customer's phone number, identity document details, or a changing outstanding balance on a reusable pass.

## Preview and validation

- [Card preview](validation/final/registration-card-design-80mm.png)
- [80 × 120 mm printable PDF](validation/final/customer-qr-80mm.pdf)
- [Maximum-length event and customer PDF](validation/final/customer-qr-long-name-80mm.pdf)

Configure the printer for an 80 mm roll, 120 mm cut, 100% scale and no browser headers/footers. Browser acceptance verifies paper dimensions, one-page output, QR centering, text containment and QR decoding at 203 dpi. Physical printer/scanner commissioning remains an on-site check.

Final validation passes database/twelve migrations, lint, typecheck, 44 regression tests in 16 files, production build, formatting and all 42 production-server/browser checks. The longest supported event name (160 characters), event code (40) and customer name (120) fit together on one page without truncation. Print-mode QR center offsets are 0 px horizontally and 0.008 px vertically. Live development health also returns `ok`.

Acceptance found that automatic card height could grow and create a second page with maximum-length text. The customer card now has a fixed paper height and compact spacing/font rules for long values; the final PDF and containment checks pass. The earlier failure evidence is retained under `validation/registration-card`. No new migrations, password changes or data resets were needed.
