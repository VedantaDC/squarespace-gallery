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

const MONTH_TOKEN_TO_INDEX = new Map([
  ["jan", 0],
  ["january", 0],
  ["feb", 1],
  ["february", 1],
  ["mar", 2],
  ["march", 2],
  ["apr", 3],
  ["april", 3],
  ["may", 4],
  ["jun", 5],
  ["june", 5],
  ["jul", 6],
  ["july", 6],
  ["aug", 7],
  ["august", 7],
  ["sep", 8],
  ["sept", 8],
  ["september", 8],
  ["oct", 9],
  ["october", 9],
  ["nov", 10],
  ["november", 10],
  ["dec", 11],
  ["december", 11],
]);

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

function isFeaturedGroup(value) {
  return value.trim().toLowerCase() === "featured";
}

function sortYearsDesc(a, b) {
  const af = isFeaturedGroup(a.year);
  const bf = isFeaturedGroup(b.year);
  if (af && !bf) return -1;
  if (!af && bf) return 1;

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

function monthFromToken(token) {
  return MONTH_TOKEN_TO_INDEX.has(token) ? MONTH_TOKEN_TO_INDEX.get(token) : null;
}

function yearFromToken(token) {
  if (!/^(19|20)\d{2}$/.test(token)) return null;
  return Number(token);
}

function monthFromNumericToken(token) {
  if (!/^\d{1,2}$/.test(token)) return null;
  const n = Number(token);
  if (n < 1 || n > 12) return null;
  return n - 1;
}

function tokenizeAlbumName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function parseAlbumDateFromName(name, fallbackYear) {
  const tokens = tokenizeAlbumName(name);
  if (tokens.length === 0) return null;

  const yearPositions = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const y = yearFromToken(tokens[i]);
    if (y !== null) yearPositions.push({ i, year: y });
  }

  for (const { i, year } of yearPositions) {
    for (let d = 1; d <= 2; d += 1) {
      const left = tokens[i - d];
      const right = tokens[i + d];
      const leftMonth = left ? monthFromToken(left) : null;
      if (leftMonth !== null) return { year, month: leftMonth };
      const rightMonth = right ? monthFromToken(right) : null;
      if (rightMonth !== null) return { year, month: rightMonth };
    }
  }

  for (const { i, year } of yearPositions) {
    const left = tokens[i - 1];
    const right = tokens[i + 1];
    const leftMonth = left ? monthFromNumericToken(left) : null;
    if (leftMonth !== null) return { year, month: leftMonth };
    const rightMonth = right ? monthFromNumericToken(right) : null;
    if (rightMonth !== null) return { year, month: rightMonth };
  }

  let fallbackMonth = null;
  for (const token of tokens) {
    const month = monthFromToken(token);
    if (month !== null) {
      fallbackMonth = month;
      break;
    }
  }

  if (fallbackYear !== null && fallbackMonth !== null) {
    return { year: fallbackYear, month: fallbackMonth };
  }
  if (fallbackYear !== null) {
    return { year: fallbackYear, month: -1 };
  }

  return null;
}

function albumChronoKey(albumName, yearLabel) {
  const fallbackYear = numericYearOrNull(yearLabel);
  const parsed = parseAlbumDateFromName(albumName, fallbackYear);
  if (!parsed) return Number.NEGATIVE_INFINITY;
  return parsed.year * 12 + parsed.month;
}

function sortAlbumsChronologicalDesc(a, b, yearLabel) {
  const ak = albumChronoKey(a.name, yearLabel);
  const bk = albumChronoKey(b.name, yearLabel);
  if (ak !== bk) return bk - ak;
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
    albums.sort((a, b) => sortAlbumsChronologicalDesc(a, b, year));
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
