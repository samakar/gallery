// youtube_snapshot.ts
//
// Fetches the two "moment of sealing" YouTube snapshots that get frozen into
// the deed's Arweave metadata JSON at Card 5 mint:
//
//   creator_snapshot -- the creator's channel standing at the instant of seal
//                       (subscriberCount, viewCount, videoCount, channelPublishedAt,
//                       channelId, channelTitle, handle, snapshot_timestamp,
//                       ownership_verified)
//
//   video_snapshot   -- the YouTube video the creator associated with this image
//                       (video_id, video_title, video_channelId, publishDate,
//                       thumbnail_hash, viewCount_at_seal, moment_timestamp,
//                       source_url)
//
// Both are best-effort: a YouTube API hiccup at mint time should not block
// the buyer's purchase. Callers (run_image_ops) accept `null` and proceed --
// the deed simply records nulls. There is no backfill sweeper at MVP per
// product scope. Each fetcher applies its own ~10s timeout via AbortController.
//
// Uses the public Data API (key-only, no OAuth). Requires
// `process.env.YOUTUBE_DATA_API_KEY`. If the key is absent, fetchers return
// null silently -- consistent with "fail open" semantics.

import { createHash } from 'node:crypto';

const YT_API = 'https://www.googleapis.com/youtube/v3';
const FETCH_TIMEOUT_MS = 10_000;

export interface CreatorSnapshot {
    channelId: string;
    channelTitle: string;
    handle: string | null;
    subscriberCount: number | null;          // YouTube returns this rounded to 3 sig figs for public reads
    subscriberCount_label: 'rounded';
    viewCount: number | null;                // exact
    videoCount: number | null;               // exact
    channelPublishedAt: string | null;       // ISO date (channel creation / join date)
    snapshot_timestamp: string;              // when this snapshot was taken
    ownership_verified: boolean;             // true if the creator's user_id passed YouTube OAuth verification
}

export interface VideoSnapshot {
    video_id: string;
    video_title: string;
    video_channelId: string;                 // for cross-check against the creator's channelId
    publishDate: string;                     // ISO date the video was published
    thumbnail_hash: string;                  // "sha256:<hex>" of the maxres (or best available) thumbnail bytes
    viewCount_at_seal: number | null;        // optional reach signal at the moment
    moment_timestamp: number | null;         // integer seconds into the video where the scene occurs
    source_url: string;                      // kept for convenience; flagged rot-prone, not the anchor
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
        p.then(v => { clearTimeout(t); resolve(v); })
         .catch(e => { clearTimeout(t); reject(e); });
    });
}

// Parses the `t=` query param into integer seconds. Accepts the four common
// YouTube forms: bare integer (`t=83`), seconds-suffixed (`t=83s`), mixed-unit
// (`t=1m23s`), and full hh:mm:ss (`t=1h2m3s`). Returns null if `t` is absent
// or malformed -- callers that require `t` should reject in that case.
export function parseVideoMomentSeconds(url: string): number | null {
    let t: string | null = null;
    try {
        const u = new URL(url);
        t = u.searchParams.get('t');
    } catch {
        return null;
    }
    if (!t) return null;
    // Bare integer or *s (seconds-only).
    const bare = t.match(/^(\d+)s?$/);
    if (bare) return Number(bare[1]);
    // Mixed h/m/s.
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (m) {
        const h = m[1] ? Number(m[1]) : 0;
        const min = m[2] ? Number(m[2]) : 0;
        const sec = m[3] ? Number(m[3]) : 0;
        const total = h * 3600 + min * 60 + sec;
        return total > 0 ? total : null;
    }
    return null;
}

// Extracts the 11-char video id from any standard YouTube watch URL form
// (youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/shorts/<id>,
// youtube.com/embed/<id>). Returns null on shapes we don't recognize.
export function parseVideoId(url: string): string | null {
    try {
        const u = new URL(url);
        if (u.hostname === 'youtu.be') {
            const id = u.pathname.replace(/^\//, '').split('/')[0];
            return /^[\w-]{11}$/.test(id) ? id : null;
        }
        if (/(^|\.)youtube\.com$/.test(u.hostname)) {
            const v = u.searchParams.get('v');
            if (v && /^[\w-]{11}$/.test(v)) return v;
            const m = u.pathname.match(/\/(shorts|embed)\/([\w-]{11})/);
            if (m) return m[2];
        }
        return null;
    } catch {
        return null;
    }
}

export async function fetchCreatorSnapshot(
    channelId: string,
    ownership_verified: boolean,
): Promise<CreatorSnapshot | null> {
    const key = process.env.YOUTUBE_DATA_API_KEY;
    if (!key) return null;
    const url = `${YT_API}/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(key)}`;
    try {
        const resp = await withTimeout(fetch(url), FETCH_TIMEOUT_MS);
        if (!resp.ok) return null;
        const data = await resp.json() as any;
        const item = data.items?.[0];
        if (!item) return null;
        const snippet = item.snippet ?? {};
        const stats = item.statistics ?? {};
        return {
            channelId,
            channelTitle: String(snippet.title ?? ''),
            handle: snippet.customUrl ? String(snippet.customUrl) : null,
            subscriberCount: stats.subscriberCount != null ? Number(stats.subscriberCount) : null,
            subscriberCount_label: 'rounded',
            viewCount: stats.viewCount != null ? Number(stats.viewCount) : null,
            videoCount: stats.videoCount != null ? Number(stats.videoCount) : null,
            channelPublishedAt: snippet.publishedAt ?? null,
            snapshot_timestamp: new Date().toISOString(),
            ownership_verified,
        };
    } catch (e) {
        console.warn('[youtube_snapshot] fetchCreatorSnapshot failed', channelId, (e as Error).message);
        return null;
    }
}

export type VideoOwnershipError =
    | 'INVALID_VIDEO_URL'
    | 'VIDEO_MOMENT_REQUIRED'
    | 'YOUTUBE_API_NOT_CONFIGURED'
    | 'YOUTUBE_API_UNAVAILABLE'
    | 'VIDEO_NOT_FOUND'
    | 'VIDEO_PRIVATE'
    | 'VIDEO_CHANNEL_MISMATCH';

export type VideoOwnershipResult =
    | { ok: true; video_id: string; channel_id: string; privacy_status: string; moment_seconds: number }
    | { ok: false; error_code: VideoOwnershipError; message: string };

// Verifies at Card 3 list-time that the creator-supplied YouTube URL is:
//   (a) a parseable YouTube video URL
//   (b) for a video the YouTube Data API can see (i.e., not private)
//   (c) on the creator's own channel
//
// Privacy semantics per the user spec ("non-private"): public + unlisted both
// pass; only `privacy_status === 'private'` is rejected. The Data API does not
// return videos.list rows for private videos to non-owner key-only callers --
// they appear as `VIDEO_NOT_FOUND`. If a private video's owner uses an OAuth
// token instead of an API key the items array can include the private video;
// the explicit `VIDEO_PRIVATE` branch covers that case for completeness.
export async function verifyVideoOwnership(
    video_url: string,
    expected_channel_id: string,
): Promise<VideoOwnershipResult> {
    const key = process.env.YOUTUBE_DATA_API_KEY;
    if (!key) {
        return {
            ok: false,
            error_code: 'YOUTUBE_API_NOT_CONFIGURED',
            message: 'YOUTUBE_DATA_API_KEY is not set; cannot verify video ownership.',
        };
    }
    const video_id = parseVideoId(video_url);
    if (!video_id) {
        return {
            ok: false,
            error_code: 'INVALID_VIDEO_URL',
            message: 'Not a recognizable YouTube video URL.',
        };
    }
    // The URL MUST carry a `t=` timestamp -- the moment within the video where
    // this image's scene occurs is part of the deed's identity per the user
    // spec, and the canonical way for creators to convey it is the timestamped
    // YouTube share link ("Copy video URL at current time").
    const moment_seconds = parseVideoMomentSeconds(video_url);
    if (moment_seconds == null) {
        return {
            ok: false,
            error_code: 'VIDEO_MOMENT_REQUIRED',
            message: 'YouTube URL must include a timestamp (e.g. `&t=83s` or `&t=1m23s`). Use YouTube\'s "Copy video URL at current time" share option to grab one.',
        };
    }
    const url = `${YT_API}/videos?part=snippet,status&id=${encodeURIComponent(video_id)}&key=${encodeURIComponent(key)}`;
    let data: any;
    try {
        const resp = await withTimeout(fetch(url), FETCH_TIMEOUT_MS);
        if (!resp.ok) {
            console.warn('[youtube_snapshot] verifyVideoOwnership upstream non-2xx', resp.status, video_id);
            return {
                ok: false,
                error_code: 'YOUTUBE_API_UNAVAILABLE',
                message: "YouTube is temporarily unreachable. Please try listing again in a few minutes.",
            };
        }
        data = await resp.json();
    } catch (e) {
        console.warn('[youtube_snapshot] verifyVideoOwnership fetch failed', video_id, (e as Error).message);
        return {
            ok: false,
            error_code: 'YOUTUBE_API_UNAVAILABLE',
            message: "YouTube is temporarily unreachable. Please try listing again in a few minutes.",
        };
    }
    const item = data.items?.[0];
    if (!item) {
        return {
            ok: false,
            error_code: 'VIDEO_NOT_FOUND',
            message: 'No video found at that URL (deleted, made private, or never existed).',
        };
    }
    const privacy_status = String(item.status?.privacyStatus ?? 'unknown');
    if (privacy_status === 'private') {
        return {
            ok: false,
            error_code: 'VIDEO_PRIVATE',
            message: 'Private videos cannot be associated with a deed. Use a public or unlisted video.',
        };
    }
    const channel_id = String(item.snippet?.channelId ?? '');
    if (channel_id !== expected_channel_id) {
        return {
            ok: false,
            error_code: 'VIDEO_CHANNEL_MISMATCH',
            message: 'The video is not on your verified YouTube channel.',
        };
    }
    return { ok: true, video_id, channel_id, privacy_status, moment_seconds };
}

export async function fetchVideoSnapshot(
    video_url: string,
    moment_seconds: number | null,
): Promise<VideoSnapshot | null> {
    const key = process.env.YOUTUBE_DATA_API_KEY;
    if (!key) return null;
    const video_id = parseVideoId(video_url);
    if (!video_id) return null;
    const url = `${YT_API}/videos?part=snippet,statistics&id=${encodeURIComponent(video_id)}&key=${encodeURIComponent(key)}`;
    try {
        const resp = await withTimeout(fetch(url), FETCH_TIMEOUT_MS);
        if (!resp.ok) return null;
        const data = await resp.json() as any;
        const item = data.items?.[0];
        if (!item) return null;
        const snippet = item.snippet ?? {};
        const stats = item.statistics ?? {};
        const thumbs = snippet.thumbnails ?? {};
        // Pick the highest-resolution thumbnail YouTube returned. Order:
        // maxres > standard > high > medium > default.
        const thumbnail_url = thumbs.maxres?.url
            ?? thumbs.standard?.url
            ?? thumbs.high?.url
            ?? thumbs.medium?.url
            ?? thumbs.default?.url
            ?? null;
        let thumbnail_hash = 'sha256:unavailable';
        if (thumbnail_url) {
            try {
                const tResp = await withTimeout(fetch(thumbnail_url), FETCH_TIMEOUT_MS);
                if (tResp.ok) {
                    const buf = Buffer.from(await tResp.arrayBuffer());
                    thumbnail_hash = `sha256:${createHash('sha256').update(buf).digest('hex')}`;
                }
            } catch (e) {
                console.warn('[youtube_snapshot] thumbnail fetch failed', video_id, (e as Error).message);
            }
        }
        return {
            video_id,
            video_title: String(snippet.title ?? ''),
            video_channelId: String(snippet.channelId ?? ''),
            publishDate: snippet.publishedAt ?? '',
            thumbnail_hash,
            viewCount_at_seal: stats.viewCount != null ? Number(stats.viewCount) : null,
            moment_timestamp: moment_seconds ?? null,
            source_url: video_url,
        };
    } catch (e) {
        console.warn('[youtube_snapshot] fetchVideoSnapshot failed', video_url, (e as Error).message);
        return null;
    }
}
