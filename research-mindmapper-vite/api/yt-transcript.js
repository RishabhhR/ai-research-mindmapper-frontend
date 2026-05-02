/**
 * Vercel Edge Function — YouTube transcript proxy via page HTML parsing
 *
 * InnerTube API clients now require authenticated session data and return
 * UNPLAYABLE/LOGIN_REQUIRED without it. The reliable approach is:
 *
 *   1. Fetch the YouTube watch page HTML (as a browser would)
 *   2. Regex-extract the "captionTracks" array from ytInitialPlayerResponse
 *   3. Pick the best English track — it contains a fully-tokenised baseUrl
 *   4. Fetch that URL and return the transcript text
 *
 * Runs on Cloudflare edge nodes (not AWS/GCP datacenter IPs), which is
 * why this works when the Python backend's /api/timedtext calls are blocked.
 *
 * GET /api/yt-transcript?v=VIDEO_ID
 * → { success: true,  text: "...", lang: "en", tracks: N }
 * → { success: false, error: "..." }
 */
export const config = { runtime: "edge" };

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Parse YouTube's json3 caption format into plain text */
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

/** Strip XML tags and decode HTML entities (fallback format) */
function parseXml(xml) {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
}

/** Fetch a caption baseUrl and return plain text, or "" on failure */
async function fetchCaption(baseUrl) {
  const url = `${baseUrl}&fmt=json3`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Referer: "https://www.youtube.com/" },
    });
    if (!resp.ok) return "";
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("json")) return parseJson3(await resp.json());
    return parseXml(await resp.text());
  } catch {
    return "";
  }
}

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("v");

  if (!videoId || !/^[a-zA-Z0-9_-]{8,16}$/.test(videoId)) {
    return Response.json({ success: false, error: "Invalid or missing video ID" }, { status: 400 });
  }

  // ── Step 1: fetch the YouTube watch page ─────────────────────────────────
  let html = "";
  try {
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!pageResp.ok) {
      return Response.json(
        { success: false, error: `YouTube page returned HTTP ${pageResp.status}` },
        { status: 502 }
      );
    }
    html = await pageResp.text();
  } catch (e) {
    return Response.json(
      { success: false, error: `Could not reach YouTube: ${String(e).slice(0, 120)}` },
      { status: 502 }
    );
  }

  // ── Step 2: extract captionTracks from ytInitialPlayerResponse ────────────
  const match = html.match(/"captionTracks":(\[.*?\])/);
  if (!match) {
    // Check if we hit a consent/age-gate page
    const blocked =
      html.includes("consent.youtube.com") ||
      html.includes("age-restricted") ||
      html.includes("Sign in to confirm");
    const reason = blocked
      ? "Video is age-restricted or requires sign-in — captions not accessible."
      : "No caption tracks found. This video may not have captions enabled.";
    return Response.json({ success: false, error: reason }, { status: 404 });
  }

  let tracks = [];
  try {
    tracks = JSON.parse(match[1]);
  } catch {
    return Response.json({ success: false, error: "Failed to parse caption track data." }, { status: 500 });
  }

  // ── Step 3: pick best English track ──────────────────────────────────────
  // Priority: English ASR (auto-generated) → English manual → any English → first track
  const preferred =
    tracks.find((t) => t.languageCode === "en" && t.kind === "asr") ||
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  if (!preferred?.baseUrl) {
    return Response.json(
      { success: false, error: `Found ${tracks.length} tracks but none had a usable URL.` },
      { status: 404 }
    );
  }

  // ── Step 4: fetch the transcript ──────────────────────────────────────────
  const text = await fetchCaption(preferred.baseUrl);
  if (text.length > 80) {
    return Response.json({
      success: true,
      text,
      lang: preferred.languageCode ?? "en",
      tracks: tracks.length,
    });
  }

  // Try remaining tracks if preferred failed
  for (const track of tracks) {
    if (track === preferred) continue;
    const t = await fetchCaption(track.baseUrl);
    if (t.length > 80) {
      return Response.json({
        success: true,
        text: t,
        lang: track.languageCode ?? "unknown",
        tracks: tracks.length,
      });
    }
  }

  return Response.json(
    { success: false, error: `Found ${tracks.length} caption tracks but could not fetch content.` },
    { status: 404 }
  );
}
