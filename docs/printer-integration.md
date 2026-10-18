# Scanner and printer integration

USB QR scanners use HID keyboard mode. Configure the scanner to send the exact opaque token plus Enter; do not prefix URLs or append balances. POS checkout and payment screens autofocus scanner input. Touch checkout buttons and quantity controls preserve the current cart until confirmation. Manual token entry is also possible on controlled stations.

Configure the scanner keyboard country and the Windows/iMin input method for English ASCII during scans. A Thai keyboard layout can change HID keystrokes; verify exact token characters and the Enter suffix on site.

Paid receipts follow the supplied reference, without a REPRINT title or queue number. The footer information QR is configured in Settings and rendered locally; leave its value empty to hide it. The bottom CODE128 barcode encodes the saved public receipt number. Enable CODE128 in the scanner and scan it with Enter in the main payment scanner or dedicated receipt barcode field to retrieve an audited COPY, including after event closing. See [receipt configuration and event report](event-receipt-followup.md).

Receipt branding uses the supplied organization logo instead of the placeholder C icon. Super Admin uploads/replaces it under Settings → โลโก้บนใบเสร็จ. The locally stored image fits centrally in a 36 × 24 mm box without distortion, and is decoded before printing. Original/COPY financial snapshots and QR/barcode behavior are unchanged. See [logo implementation and actual 80 mm preview](receipt-logo-report.md).

All original and COPY receipts use **80 mm paper**, with equal 4 mm margins and 72 mm content. Receipt height adapts to the rendered items and wrapping names. Receipts are persistent server snapshots; every server print request after the first is marked `สำเนา / COPY`. Configure the operating-system/iMin driver for 80 mm roll paper, actual size/100% scale, and no browser headers/footers. Browser printing uses the installed driver. Purchase slips and paid receipts request printing automatically after fonts and images are ready. Manual reprints remain audited copies.

## Automatic thermal printing on Windows

Install the thermal printer's Windows driver on each cashier PC, set its default paper to 80 mm roll and make it the Windows default printer. Turn off Windows' automatic default-printer management on cashier PCs to keep this destination selected. Install Google Chrome. Run the following from the repository, substituting the POS address used by that cashier:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/thermal-printing.ps1 -Install -PosUrl http://192.168.0.46:8081
```

Open **CCIDA POS - Automatic Printing** from the desktop and log in. This uses a separate Chrome profile with `--kiosk-printing` and the system default printer preference. Printing goes to the default Windows printer without another confirmation. Existing personal Chrome/Edge sessions are unaffected. Purchase slips print after sale confirmation; cash/PromptPay receipts print after payment confirmation. Use the same shortcut on subsequent days. Normal browser tabs continue to show their normal print dialog.

The launcher checks the Windows default before opening POS. Missing, known virtual (PDF/XPS/AnyDesk), and known offline printers are rejected with setup instructions. It does not choose another printer or change Windows defaults. Use `-Check` for diagnostics without opening the browser. After changing the default printer, close and reopen the cashier shortcut. The profile also disables browser print headers/footers. No browser policy, USB service or local network print agent is installed.

This workstation profile silently prints **all** print commands, including cards and reports. Print A4 reports/PDF from an ordinary browser window. The web app cannot identify the connected printer or confirm that paper was delivered; the driver/spooler handles disconnection or out-of-paper errors. Do not charge the customer again to recover a print failure. Physical paper output must be checked at the cashier PC.

The browser behavior follows Chromium's [kiosk printing implementation](https://chromium.googlesource.com/chromium/src.git/%2B/efe01e507637e822f481f1ce155d79d5333183ce%5E%21/) and [system default printer preference](https://chromium.googlesource.com/chromium/src/%2B/refs/heads/main/components/policy/resources/templates/policy_definitions/Printing/PrintPreviewUseSystemDefaultPrinter.yaml). Managed Edge installations can instead use Microsoft's [SilentPrintingEnabled policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/SilentPrintingEnabled); this setup uses a separate Chrome profile to keep normal browser sessions unchanged.

The application catches print API failures, displays an operator error and retains the settled state. A browser print dialog cannot certify paper delivery or distinguish cancel from physical success; printCount means issued attempts. Check actual paper output and use COPY if necessary. Printer failure must never trigger another customer payment.

Customer and PromptPay QR cards share an **80 mm × 120 mm** template, with equal 4 mm margins, 72 mm content and a 46 mm QR image centered horizontally and vertically. Choose a 120 mm cut length on the 80 mm roll, actual size/100% scale, and disable browser headers/footers. The preview matches this card size. The customer card identifies the registration; the PromptPay card identifies the payment, exact amount and original recipient. Names wrap without changing the QR payload or quiet zone. Reports use A4.

The customer card includes its own event name/code, card issue time in Thailand, customer name, registration number, numbered purchase/payment instructions and registration-desk help. Event details come from the registration relation, including when printing from another selected event. See the [registration card design and printable preview](registration-card-design.md). Event date/venue/contact can be added when those event fields are available.

The PromptPay payment card includes a locally served PromptPay logo, bilingual headings, a prominent ruled total, recipient and bank-app instructions. Fonts and both images are ready before printing. See the [PromptPay card design](promptpay-card-design.md).

Repeat Print in the same receipt dialog obtains a new server-issued receipt and commits COPY to the print DOM before invoking the print API. QR print button requests also use the server audit. Closing is disabled during an in-flight print request. Long receipt names wrap within the 72 mm content width. Print overlays render outside the hidden application container, so printed documents remain visible.

Use **พิมพ์ QR พร้อมเพย์** in the payment section or its pending-history row. Each preview/print request rechecks permissions, an open shift, active account, pending payment and unchanged balance. Confirmed or voided payments cannot be printed as pending QR. Printing does not settle the account or issue a receipt. A paper bank QR cannot be revoked remotely; operators must remove obsolete cards and check transfer evidence before confirmation.

Reports use A4 browser print/Save as PDF. Automated acceptance checks real PDF content, 80 mm widths, original/COPY receipts, both QR layouts and maximum-length names, and simulates printer failures. Physical Windows/iMin printers and USB scanner suffix/character delivery require on-site acceptance. See the [QR and receipt printing report](qr-print-report.md).
