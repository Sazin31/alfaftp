const SEARCH_HOSTS = [
  "https://i-api.aoneroom.com",
  "https://api6.aoneroom.com",
  "https://h5-api.aoneroom.com"
];

const MOBILE_HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "User-Agent": "com.community.moviebox/20250101 (Linux; Android 14; Pixel 8 Pro) okhttp/4.12.0",
  "X-Client-Info": '{"package_name":"com.community.moviebox","version_code":20250101,"platform":"android"}'
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: JSON.stringify(payload)
  };
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n || Number.isNaN(n)) return "";
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

function extractRawItems(data) {
  if (!data || typeof data !== "object") return [];
  const d = data.data || data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.items)) return d.items;
  if (Array.isArray(d.list)) return d.list;
  if (Array.isArray(d.rows)) return d.rows;
  if (Array.isArray(d.subjects)) return d.subjects;
  if (Array.isArray(d.searchResults)) return d.searchResults;
  return [];
}

function normalizeItem(entry) {
  const subj = entry && entry.subject ? entry.subject : entry || {};
  const id = subj.subjectId || subj.id || subj.detailPath || "";
  const title = subj.title || subj.name || subj.originTitle || "Untitled";
  const releaseDate = subj.releaseDate || subj.year || "";
  const yearMatch = String(releaseDate).match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : "";
  const subjectType = Number(subj.subjectType || 0);
  const mediaType =
    subjectType === 2 || /tv|series|season/i.test(String(subj.type || ""))
      ? "series"
      : "movie";
  const cover =
    (subj.cover && (subj.cover.url || subj.cover.picUrl)) ||
    subj.poster ||
    subj.image ||
    "";
  const rating = subj.imdbRatingValue || subj.rating || subj.score || "";

  return {
    id: String(id),
    subjectId: String(id),
    title: String(title),
    year,
    mediaType,
    poster: String(cover),
    rating: rating ? String(rating) : "",
    detailPath: subj.detailPath ? String(subj.detailPath) : "",
    source: "moviebox"
  };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      rawPreview: text.slice(0, 300)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function searchMovieBox(query) {
  const q = encodeURIComponent(query.trim());
  const attempts = [];

  for (const host of SEARCH_HOSTS) {
    const candidateUrls = [
      `${host}/wefeed-mobile-bff/subject-api/search?keyword=${q}&page=1&perPage=20`,
      `${host}/wefeed-h5api-bff/subject-api/search?keyword=${q}&page=1&perPage=20`
    ];

    for (const url of candidateUrls) {
      try {
        const result = await fetchJsonWithTimeout(url, {
          method: "GET",
          headers: MOBILE_HEADERS
        });
        const rawItems = extractRawItems(result.json);
        attempts.push({
          url,
          status: result.status,
          count: rawItems.length,
          message: result.json && result.json.message ? result.json.message : undefined
        });

        if (result.ok && rawItems.length > 0) {
          return {
            items: rawItems.map(normalizeItem).filter((x) => x.title),
            endpointUsed: url,
            attempts
          };
        }
      } catch (err) {
        attempts.push({
          url,
          error: err.name === "AbortError" ? "timeout" : err.message
        });
      }
    }
  }

  return {
    items: [],
    endpointUsed: null,
    attempts
  };
}

async function getStreams(subjectId, season = 0, episode = 0) {
  const sid = encodeURIComponent(String(subjectId || ""));
  const attempts = [];

  for (const host of SEARCH_HOSTS) {
    const candidateUrls = [
      `${host}/wefeed-mobile-bff/subject-api/resource-position/v2?subjectId=${sid}&se=${Number(season) || 0}&ep=${Number(episode) || 0}`,
      `${host}/wefeed-mobile-bff/subject-api/play-info?subjectId=${sid}&se=${Number(season) || 0}&ep=${Number(episode) || 0}`,
      `${host}/wefeed-h5api-bff/subject-api/play-info?subjectId=${sid}&se=${Number(season) || 0}&ep=${Number(episode) || 0}`
    ];

    for (const url of candidateUrls) {
      try {
        const result = await fetchJsonWithTimeout(url, {
          method: "GET",
          headers: MOBILE_HEADERS
        });
        const data = result.json && (result.json.data || result.json);
        const rawList =
          (data && (Array.isArray(data.streams) ? data.streams : Array.isArray(data.list) ? data.list : Array.isArray(data.downloads) ? data.downloads : Array.isArray(data.resources) ? data.resources : null)) ||
          [];

        attempts.push({
          url,
          status: result.status,
          count: rawList.length
        });

        if (result.ok && rawList.length > 0) {
          const streams = rawList
            .map((s, idx) => ({
              id: s.id || `${sid}-${idx}`,
              quality: s.resolution || s.quality || s.definition || "Auto",
              url: s.url || s.playUrl || s.downloadUrl || s.videoUrl || "",
              size: formatBytes(s.size || s.fileSize || 0),
              format: s.format || "mp4"
            }))
            .filter((s) => s.url);

          if (streams.length > 0) {
            return { streams, endpointUsed: url, attempts };
          }
        }
      } catch (err) {
        attempts.push({
          url,
          error: err.name === "AbortError" ? "timeout" : err.message
        });
      }
    }
  }

  return { streams: [], endpointUsed: null, attempts };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  const params = event.queryStringParameters || {};
  const action = (params.action || "search").toLowerCase();

  try {
    if (action === "streams" || action === "stream") {
      const subjectId = params.subjectId || params.id || "";
      if (!subjectId) {
        return jsonResponse(400, { error: "Missing subjectId parameter", streams: [] });
      }
      const data = await getStreams(subjectId, params.se || params.season || 0, params.ep || params.episode || 0);
      return jsonResponse(200, data);
    }

    const q = (params.q || params.keyword || params.query || "").trim();
    if (!q) {
      return jsonResponse(400, { error: "Missing q parameter", items: [] });
    }

    const data = await searchMovieBox(q);
    return jsonResponse(200, data);
  } catch (err) {
    return jsonResponse(500, {
      error: err.message || "Internal MovieBox function error",
      items: [],
      streams: []
    });
  }
}
