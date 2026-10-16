# Product photos and POS terminal

Products now has a file picker, preview, replace and remove controls instead of requiring a typed image path. Choose JPG, PNG or WebP files up to **20 MB**, then save the product to apply the photo. Smaller files are accepted. Existing product image paths still display and can be replaced through the uploader.

The server validates and decodes each upload, applies photo orientation, and creates a WebP up to 1600 pixels on either side. Uploaded images are stored in the existing database and included in PostgreSQL backups, so updates and restores retain them without a separate upload directory. Only users with product editing permission can upload. Image requests require signed-in product viewing access. The dedicated upload endpoint accepts the larger body while ordinary JSON operations retain their existing limits.

The POS uses the full screen for cashiers and Super Admin. A compact terminal header replaces the management sidebar, with a return-to-management button for Super Admin. Larger photo tiles, category tabs, search and product scanning sit beside a fixed cart with prominent totals and checkout. Desktop and tablet keep the cart visible; phone layouts stack the product browser and cart. Customer QR checkout, stock limits, server pricing and retry handling remain in the sales workflow.
