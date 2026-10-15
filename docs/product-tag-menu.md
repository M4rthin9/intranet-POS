# Product tag printing menu

Super Admin can open **พิมพ์ป้ายสินค้า / Product tags** directly from the main menu at `/product-tags`. This page does not require an event selection. The existing Products shortcut also opens the same printer.

Choose products and print, search by name or SKU, select products, set copies per product and choose Barcode + QR, Barcode (Code 128), or QR. Preview the labels, then print or save PDF using A4 at 100%. Labels are 90 × 60 mm and contain the current product name, SKU and price. Each run supports up to 60 products and 120 labels, with up to ten copies per product.

Cashiers focus the product scan field in POS. Scan either printed symbol using a scanner that sends Enter, or type the SKU and press Enter. Each scan adds one unit, with existing stock and quantity limits. Both symbols identify the same product; checkout uses the server's current price. Customer account cards use the separate checkout QR field.

The menu and route retain the existing Super Admin printing restriction. Other roles can continue using their existing POS permissions to scan products.

Release checks cover formatting, ESLint, TypeScript, product tag generation and role permissions. The production updater builds the selected GitHub revision before replacing the app, verifies a database backup and waits for application health. No additional database migration is required for this menu update; the VIP registration migration is included for installations that have not received it yet.
