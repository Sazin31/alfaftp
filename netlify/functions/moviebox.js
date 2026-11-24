const BACKEND_BASE = (process.env.MOVIEBOX_API_BASE || "").replace(/\/+$/, "") || "http://127.0.0.1:8000";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || "search";

  try {
    if (action === "search") {
      const q = (params.q || "").trim();
      if (!q) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "Missing ?q=" }),
        };
      }

      const res = await fetch(`${BACKEND_BASE}/search?q=${encodeURIComponent(q)}&page=1`);
      if (!res.ok) {
        return {
          statusCode: res.status,
          headers: CORS_HEADERS,
          body: JSON.stringify({ items: [], error: `Backend HTTP ${res.status}` }),
        };
      }

      const json = await res.json();
      const rawItems = (json.data && json.data.items) || json.items || [];
      const items = rawItems.map((it) => ({
        subjectId: String(it.subjectId || it.id || ""),
        subjectType: it.subjectType || (it.isSeries ? 2 : 1),
        title: it.title || it.name || "Untitled",
        releaseDate: it.releaseDate || it.releaseTime || "",
        imdbRatingValue: (it.score && it.score !== "N/A") ? String(it.score) : (it.imdbRatingValue || ""),
        description: it.description || "",
        detailPath: it.detailPath || "",
        cover: it.cover || it.poster || "",
      }));

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ items }),
      };
    }

    if (action === "streams") {
      const subjectId = (params.subjectId || "").trim();
      const se = Number(params.se || 0);
      const ep = Number(params.ep || 0);

      if (!subjectId) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "Missing subjectId" }),
        };
      }

      const res = await fetch(`${BACKEND_BASE}/stream/${encodeURIComponent(subjectId)}?season=${se}&episode=${ep}`);
      if (!res.ok) {
        return {
          statusCode: res.status,
          headers: CORS_HEADERS,
          body: JSON.stringify({ streams: [], error: `Backend HTTP ${res.status}` }),
        };
      }

      const data = await res.json();
      let streams = [];

      if (Array.isArray(data.streams) && data.streams.length > 0) {
        streams = data.streams.map((s) => {
          const rawUrl = s.url || s.playUrl || s.downloadUrl;
          const cookieParam = s.signCookie || data.cookie || "";
          const proxyUrl = `${BACKEND_BASE}/proxy-media?url=${encodeURIComponent(rawUrl)}${cookieParam ? `&cookie=${encodeURIComponent(cookieParam)}` : ""}`;
          return {
            quality: s.quality || (s.resolutions ? `${s.resolutions}p` : "HD"),
            url: proxyUrl,
            rawUrl: rawUrl,
            size: s.size || "",
          };
        });
      } else if (data.url) {
        const rawUrl = data.url;
        const cookieParam = data.cookie || "";
        const proxyUrl = `${BACKEND_BASE}/proxy-media?url=${encodeURIComponent(rawUrl)}${cookieParam ? `&cookie=${encodeURIComponent(cookieParam)}` : ""}`;
        const qualLabel = (data.qualityList && data.qualityList[0]) || (data.isHls ? "HLS" : "HD");
        const durationLabel = data.duration ? `${Math.round(data.duration / 60)} min` : "";
        streams = [{
          quality: qualLabel,
          url: proxyUrl,
          rawUrl: rawUrl,
          size: durationLabel,
        }];
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ streams }),
      };
    }

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid action" }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
