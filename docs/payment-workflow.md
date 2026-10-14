# Payment and PromptPay workflow

Select the OPEN event and PAYMENT station, then open your shift. Scan the same customer QR. Review all orders, item details, purchase times/stations and the exact unpaid sum. A settled account shows confirmed payments and receipt reprint controls instead of another payment button.

Generate PromptPay: the server sums RECORDED orders, creates/reuses one awaiting-confirmation payment per account, and generates the QR locally. No manual amount is accepted. Pending settlement locks new orders. QR creation does not change account status to settled.

Verify the recipient, exact amount, transfer time and bank evidence. Enter the unique bank reference and verification notes, check the evidence checkbox, and confirm. One serializable transaction marks the payment CONFIRMED, creates exact allocations, marks included orders PAID, settles the account, snapshots the receipt and writes its audit. A retry uses the same request key; repeated confirmation returns the existing receipt.

Receipt printing uses a 58 mm CSS layout. The server audits each requested print and labels every request after the first COPY. Browser APIs cannot prove paper physically printed: `printCount` records issued print attempts. Printer failure never reverses settlement. Use a reprint rather than accepting money again.

PromptPay PHONE/TAX_ID/EWALLET settings are visible/editable only to SUPER_ADMIN. No recipient is seeded in production. The payload uses dynamic initiation, PromptPay merchant template, THB, exact integer-derived decimal amount and CRC16/CCITT-FALSE. Sources: [Bank of Thailand QR standard](https://www.bot.or.th/content/dam/bot/documents/th/our-roles/payment-systems/about-payment-systems/ThaiQRCode_Payment_Standard.pdf), [reference implementation](https://github.com/dtinth/promptpay-qr). This is manual verification, not a banking API or automated proof of transfer. Live recipient acceptance must be tested with the institution's bank before launch.
