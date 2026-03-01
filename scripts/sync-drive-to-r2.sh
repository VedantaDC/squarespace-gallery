#!/usr/bin/env bash
set -euo pipefail

required_env=(
  RCLONE_DRIVE_SERVICE_ACCOUNT_JSON_B64
  DRIVE_FOLDER_ID
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone is not installed" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

sa_json_path="$tmpdir/drive-sa.json"
config_path="$tmpdir/rclone.conf"

printf '%s' "$RCLONE_DRIVE_SERVICE_ACCOUNT_JSON_B64" | base64 --decode > "$sa_json_path"

cat > "$config_path" <<RCLONECONF
[drive]
type = drive
scope = drive.readonly
service_account_file = ${sa_json_path}
root_folder_id = ${DRIVE_FOLDER_ID}

[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
RCLONECONF

echo "Syncing Google Drive folder ${DRIVE_FOLDER_ID} -> R2 bucket ${R2_BUCKET}"
rclone sync "drive:" "r2:${R2_BUCKET}" \
  --config "$config_path" \
  --drive-skip-gdocs \
  --fast-list \
  --transfers 8 \
  --checkers 16 \
  --delete-empty-src-dirs \
  --exclude "**/.DS_Store" \
  --exclude "**/Thumbs.db"

if [[ -n "${REBUILD_URL:-}" ]]; then
  echo "Triggering index rebuild endpoint"

  auth_header=()
  if [[ -n "${REBUILD_TOKEN:-}" ]]; then
    auth_header=(-H "Authorization: Bearer ${REBUILD_TOKEN}")
  fi

  curl --fail --silent --show-error \
    -X POST \
    "${auth_header[@]}" \
    "$REBUILD_URL" >/dev/null
fi

echo "Sync complete"
