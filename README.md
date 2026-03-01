# Squarespace Gallery: Google Drive -> Cloudflare R2 -> Squarespace

This project gives you a cloud-only photo pipeline:

1. Upload albums to Google Drive.
2. GitHub Actions syncs Drive to Cloudflare R2 every 30 minutes.
3. Cloudflare Worker rebuilds `index.json`.
4. Squarespace loads gallery UI from Cloudflare Pages and data from the Worker.

No Mac is required after setup.

## Architecture

- Upload source: `Google Drive`
- Storage + delivery: `Cloudflare R2`
- JSON index generator: `Cloudflare Worker` (`src/index.js`)
- Scheduler/sync runner: `GitHub Actions` (`.github/workflows/drive-to-r2-sync.yml`)
- Frontend embed assets: `Cloudflare Pages` (`pages/`)
- Website host: `Squarespace`

## Expected Drive folder structure

Under one root folder in Drive:

`YYYY/Album Name/image-file.jpg`

Example:

`2026/Durga Puja - Oct/photo_001.jpg`

## 1) Deploy Worker (index builder)

Before deploy, update these placeholders in `wrangler.jsonc`:

- `name`
- `vars.PUBLIC_BASE_URL`
- `r2_buckets[0].bucket_name`

From this project folder:

```bash
npx wrangler login
npx wrangler deploy
```

Set a secret token for manual rebuild endpoint:

```bash
npx wrangler secret put REBUILD_TOKEN
```

Use a long random value.

### Queue + R2 event notifications

```bash
npx wrangler queues create r2-photo-events

npx wrangler r2 bucket notification create <your-r2-bucket-name> \
  --queue r2-photo-events \
  --event-type object-create \
  --event-type object-delete \
  --description "Auto rebuild index.json for Squarespace gallery"
```

### Worker endpoints

- `GET /health`
- `GET /index.json` (CORS enabled for browser fetch)
- `POST /rebuild` (requires `Authorization: Bearer <REBUILD_TOKEN>` if token is set)

## 2) Prepare Google Drive service account (one time)

1. In Google Cloud Console, create a project.
2. Enable Google Drive API.
3. Create a Service Account and JSON key.
4. Share your Drive root album folder with the Service Account email (Viewer is enough).
5. Copy the root folder ID from Drive URL.

Encode the JSON key to base64:

```bash
base64 -i service-account.json | pbcopy
```

(That copied value goes into GitHub secret `RCLONE_DRIVE_SERVICE_ACCOUNT_JSON_B64`.)

## 3) Push this repo to GitHub

Initialize and push if needed:

```bash
git init
git add .
git commit -m "Initial gallery pipeline"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 4) Configure GitHub Actions secrets

In GitHub repo -> Settings -> Secrets and variables -> Actions, add:

- `RCLONE_DRIVE_SERVICE_ACCOUNT_JSON_B64`
- `DRIVE_FOLDER_ID`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `REBUILD_URL` (example: `https://<worker-subdomain>.workers.dev/rebuild`)
- `REBUILD_TOKEN`

Then run workflow once manually:

- Actions -> `Drive to R2 Sync` -> `Run workflow`

After that it runs every 30 minutes.

## 5) Deploy Cloudflare Pages for gallery UI assets

Use Cloudflare Pages connected to this GitHub repo:

- Framework preset: `None`
- Build command: *(empty)*
- Build output directory: `pages`

This publishes:

- `https://<pages-domain>/gallery-embed.css`
- `https://<pages-domain>/gallery-embed.js`

## 6) Add embed snippet in Squarespace

Add a Code Block where gallery should appear:

```html
<link rel="stylesheet" href="https://<pages-domain>/gallery-embed.css" />
<div
  data-vs-gallery
  data-index-url="https://<worker-subdomain>.workers.dev/index.json"
></div>
<script src="https://<pages-domain>/gallery-embed.js" defer></script>
```

## Cost profile (small gallery, <1 GB)

Usually near $0 if usage stays low:

- Cloudflare R2 free tier covers your storage size.
- Cloudflare Worker/Pages typically stay in free allowance for this load.
- GitHub Actions free minutes are usually enough for periodic sync jobs.
- Google Drive remains your free upload source.

## Files in this repo

- `src/index.js`: Worker index builder + API endpoints
- `wrangler.jsonc`: Worker config (bucket/queue/cron)
- `scripts/sync-drive-to-r2.sh`: Sync script used by GitHub Actions
- `.github/workflows/drive-to-r2-sync.yml`: Scheduled cloud sync job
- `pages/gallery-embed.js`: Frontend gallery renderer
- `pages/gallery-embed.css`: Frontend styles
- `pages/index.html`: Demo page for quick testing
