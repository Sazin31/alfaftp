const API_BASE = "https://h5-api.aoneroom.com/wefeed-h5api-bff";

const COMMON_HEADERS = {
  "Accept": "application/json",
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Referer": "https://moviebox.ph/",
  "Origin": "https://moviebox.ph",
};

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n || Number.isNaN(n)) return "";
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

export async function handler(event) {
  const params = event.queryStringParameters || {};
  const action = params.action || "search";

  try {
    if (action === "search") {
      const q = (params.q || "").trim();
      if (!q) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing ?q=" }) };
      }

      const res = await fetch(`${API_BASE}/subject/search`, {
        method: "POST",
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          keyword: q,
          page: 1,
          perPage: 15,
          subjectType: 0,
        }),
      });

      const json = await res.json();
      const rawItems = json?.data?.items || [];
      const items = rawItems.map((it) => ({
        subjectId: String(it.subjectId || ""),
        subjectType: it.subjectType || 1,
        title: it.title || it.name || "",
        releaseDate: it.releaseDate || "",
        imdbRatingValue: it.imdbRatingValue || "",
        description: it.description || "",
        detailPath: it.detailPath || "",
        cover: it.cover?.url || "",
      }));

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      };
    }

    if (action === "streams") {
      const subjectId = (params.subjectId || "").trim();
      const detailPath = (params.detailPath || "").trim();
      const se = Number(params.se || 0);
      const ep = Number(params.ep || 0);

      if (!subjectId) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing subjectId" }) };
      }

      const detailReferer = detailPath
        ? `https://moviebox.ph/detail/${detailPath}?id=${subjectId}`
        : "https://moviebox.ph/";

      const query = new URLSearchParams({
        subjectId,
        se: String(se),
        ep: String(ep),
      });

      // Try /subject/play first, then fallback to /subject/download
      let rawList = [];
      for (const endpoint of ["subject/play", "subject/download"]) {
        const res = await fetch(`${API_BASE}/${endpoint}?${query.toString()}`, {
          headers: {
            ...COMMON_HEADERS,
            Referer: detailReferer,
          },
        });
        if (!res.ok) continue;
        const json = await res.json();
        const data = json?.data || {};
        rawList = data.streams || data.downloads || data.list || [];
        if (Array.isArray(rawList) && rawList.length > 0) break;
      }

      const streams = rawList
        .filter((s) => s && (s.url || s.playUrl || s.downloadUrl))
        .map((s) => ({
          quality: s.resolutions ? `${s.resolutions}p` : (s.quality || "HD"),
          url: s.url || s.playUrl || s.downloadUrl,
          sizeLabel: formatBytes(s.size),
        }));

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streams }),
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Invalid action" }) };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
}