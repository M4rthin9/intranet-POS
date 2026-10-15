# Customer cards and product tags

Registration supports Normal and VIP customers. Existing registrations start as Normal. Choose the card type when registering or editing a customer. Both types use the existing customer account and QR credential; VIP export does not create another account, charge, or QR credential.

Registration, POS customer lookup and the payment workspace display the customer's current Normal/VIP type. Changing the type preserves the account, QR and transaction history. The registration type filter runs on the server before the 200-row result limit, and combines with name/registration-number search. Changing events clears the registration form, history and card selection. VIP downloads are disabled for customers without an available credential or with a blocked, cancelled or expired account.

## Registration and VIP exports

Super Admin and Registration Cashier can issue VIP cards from Registration:

1. Register a VIP customer, or edit an existing customer and choose VIP.
2. The existing **Print QR** action still prints the normal QR card.
3. The separate VIP download control offers an individual **PDF**, **PNG**, or **JPG** welcome card. Images are 1016 × 638 pixels with 300 DPI metadata, corresponding to 86 × 54 mm within pixel rounding.
4. To print multiple VIPs, tick their selection boxes or select the visible VIPs, then download **A4 PDF**. Up to 100 customers from the current event can be exported at once. Search/type filters determine which selected rows are included; the download button shows the included count.

A4 PDFs contain ten cards per full page, in two columns and five rows. Every card is exactly **86 × 54 mm**, with 3 mm gaps and crop marks outside the artwork. Partial pages retain the same positions and sizes. Print on A4 at **Actual size / 100%** and disable “Fit to page”. Individual PDFs have an 86 × 54 mm page. Image printing software must respect the 300 DPI metadata or use a manually specified 86 × 54 mm size.

The original welcome artwork is preserved with its aspect ratio, centered on the card. The customer's current QR replaces the bottom-right placeholder. A blocked or revoked credential cannot be exported. Reissuing a QR invalidates previously downloaded cards; download and print the replacement card after reissue.

## Product tags and checkout

Super Admin opens the **Print product tags / พิมพ์ป้ายสินค้า** menu (`/product-tags`), then **Choose products and print**. The existing shortcut under **Products** also remains available. Search by product name or SKU, select active products, choose copies and choose **Barcode + QR**, **Barcode (Code 128)** or **QR**, then preview or print/save PDF. Tags are 90 × 60 mm on A4, with the current price, name and SKU. Up to 60 products and 120 total labels can be generated at once. Reprint tags after changing prices.

At POS, focus the product scan field, scan either symbol with a scanner configured to send Enter, or type the SKU and press Enter. Each scan adds one unit subject to the existing quantity and stock checks. Product tiles remain available for manual selection. Customer QR cards are scanned at checkout, separately from product tags. A QR-capable scanner is required to scan QR codes; a linear barcode scanner can read the Code 128 symbol.

Product symbols identify the product only; checkout uses server-side prices. Welcome cards use the existing customer credential and can be scanned at the existing POS/payment registration points.

The sample files under `docs/validation/vip-*preview.*` contain synthetic, non-customer QR data and are for layout review only.
