# VSNY Squarespace Gallery Manual

This is the live manual for the VSNY photo gallery pipeline.

## 1) End User Guide (Simple)

If you are only uploading albums, this is all you need.

### Where to upload
Upload albums to the Google Drive parent folder used by this project.

### Folder format (important)
Use this structure in Google Drive:

`Year/Album Name - Mon YYYY/photo files`

Examples:
- `2026/Kalpataru Day Celebration - Jan 2026/001.jpg`
- `2025/Book Launch - Apr 2025/001.jpg`
- `Featured/Omega Institute - May 2025/001.jpg`

### Naming rules
- Top-level folder should be either a 4-digit year (`2026`, `2025`, etc.) or `Featured`.
- Album folder name becomes the album title on the website.
- Use one album per folder.
- Keep image files inside album folders only (no nested subfolders).

### What happens after upload
1. GitHub Actions runs every 30 minutes and syncs Drive to Cloudflare R2.
2. Index JSON is rebuilt.
3. Squarespace gallery reflects updates automatically.

No one needs to keep a computer on.

---

## 2) How The System Works (Lay Terms)

Think of this as 4 connected services:

1. Google Drive = where staff uploads photos
2. Cloudflare R2 = where website images are stored/served
3. Cloudflare Worker = creates `index.json` from folders/images in R2
4. Squarespace = displays gallery UI using the JSON and image URLs

GitHub Actions is the automation bridge that copies from Drive to R2 on a schedule.

---

## 3) Accounts and Tools Involved

### Google
- Google Drive account with album folder
- Google Cloud project (service account + Drive API) used for automated read access

### GitHub
- Repo: `git@github.com:VedantaDC/squarespace-gallery.git`
- Workflow: `.github/workflows/drive-to-r2-sync.yml`
- Script used by workflow: `scripts/sync-drive-to-r2.sh`

### Cloudflare
- Cloudflare account ID: `bf51ca4ec1361db1897841cee70024ec`
- R2 bucket: `vedantany-photo-albums`
- Public R2 base URL: `https://pub-e898c4c7f2e84529af712017fe35dcf5.r2.dev`
- Worker name: `vsny-gallery-index`
- Worker URL: `https://vsny-gallery-index.falling-surf-045f.workers.dev`
- Worker source: `src/index.js`
- Queue consumer: `r2-photo-events`
- Pages project/domain (embed assets): `https://vsny-gallery-embed.pages.dev` (project: `vsny-gallery-embed`)

### Squarespace
- Uses embed block that loads:
  - `https://vsny-gallery-embed.pages.dev/gallery-embed.css`
  - `https://vsny-gallery-embed.pages.dev/gallery-embed.js`
- Gallery JSON URL should point to:
  - `https://vsny-gallery-index.falling-surf-045f.workers.dev/index.json`

### Google Drive
- Drive root folder ID used in setup: `1p-E89gZccRoF6memCNhYM1XOyzdhxtB6`
- This folder ID should match GitHub secret `DRIVE_FOLDER_ID`

---

## 4) Current Runtime Configuration (From Repo)

File: `wrangler.jsonc`

- Worker name: `vsny-gallery-index`
- Cron trigger: `0 */6 * * *` (every 6 hours)
- Bucket binding:
  - `PHOTOS_BUCKET -> vedantany-photo-albums`
- Public base URL:
  - `PUBLIC_BASE_URL=https://pub-e898c4c7f2e84529af712017fe35dcf5.r2.dev`
- Build cooldown:
  - `BUILD_COOLDOWN_SECONDS=90`

Note: Primary frequent sync is handled by GitHub Actions every 30 minutes.

---

## 5) GitHub Secrets Required

These must exist in GitHub repo secrets for automation:

- `RCLONE_DRIVE_SERVICE_ACCOUNT_JSON_B64`
- `DRIVE_FOLDER_ID`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `REBUILD_URL`
- `REBUILD_TOKEN`

Security note:
- Do not put secret values in this repo.
- Keep keys only in GitHub Secrets / Cloudflare secrets.

---

## 6) Featured Ordering Behavior

- `Featured` is shown as the top carousel.
- Featured albums follow folder-name order (same behavior as before chronological sorting was added).
- Regular year folders keep normal year grouping.

Recommended naming if you want manual ordering control:
- Prefix album names with numbers, for example:
  - `01 - Kalpataru Day Celebration`
  - `02 - Book Launch`
  - `03 - Omega Institute`

You can keep date-style names if preferred, but ordering will follow folder names.

---

## 7) If Something Breaks: Quick Troubleshooting

### A) New album not appearing
1. Confirm folder is in correct Drive format (`Year/Album/...`).
2. Confirm GitHub workflow succeeded:
   - GitHub -> Actions -> `Drive to R2 Sync`
3. Confirm files exist in R2 bucket.
4. Rebuild index manually:
   - `POST /rebuild` with Bearer token
5. Hard refresh Squarespace page.

### B) Images appear but wrong order
- Check folder/album naming format.
- For `Featured`, rename folder names to control display order (for example `01 - ...`, `02 - ...`).

### C) `401 unauthorized` on rebuild
- `REBUILD_TOKEN` is set on Worker side.
- Call must include header:
  - `Authorization: Bearer <REBUILD_TOKEN>`

### D) Worker JSON endpoint fails
- Open `https://vsny-gallery-index.falling-surf-045f.workers.dev/health`
- If not healthy, redeploy Worker:
  - `npx wrangler deploy`

### E) Squarespace UI looks old
- Confirm it is loading from `vsny-gallery-embed.pages.dev` URLs.
- Hard refresh browser/Squarespace preview.
- Redeploy pages assets if needed:
  - `npx wrangler pages deploy pages --project-name vsny-gallery-embed`

---

## 8) Operational Commands (Admin)

From project root:

Deploy Worker:
```bash
npx wrangler deploy
```

Deploy Pages assets:
```bash
npx wrangler pages deploy pages --project-name vsny-gallery-embed
```

Trigger manual rebuild:
```bash
curl -X POST "https://vsny-gallery-index.falling-surf-045f.workers.dev/rebuild" \\
  -H "Authorization: Bearer <REBUILD_TOKEN>"
```

Run sync workflow manually:
- GitHub -> Actions -> `Drive to R2 Sync` -> `Run workflow`

---

## 9) Important Project Files

- `src/index.js` -> Worker index builder and API
- `pages/gallery-embed.js` -> Gallery frontend behavior
- `pages/gallery-embed.css` -> Gallery styling
- `scripts/sync-drive-to-r2.sh` -> Drive to R2 sync script
- `.github/workflows/drive-to-r2-sync.yml` -> Scheduled automation
- `wrangler.jsonc` -> Worker/R2/queue config
