# Registration and customer QR

1. Administrator creates a DRAFT event and opens it.
2. Registration staff select event and REGISTRATION station, enter the required customer name, and save.
3. The server creates one registration/account and a random opaque QR token. Print the displayed card using the browser print dialog.
4. Search by customer name or registration number. Printing a replacement copy is audited. Reissuing requires a reason, revokes the old token and keeps the same account and orders.
5. Block suspicious/lost cards with a reason. A blocked account remains blocked after QR replacement; use the registration status editor and a reason to reactivate it after review.

Tokens contain no PII, balances, items or mutable financial information. Their raw values are exposed only to authorized registration staff for printing; payment/POS receive only scoped lookup results. Use HTTPS and protect printed cards because possession allows account identification at controlled stations.
