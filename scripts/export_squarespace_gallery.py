#!/usr/bin/env python3
"""Export images from a Squarespace gallery landing page.

Workflow:
1. Fetch the main gallery page.
2. Find album URLs from "View Gallery" links.
3. Fetch each album page and extract image URLs.
4. Download images into: <output>/<year>/<album_name>/.
5. Write a manifest JSON with counts and source URLs.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, List, Tuple


USER_AGENT = "Mozilla/5.0 (compatible; SquarespaceGalleryExporter/1.0)"
DEFAULT_GALLERY_URL = "https://www.vedantany.org/gallery"
IMAGE_URL_RE = re.compile(
    r'data-image="(https://images\.squarespace-cdn\.com/[^"]+)"', re.IGNORECASE
)
VIEW_GALLERY_LINK_RE = re.compile(
    r'<a\s+href="([^"]+)"[^>]*>\s*(?:<u>)?\s*View Gallery\s*(?:</u>)?\s*</a>',
    re.IGNORECASE,
)
OG_TITLE_RE = re.compile(
    r'<meta\s+property="og:title"\s+content="([^"]+)"', re.IGNORECASE
)
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def fetch_text(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def safe_name(value: str) -> str:
    value = value.strip()
    value = re.sub(r"[\\/:*?\"<>|]+", "-", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" .") or "untitled"


def cleanup_title(raw: str) -> str:
    text = html.unescape(raw)
    # Squarespace titles commonly use "Album Name — Site Name".
    if " — " in text:
        text = text.split(" — ", 1)[0]
    text = text.replace("&mdash;", "-")
    return text.strip()


def parse_year_and_album(title: str, album_url: str) -> Tuple[str, str]:
    year_match = YEAR_RE.search(title)
    year = year_match.group(0) if year_match else "Unknown Year"

    candidate = title
    if year_match:
        candidate = title[year_match.end() :].strip(" -_")
    if not candidate:
        slug = urllib.parse.urlparse(album_url).path.strip("/").split("/")[-1]
        candidate = slug

    candidate = candidate.replace("-", " ").replace("_", " ")
    candidate = re.sub(r"\s+", " ", candidate).strip()
    album = safe_name(candidate or "Untitled Album")
    return year, album


def extract_album_links(gallery_html: str, base_url: str) -> List[str]:
    links = []
    for raw in VIEW_GALLERY_LINK_RE.findall(gallery_html):
        href = html.unescape(raw).strip()
        full = urllib.parse.urljoin(base_url, href)
        links.append(full)
    # Preserve order while de-duping.
    seen = set()
    unique = []
    for url in links:
        if url in seen:
            continue
        seen.add(url)
        unique.append(url)
    return unique


def extract_title(page_html: str) -> str:
    og = OG_TITLE_RE.search(page_html)
    if og:
        return cleanup_title(og.group(1))
    t = TITLE_RE.search(page_html)
    if t:
        return cleanup_title(t.group(1))
    return "Untitled Album"


def extract_image_urls(page_html: str) -> List[str]:
    urls = []
    seen = set()
    for raw in IMAGE_URL_RE.findall(page_html):
        url = html.unescape(raw)
        # Keep original image path, strip width-format query noise if present.
        parsed = urllib.parse.urlsplit(url)
        normalized = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        if normalized in seen:
            continue
        seen.add(normalized)
        urls.append(normalized)
    return urls


def download_file(url: str, output_path: Path, timeout: int = 60, retries: int = 3) -> bool:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(output_path.suffix + ".part")

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            with open(tmp_path, "wb") as fh:
                fh.write(data)
            os.replace(tmp_path, output_path)
            return True
        except Exception:
            if attempt == retries:
                if tmp_path.exists():
                    tmp_path.unlink(missing_ok=True)
                return False
            time.sleep(0.75 * attempt)
    return False


def build_image_path(album_dir: Path, index: int, image_url: str) -> Path:
    name = urllib.parse.unquote(Path(urllib.parse.urlsplit(image_url).path).name)
    name = safe_name(name)
    return album_dir / f"{index:04d}_{name}"


def process_album(album_url: str, output_root: Path, dry_run: bool) -> Dict:
    page_html = fetch_text(album_url)
    title = extract_title(page_html)
    year, album_name = parse_year_and_album(title, album_url)
    image_urls = extract_image_urls(page_html)
    album_dir = output_root / year / album_name

    downloaded = 0
    failed = 0
    if not dry_run:
        album_dir.mkdir(parents=True, exist_ok=True)
        for i, img_url in enumerate(image_urls, start=1):
            output_path = build_image_path(album_dir, i, img_url)
            if output_path.exists():
                downloaded += 1
                continue
            ok = download_file(img_url, output_path)
            if ok:
                downloaded += 1
            else:
                failed += 1

    return {
        "album_url": album_url,
        "title": title,
        "year": year,
        "album_name": album_name,
        "image_count": len(image_urls),
        "downloaded_count": downloaded,
        "failed_count": failed,
        "images": image_urls if dry_run else None,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export Squarespace gallery images.")
    parser.add_argument(
        "--gallery-url",
        default=DEFAULT_GALLERY_URL,
        help=f"Gallery landing URL (default: {DEFAULT_GALLERY_URL})",
    )
    parser.add_argument(
        "--output-dir",
        default="exports/squarespace-gallery",
        help="Output folder for downloaded images and manifest.",
    )
    parser.add_argument(
        "--limit-albums",
        type=int,
        default=0,
        help="Optional limit for album pages (0 means no limit).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only discover links/images and write manifest. Do not download files.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_root = Path(args.output_dir).resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    print(f"Fetching gallery page: {args.gallery_url}")
    gallery_html = fetch_text(args.gallery_url)
    album_urls = extract_album_links(gallery_html, args.gallery_url)
    if args.limit_albums > 0:
        album_urls = album_urls[: args.limit_albums]

    print(f"Discovered {len(album_urls)} album URLs.")
    if not album_urls:
        print("No album links found. Exiting.", file=sys.stderr)
        return 1

    results = []
    for i, album_url in enumerate(album_urls, start=1):
        print(f"[{i}/{len(album_urls)}] Processing {album_url}")
        try:
            info = process_album(album_url, output_root, args.dry_run)
        except Exception as exc:
            info = {
                "album_url": album_url,
                "error": str(exc),
                "image_count": 0,
                "downloaded_count": 0,
                "failed_count": 0,
            }
        results.append(info)

    total_images = sum(r.get("image_count", 0) for r in results)
    total_downloaded = sum(r.get("downloaded_count", 0) for r in results)
    total_failed = sum(r.get("failed_count", 0) for r in results)
    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "gallery_url": args.gallery_url,
        "album_count": len(results),
        "total_images": total_images,
        "total_downloaded": total_downloaded,
        "total_failed": total_failed,
        "dry_run": args.dry_run,
        "albums": results,
    }

    manifest_path = output_root / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)

    print(f"\nDone. Manifest written to: {manifest_path}")
    print(
        f"Albums: {len(results)} | Images discovered: {total_images} | "
        f"Downloaded: {total_downloaded} | Failed: {total_failed}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
