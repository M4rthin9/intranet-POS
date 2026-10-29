# Fresh POS on Render Free and Neon Free

This is a new cloud installation. No local database, accounts, products, customers, sales, settings or archive files are imported. The existing local POS is left untouched. The public app runs on Render and its new PostgreSQL database and private backup bucket live on Neon, so this PC is not required after setup.

## Provision

Connect Render and Neon through their ChatGPT integrations, or use your own provider dashboards. Create a new **Neon Free** project in **AWS Singapore**, with PostgreSQL **17**, an empty database, and a **private** Object Storage bucket named `ccida-pos-backups`. Use a dedicated project and bucket for this installation. The storage endpoint, region, access key and secret must come from that project; do not make the bucket public.

Copy `deploy/render/cloud.env.example` to the repository root as `.env.cloud`. This file is ignored by Git. Supply the new database owner's **direct/unpooled** TLS connection, a **new** administrator username and password, and the new private bucket configuration. Do not use local database credentials or paste secrets into chat.

Run:

```powershell
npm ci
npm run cloud:setup
```

Setup refuses to modify a populated destination or reuse an existing application role. It applies the schema migrations, creates exactly one new Super Admin and five empty stations, verifies there are no events/products/customers/transactions, and creates a separate restricted `ccida_app` database role. Generated runtime credentials are saved in a uniquely named private JSON file under `.local/credentials/`; owner and administrator passwords are excluded. If setup fails partway through, inspect the new database before retrying; it never resets or drops a database.

Create a Render Blueprint from this repository's `render.yaml`. It uses **Free** compute in Singapore and `deploy/render/Dockerfile`. Supply its environment variables from the generated private JSON file. Do not add the database owner URL or administrator password to Render. Set all backup variables, including the actual Neon Storage region (usually `ap-southeast-1` for Singapore).

The runtime derives the HTTPS origin from Render's `RENDER_EXTERNAL_URL`, enables Secure cookies, starts the web application and backup scheduler, and exposes the existing database-aware `/api/health` check. It does not seed, restore, reset, bootstrap or migrate databases at runtime. Automatic deployments are disabled so schema changes can be applied separately before a new release.

After deployment, sign in with the **new** administrator. Create events, cashier accounts, allowed categories and products; configure the real PromptPay recipient and receipt branding. Cashiers without assigned categories see no products. Verify a controlled sale, payment, receipt, private backup download, and backup retrieval after restarting the Render service.

Cloudflare can optionally manage a custom domain for this Render service. Keep `onrender.com` as the initial address; changing existing tunnel DNS is a separate step.

## Free-plan limits

Render Free sleeps after 15 minutes without inbound traffic; waking can take about a minute. Its filesystem is ephemeral. Uploaded product/receipt images already live in PostgreSQL. Backups now upload to private object storage before being registered as successful; after a restart, downloads and restores retrieve and checksum-check the archive. Existing local deployments keep their filesystem backup behavior.

The backup scheduler runs while the Render service is awake and resumes queued work when it wakes. An exact unattended hourly schedule is not guaranteed on free compute. No keep-alive traffic or paid worker is configured. Monitor database, object-storage, bandwidth and compute quotas; archives are not automatically deleted. Set provider spending limits and keep the project on the free tier.

Neon currently includes 1 GB of PostgreSQL storage and 5 GB of Object Storage per free project. Render's free service is suitable for trials and light use; it has no always-on availability guarantee for live event cashiers.

References: [Render Free](https://render.com/docs/free), [Render Blueprint](https://render.com/docs/blueprint-spec), [Neon pricing](https://neon.com/pricing), [Neon private object storage](https://neon.com/docs/storage/get-started).

## Validation

```powershell
npm run typecheck
npm run lint
npm test -- tests/cloud-deployment.test.ts
npm run build
```

These checks do not provision a provider account. Live deployment, a real Neon bootstrap, and an actual object-storage upload/download still require connected accounts. Docker image startup additionally needs Docker or a provider build runner.
