/**
 * Vercel Edge Function — YouTube transcript proxy via InnerTube API
 *
 * The bare /api/timedtext URL without token parameters always returns empty.
 * The correct caption URL (with xorb/xobt/xovt tokens) lives inside the
 * YouTube player response (InnerTube). This function:
 *
 *   1. POSTs to YouTube's InnerTube /player endpoint to get the player data
 *   2. Extracts the first English caption track URL (with all tokens)
 *   3. Fetches and returns the transcript as plain text
 *
 * Runs on Cloudflare edge nodes (not AWS/GCP datacenter IPs).
 *
 * GET /api/yt-transcript?v=VIDEO_ID
 * → { success: true,  text: "...", lang: "en" }
 * → { success: false, error: "..." }
 */
export const config = { runtime: "edge" };

// Public InnerTube web client key (used by youtube.com itself)
const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20240101.00.00",
  hl: "en",
  gl: "US",
};

const BROWSER_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "X-YouTube-Client-Name": "1",
  "X-YouTube-Client-Version": "2.20240101.00.00",
  Origin: "https://www.youtube.com",
  Referer: "https://www.youtube.com/",
};

/** json3 format: { events: [{ segs: [{ utf8: "..." }] }] } */
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

/** XML format — strip tags and decode entities */
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

async function fetchTranscriptText(captionUrl) {
  const url = captionUrl.includes("fmt=") ? captionUrl : `${captionUrl}&fmt=json3`;
  const resp = await fetch(url, { headers: BROWSER_HEADERS });
  if (!resp.ok) return "";
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("json")) return parseJson3(await resp.json());
  return parseXml(await resp.text());
}

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("v");

  if (!videoId || !/^[a-zA-Z0-9_-]{8,16}$/.test(videoId)) {
    return Response.json(
      { success: false, error: "Invalid or missing video ID" },
      { status: 400 }
    );
  }

  // ── Step 1: InnerTube /player → extract caption track URLs ──────────────
  let tracks = [];
  try {
    const playerResp = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
      {
        method: "POST",
        headers: BROWSER_HEADERS,
        body: JSON.stringify({
          context: { client: INNERTUBE_CLIENT },
          videoId,
        }),
      }
    );

    if (playerResp.ok) {
      const player = await playerResp.json();
      tracks =
        player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    }
  } catch {
    // InnerTube unreachable — fall through to direct attempts
  }

  // Prefer: English ASR → English manual → any English → first available
  const preferred =
    tracks.find((t) => t.languageCode === "en" && t.kind === "asr") ||
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  if (preferred?.baseUrl) {
    try {
      const text = await fetchTranscriptText(preferred.baseUrl);
      if (text.length > 80) {
        return Response.json({
          success: true,
          text,
          lang: preferred.languageCode ?? "en",
        });
      }
    } catch {
      // caption fetch failed, fall through
    }
  }

  // ── Step 2: try all remaining tracks ────────────────────────────────────
  for (const track of tracks) {
    if (track === preferred) continue;
    try {
      const text = await fetchTranscriptText(track.baseUrl);
      if (text.length > 80) {
        return Response.json({
          success: true,
          text,
          lang: track.languageCode ?? "unknown",
        });
      }
    } catch {
      continue;
    }
  }

  // ── Step 3: no captions found ───────────────────────────────────────────
  const reason =
    tracks.length === 0
      ? "This video has no captions, or YouTube blocked the request from this server."
      : `Found ${tracks.length} caption track(s) but could not fetch content.`;

  return Response.json({ success: false, error: reason }, { status: 404 });
}
