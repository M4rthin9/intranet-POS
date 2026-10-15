# Audit coverage matrix

| Domain           | Audited actions                                                     | Details                                                        |
| ---------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Authentication   | LOGIN, LOGOUT                                                       | actor and request context                                      |
| Event            | EVENT_CREATE, EVENT_OPEN, EVENT_UPDATE                              | state before/after                                             |
| Registration     | REGISTRATION_CREATE, REGISTRATION_UPDATE                            | identity/status, mandatory update reason                       |
| QR               | QR_CREATE, QR_REPRINT, QR_BLOCK, QR_REISSUE                         | credential IDs, reasons; raw token excluded                    |
| Catalog          | CATEGORY_CREATE/UPDATE, PRODUCT_CREATE/UPDATE/ARCHIVE, PRICE_CHANGE | complete product facts and price snapshots                     |
| Orders           | ORDER_CREATE, ORDER_VOID                                            | item snapshots, station, mandatory void reason                 |
| Payment          | PAYMENT_QR_GENERATE, PAYMENT_CONFIRM, PAYMENT_VOID, PAYMENT_REFUND  | amount/status/allocation IDs, evidence reference, reason       |
| Receipt          | RECEIPT_PRINT, RECEIPT_REPRINT                                      | issued print count and COPY tracking                           |
| Accounts         | ACCOUNT_REOPEN                                                      | state change and mandatory reason                              |
| Identity/station | USER_CREATE/UPDATE/DISABLE, STATION_CREATE/UPDATE                   | safe before/after; password hashes excluded                    |
| Settings         | SETTINGS_UPDATE                                                     | organization or non-sensitive PromptPay configuration metadata |
| Shifts           | SHIFT_OPEN                                                          | event, user, station, timestamps                               |

Additional implemented actions: LOGIN_FAILED, PASSWORD_HASH_UPGRADE (version metadata only), SHIFT_CLOSE, STOCK_OPEN, STOCK_ADJUST, EVENT_CLOSE, EVENT_ARCHIVE, REPORT_EXPORT, BACKUP_CREATE and RESTORE_EXECUTE. Audit and business changes are atomic. Sensitive settings exclude bank identifier values from audit. The append-only PostgreSQL trigger rejects direct UPDATE and DELETE and is tested against the actual database. QR print attempts and same-dialog receipt retries are audited; receipt retries show COPY.
