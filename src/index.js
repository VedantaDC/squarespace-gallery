const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
  ".avif",
]);

const INDEX_KEY = "index.json";
const META_KEY = "_meta/last-index-build.json";
const DEFAULT_COOLDOWN_SECONDS = 90;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};

function hasImageExtension(key) {
  const lower = key.toLowerCase();
  for (const ext of IMAGE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function encodeKeyForUrl(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function numericYearOrNull(value) {
  const m = /^(\d{4})$/.exec(value);
  return m ? Number(m[1]) : null;
}

function sortYearsDesc(a, b) {
  const ay = numericYearOrNull(a.year);
  const by = numericYearOrNull(b.year);
  if (ay !== null && by !== null) return by - ay;
  if (ay !== null) return -1;
  if (by !== null) return 1;
  return b.year.localeCompare(a.year);
}

function sortAlbumsByName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function sortImagesByName(a, b) {
  return a.name.localeCompare(b.name, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

async function getLastBuildEpochMs(bucket) {
  const obj = await bucket.get(META_KEY);
  if (!obj) return 0;
  try {
    const parsed = await obj.json();
    return Number(parsed.lastBuildEpochMs) || 0;
  } catch {
    return 0;
  }
}

async function setLastBuildEpochMs(bucket, epochMs) {
  await bucket.put(
    META_KEY,
    JSON.stringify({ lastBuildEpochMs: epochMs, updatedAt: new Date(epochMs).toISOString() }),
    {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    }
  );
}

async function listAllObjects(bucket) {
  let cursor;
  const keys = [];
  do {
    const page = await bucket.list({
      cursor,
      limit: 1000,
      include: [],
    });
    for (const object of page.objects) keys.push(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

function buildIndexFromKeys(keys, publicBaseUrl) {
  const base = stripTrailingSlash(publicBaseUrl);
  const yearsMap = new Map();

  for (const key of keys) {
    if (key === INDEX_KEY || key === META_KEY) continue;
    if (key.startsWith("_meta/")) continue;
    if (!hasImageExtension(key)) continue;

    const parts = key.split("/");
    if (parts.length < 3) continue;

    const [year, album, ...rest] = parts;
    const fileName = rest.join("/");
    if (!year || !album || !fileName) continue;

    let albumsMap = yearsMap.get(year);
    if (!albumsMap) {
      albumsMap = new Map();
      yearsMap.set(year, albumsMap);
    }

    let images = albumsMap.get(album);
    if (!images) {
      images = [];
      albumsMap.set(album, images);
    }

    images.push({
      name: fileName,
      key,
      url: `${base}/${encodeKeyForUrl(key)}`,
    });
  }

  const years = [];
  for (const [year, albumsMap] of yearsMap.entries()) {
    const albums = [];
    for (const [albumName, imagesRaw] of albumsMap.entries()) {
      const images = imagesRaw
        .map(({ name, url }) => ({ name, url }))
        .sort(sortImagesByName);
      if (images.length === 0) continue;
      albums.push({
        name: albumName,
        coverUrl: images[0].url,
        images,
      });
    }
    albums.sort(sortAlbumsByName);
    if (albums.length > 0) years.push({ year, albums });
  }

  years.sort(sortYearsDesc);

  return {
    updatedAt: new Date().toISOString(),
    years,
  };
}

async function rebuildIndex(env) {
  const keys = await listAllObjects(env.PHOTOS_BUCKET);
  const indexPayload = buildIndexFromKeys(keys, env.PUBLIC_BASE_URL);
  const body = JSON.stringify(indexPayload);

  await env.PHOTOS_BUCKET.put(INDEX_KEY, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });

  return {
    years: indexPayload.years.length,
    albums: indexPayload.years.reduce((sum, y) => sum + y.albums.length, 0),
    images: indexPayload.years.reduce(
      (sum, y) => sum + y.albums.reduce((inner, a) => inner + a.images.length, 0),
      0
    ),
  };
}

async function shouldRebuildNow(env) {
  const cooldown = Number(env.BUILD_COOLDOWN_SECONDS || DEFAULT_COOLDOWN_SECONDS);
  const now = Date.now();
  const last = await getLastBuildEpochMs(env.PHOTOS_BUCKET);
  if (now - last < cooldown * 1000) return false;
  await setLastBuildEpochMs(env.PHOTOS_BUCKET, now);
  return true;
}

function batchHasRelevantR2Change(batch) {
  for (const message of batch.messages) {
    const body =
      typeof message.body === "string"
        ? (() => {
            try {
              return JSON.parse(message.body);
            } catch {
              return {};
            }
          })()
        : message.body || {};

    const key = body?.object?.key || body?.key;
    if (!key) continue;
    if (key === INDEX_KEY || key === META_KEY) continue;
    if (key.startsWith("_meta/")) continue;
    if (hasImageExtension(key)) return true;
  }
  return false;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function isAuthorizedRebuildRequest(request, env) {
  const expected = env.REBUILD_TOKEN;
  if (!expected) return true;
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return false;
  const providedToken = authHeader.slice(7).trim();
  return providedToken === expected;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/index.json" && request.method === "GET") {
      const indexObject = await env.PHOTOS_BUCKET.get(INDEX_KEY);
      if (!indexObject) {
        return jsonResponse({ ok: false, error: "index_not_found" }, 404);
      }

      return new Response(indexObject.body, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=60",
          ...CORS_HEADERS,
        },
      });
    }

    if (url.pathname === "/rebuild" && request.method === "POST") {
      if (!isAuthorizedRebuildRequest(request, env)) {
        return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      }

      const summary = await rebuildIndex(env);
      return jsonResponse({ ok: true, mode: "manual", summary });
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(batch, env) {
    if (!batchHasRelevantR2Change(batch)) {
      return;
    }

    const rebuildAllowed = await shouldRebuildNow(env);
    if (!rebuildAllowed) {
      return;
    }

    await rebuildIndex(env);
  },

  async scheduled(controller, env) {
    // Safety net in case an event notification is delayed or missed.
    await rebuildIndex(env);
  },
};
