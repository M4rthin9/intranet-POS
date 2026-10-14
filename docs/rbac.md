# Role and permission matrix

| Operation                                       | SUPER_ADMIN | ADMIN             | CASHIER  | PAYMENT_CASHIER |
| ----------------------------------------------- | ----------- | ----------------- | -------- | --------------- |
| Registration and customer QR                    | Yes         | Yes               | No       | No              |
| Product read and order entry                    | Yes         | No                | Yes      | No              |
| Account lookup and outstanding                  | Yes         | Registration view | Checkout | Yes             |
| Own order history                               | Yes         | No                | Yes      | No              |
| Payment generation, confirmation, receipt       | Yes         | No                | No       | Yes             |
| Order/payment void, account reopening           | Yes         | No                | No       | No              |
| Products, categories, settings, users, stations | Yes         | No                | No       | No              |
| Reports, dashboard, exports, audit, backup      | Yes         | No                | No       | No              |
| Own shift open/close, event/station selection   | Yes         | Yes               | Yes      | Yes             |

The four roles are fixed. Database Role/Permission/RolePermission records describe grants; `src/lib/rbac.ts` is the authoritative immutable policy. There is deliberately no UI for extending operational roles or escalating grants. Every sensitive server service checks the policy. Password hashes and session tokens are never returned by list endpoints.
