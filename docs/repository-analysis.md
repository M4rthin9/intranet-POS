# Repository analysis

The supplied directory `F:\โปรแกรม POS ภายใน` was inspected including hidden files. It contained no files, Git metadata, package manifest, migrations, authentication, components, routes, configuration, or database credentials. There is no existing implementation or data to replace. The authoritative master prompt is preserved in `docs/master-specification.md`.

Decisions: Next.js App Router, TypeScript, PostgreSQL, Prisma 6.19 (explicit serializable transaction API), Zod, standard React forms, custom accessible tables/CSS, and SVG charts. Using native forms and lightweight charts avoids unnecessary frameworks. QR encoding is local using qrcode; no hosted QR service, external fonts, or bank verification dependency. Financial values are signed 32-bit integer satang, with bounded inputs and aggregate safe-integer checks. Full settlement only. Manual evidence verification is the initial authorized payment method.

The PostgreSQL 18 installation is reused only for its executable tools. An independent loopback-only cluster on port 55432 is created under ignored `.local/postgres`. No existing PostgreSQL service, databases, or credentials are modified. Production deployment is local/LAN; Sites cloud publication is outside the requested scope.
