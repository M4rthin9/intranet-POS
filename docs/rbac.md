# Role and permission matrix

Five roles are supported after the user requested REGISTRATION_CASHIER in addition to the original four. Existing users retain their roles. Cashier page navigation and server route guards allow only each role's work page. See [role page changes](role-pages-report.md).

Super Admin assigns an event to each active staff account. Staff have read-only event labels and automatic accounting sessions, with no shift controls; Admin no longer has the Shifts page. Server checks scope staff operations, event data, historical reprints and Admin dashboards to that assignment. See [event assignment controls](user-event-assignment.md). Legacy own-shift API permissions remain for compatibility; Super Admin controls reconciliation and reassignment in the UI.

Cashier Register lands directly on `/register` with no sidebar or navigation menu. Its header retains sign-out, and its work controls remain on the registration page. Dashboard and other work routes remain denied by the server. See [registration-only layout](registration-only-page.md).

| Operation                                              | SUPER_ADMIN | ADMIN             | CASHIER (POS) | REGISTRATION_CASHIER | PAYMENT_CASHIER |
| ------------------------------------------------------ | ----------- | ----------------- | ------------- | -------------------- | --------------- |
| Aggregate dashboard                                    | Yes         | Yes               | No            | No                   | No              |
| Event registration/editing/closing                     | Yes         | No                | No            | No                   | No              |
| Registration and customer QR                           | Yes         | Yes               | No            | Yes                  | No              |
| Product read and order entry                           | Yes         | No                | Yes           | No                   | No              |
| Account lookup                                         | Yes         | Registration view | Checkout      | Registration view    | Yes             |
| Own order history                                      | Yes         | No                | Yes           | No                   | No              |
| Payment generation, QR printing, confirmation, receipt | Yes         | No                | No            | No                   | Yes             |
| Order/payment void, account reopening                  | Yes         | No                | No            | No                   | No              |
| Products, categories, settings, user administration    | Yes         | No                | No            | No                   | No              |
| Detailed reports, exports, audit, backup               | Yes         | No                | No            | No                   | No              |
| Own shift open/close                                   | Yes         | Yes               | Yes           | Yes                  | Yes             |

Database Role/Permission/RolePermission records describe grants; `src/lib/rbac.ts` is the authoritative policy. There is no UI for creating arbitrary role types or escalating grants. User administration assigns one of the five supported roles. Every sensitive server service checks the policy. Password hashes and session tokens are never returned by list endpoints. Admin dashboard responses expose aggregates without the detailed customer debt list, and do not grant `report.view`.

Event selection is restored. Work pages select OPEN events and retain their event during an open shift. Dashboard/report selection supports historical events independently. Stations remain automatic. SUPER_ADMIN can register, sell and settle using any active station type, preserving legacy specialized shifts. Other roles require their matching station type or an ADMIN station. Financial commands require the actor's own open shift and an OPEN event; inactive stations are rejected. Barcode receipt reprints require their existing print/reprint permissions and a confirmed payment, including after event closing.
