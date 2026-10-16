# POS purchase slips

After a purchase is recorded, POS opens an 80 mm purchase slip and the browser print dialog. Give this slip to the customer to keep and present at the payment counter. The slip includes the event, customer registration, order number, cashier/station, recorded time, item quantities, original prices and this purchase's total. It is clearly marked **not a payment receipt**. The confirmed payment receipt remains the payment counter's final receipt.

The payment counter accepts either the customer's registration QR or a purchase-slip QR in the existing scan field. A slip QR highlights its purchase and loads the customer's current outstanding balance across all purchases in the same event. Creating PromptPay and confirming payment use the same server-calculated settlement flow. The amount on one slip may be less than the full account balance.

The QR contains only the order ID and the customer's existing QR credential, never client-controlled prices or payment confirmation. Account status, event assignment, credential revocation, order ownership and cancellation are checked on the server. Voided or cleared purchases and revoked credentials cannot be used through a slip QR. Reissuing a customer QR invalidates old slips; an authorized cashier can reprint using the current credential.

Use **พิมพ์ใบรายการซื้อ** in POS recent sales to recover from a cancelled print dialog, network interruption or printer problem. Print preparation is separate from sale creation, so retrying a print does not add another order or change stock. Cashiers can print their own recorded/paid purchases; Super Admin can print across cashiers. Print attempts and reprints are audited.

The final line shows the customer's outstanding baht for this event across all POS stations at print time. It includes this purchase and other unpaid recorded purchases linked to the same account, excluding paid, voided and cleared sales. Reprinting refreshes this balance; after settlement it shows zero. The purchase's own total remains above the QR. Later purchases can increase the amount due at the end of the event.

Use 80 mm paper, actual size / 100% scaling and disable browser headers/footers. Paper height adjusts to the items. The QR is 38 mm with a four-module quiet zone. Browser printing still requires the configured printer and the operator's print-dialog confirmation.

No database migration is required.
