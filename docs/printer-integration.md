# Scanner and printer integration

USB QR scanners use HID keyboard mode. Configure the scanner to send the exact opaque token plus Enter; do not prefix URLs or append balances. POS checkout and payment screens autofocus scanner input. Touch checkout buttons and quantity controls preserve the current cart until confirmation. Manual token entry is also possible on controlled stations.

Receipts are persistent server snapshots. Receipt print requests are audited; every request after the first is marked `สำเนา / COPY`. The print UI uses 58 mm page styling with 54 mm content, local fonts and a plain high-contrast layout. Configure the operating-system/iMin printer driver for 58 mm roll paper, correct margins and no browser headers/footers. Browser printing uses the installed driver; direct ESC/POS, silent kiosk printing and USB device probing require a separately configured local print agent and are outside this release.

The application catches print API failures, displays an operator error and retains the settled state. A browser print dialog cannot certify paper delivery or distinguish cancel from physical success; printCount means issued attempts. Check actual paper output and use COPY if necessary. Printer failure must never trigger another customer payment.

Reports use A4 browser print/Save as PDF. Automated acceptance generated both a report PDF and 58 mm receipt PDF and simulated a printer failure; physical Windows/iMin printers and USB scanner suffix/character delivery require on-site acceptance.
