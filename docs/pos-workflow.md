# Fast POS workflow

Select an OPEN event and POS station, then open your shift. Choose products using large touch buttons, categories, favorites or code/name search. Adjust quantity with +/−; reducing to zero removes a line.

Checkout opens the scanner field with automatic focus. A USB HID QR scanner should send the opaque token and Enter. Review customer identity, existing outstanding, new order and account total, then confirm. The server independently retrieves current prices and records snapshots. Cashiers receive no money.

If prices changed, refresh/review the cart before retrying. If a response is lost, retry the same intent; a persistent idempotency record returns the same order. New orders are rejected when settlement is in progress, the QR is invalid/revoked/blocked/settled, the event is closed, the station is incompatible, the shift is missing, or tracked stock is insufficient.
