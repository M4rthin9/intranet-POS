# PromptPay payment card design

18 October 2026 · Asia/Bangkok.

The payment preview and printed card use the same 80 × 120 mm design, with 4 mm margins and a centered 46 mm QR. The header pairs CCIDA with the PromptPay logo, followed by a Thai payment heading, English subtitle, payment reference, customer name and registration number. A ruled total section emphasizes the exact amount in THB. The recipient and transfer instructions appear below it, including a reminder that this payment request is not a receipt.

The layout uses black text and rules on white paper for thermal printing. The original PromptPay logo retains its colors and aspect ratio; monochrome printers render it through their driver. The logo is served locally, and printing waits for fonts, the logo and the QR image to decode. Long names wrap without changing the QR or its quiet zone.

The image in `public/promptpay-logo.png` is the PromptPay wordmark by National ITMX, attributed to the Bank of Thailand on its [Wikimedia Commons source page](https://commons.wikimedia.org/wiki/File:PromptPay-logo.png). That page identifies it as a public-domain text logo; the PromptPay trademark remains with its owner.

Use the existing **พิมพ์ QR พร้อมเพย์** action in the payment screen. Print at 100% scale on 80 mm paper with a 120 mm cut and browser headers/footers disabled. The payment amount, recipient snapshot, QR payload, server authorization and audit checks remain unchanged.

Synthetic preview files are in `output/promptpay-design/`; the recipient and QR in these previews are sample data only.

Browser validation passed for standard, 120-character Latin customer/recipient names, and long Thai names: each PDF is one page, text stays inside the card without overlapping the QR, and the QR remains centered (0 px horizontal offset, 0.008 px vertical offset). Screenshots of the rendered QR decode to the original payload at 203 dpi. Focused ESLint, Prettier and diff-whitespace checks pass. The full TypeScript check is blocked by missing Next.js declarations and generated Prisma client exports in this checkout. Physical printer output still requires checking on the cashier printer.
