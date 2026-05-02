/**
 * Vercel Edge Function — YouTube transcript proxy
 *
 * Runs on Cloudflare's edge network (not AWS/GCP datacenter IPs), so it
 * bypasses YouTube's cloud-IP transcript blocks that affect the Python backend.
 *
 * GET /api/yt-transcript?v=VIDEO_ID
 * Returns: { success: true, text: "...", lang: "en" }
 *      or: { success: false, error: "..." }
 */
export const config = { runtime: "edge" };

const YT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.youtube.com/",
};

/**
 * Parse YouTube's json3 timedtext format into plain text.
 * json3 looks like: { events: [{ segs: [{ utf8: "Hello " }] }, ...] }
 */
function parseJson3(data) {
  if (!data?.events?.length) return "";
  return data.events
    .filter((e) => e.segs)
    .flatMap((e) => e.segs)
    .map((s) => s.utf8 || "")
    .join("")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse YouTube's XML timedtext format (fallback).
 * Strips all XML tags and collapses whitespace.
 */
function parseXml(xml) {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("v");

  if (!videoId || !/^[a-zA-Z0-9_-]{8,16}$/.test(videoId)) {
    return Response.json({ success: false, error: "Invalid or missing video ID" }, { status: 400 });
  }

  // Ordered list of timedtext URLs to try:
  //   kind=asr  → auto-generated speech recognition captions
  //   (no kind) → manually uploaded captions
  const candidates = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3&kind=asr`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&fmt=json3&kind=asr`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-GB&fmt=json3&kind=asr`,
    // XML fallbacks (older format, broader support)
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
  ];

  for (const url of candidates) {
    let resp;
    try {
      resp = await fetch(url, { headers: YT_HEADERS });
    } catch {
      continue;
    }

    if (!resp.ok) continue;

    const ct = resp.headers.get("content-type") || "";
    let text = "";

    try {
      if (ct.includes("json")) {
        text = parseJson3(await resp.json());
      } else {
        text = parseXml(await resp.text());
      }
    } catch {
      continue;
    }

    if (text.length > 80) {
      // Detect language tag from URL for logging
      const lang = new URL(url).searchParams.get("lang") || "en";
      return Response.json({ success: true, text, lang });
    }
  }

  return Response.json(
    {
      success: false,
      error:
        "No transcript found for this video. " +
        "It may have captions disabled, or only non-English captions available.",
    },
    { status: 404 }
  );
}
