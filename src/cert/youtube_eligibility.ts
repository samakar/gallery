// youtube_eligibility.ts
// Active YouTube OAuth + subscriber-count gate per identity.md §2.8.
//
// Single-shot at onboarding: exchange Google OAuth authorization code for an
// access token (scope: youtube.readonly only), call YouTube Data API v3
// channels.list?part=snippet,statistics&mine=true, apply gates in order:
//   1. items[0] present                                  else YOUTUBE_NO_CHANNEL
//   2. statistics.hiddenSubscriberCount === false         else YOUTUBE_HIDDEN_SUBSCRIBERS
//   3. statistics.subscriberCount >= THRESHOLD            else YOUTUBE_INSUFFICIENT_SUBSCRIBERS
//
// On pass: returns the four audit-snapshot fields the caller persists onto
// users (channel_id, handle, sub_count, verified_at). The access token is
// used in-request and discarded -- no refresh token is requested or stored
// (identity.md §2.8.4). No `userinfo.email` scope -- Magic email stays the
// canonical platform email (identity.md §2.8.5).

export const YOUTUBE_SUBSCRIBER_THRESHOLD = Number(
    process.env.YOUTUBE_SUBSCRIBER_THRESHOLD ?? '100000',
);
// Dormancy gate: channel must have at least N public uploads in the last M
// days. Defaults: 6 uploads in 180 days (~ monthly cadence). Off by default
// at MVP -- flip YOUTUBE_DORMANCY_ENABLED=true in production .env to activate.
// See go-live checklist §5.
export const YOUTUBE_DORMANCY_ENABLED = (process.env.YOUTUBE_DORMANCY_ENABLED ?? 'false').toLowerCase() === 'true';
export const YOUTUBE_DORMANCY_LOOKBACK_DAYS = Number(
    process.env.YOUTUBE_DORMANCY_LOOKBACK_DAYS ?? '180',
);
export const YOUTUBE_DORMANCY_MIN_UPLOADS = Number(
    process.env.YOUTUBE_DORMANCY_MIN_UPLOADS ?? '6',
);

export type YoutubeEligibilityErrorCode =
    | 'YOUTUBE_OAUTH_FAILED'
    | 'YOUTUBE_NO_CHANNEL'
    | 'YOUTUBE_INSUFFICIENT_SUBSCRIBERS'
    | 'YOUTUBE_HIDDEN_SUBSCRIBERS'
    | 'YOUTUBE_DORMANT_CHANNEL';

export type YoutubeEligibilityResult =
    | {
        ok: true;
        channel_id: string;
        channel_handle: string;       // includes leading '@' (matches existing DB convention)
        subscriber_count: number;     // snapshot at verify time
        recent_upload_count: number;  // uploads within the lookback window at verify time
        verified_at: Date;
    }
    | {
        ok: false;
        error_code: YoutubeEligibilityErrorCode;
        message: string;
        subscriber_count?: number;    // populated on INSUFFICIENT for UX messaging
        recent_upload_count?: number; // populated on DORMANT for UX messaging
    };

interface GoogleTokenResponse {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
}

interface YoutubeChannelItem {
    id: string;
    snippet?: {
        title?: string;
        customUrl?: string;
        thumbnails?: { high?: { url?: string } };
    };
    statistics?: {
        subscriberCount?: string;          // YouTube returns as string
        hiddenSubscriberCount?: boolean;
    };
    contentDetails?: {
        relatedPlaylists?: {
            uploads?: string;
        };
    };
}

interface YoutubeChannelListResponse {
    items?: YoutubeChannelItem[];
}

interface YoutubePlaylistItem {
    snippet?: {
        publishedAt?: string; // ISO 8601
    };
}

interface YoutubePlaylistItemsResponse {
    items?: YoutubePlaylistItem[];
    nextPageToken?: string;
}

export async function verifyEligibility(
    oauth_code: string,
    redirect_uri: string,
): Promise<YoutubeEligibilityResult> {
    const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return {
            ok: false,
            error_code: 'YOUTUBE_OAUTH_FAILED',
            message: 'YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET not configured',
        };
    }

    // Step 1-3: exchange code for access token. Per Google's OAuth 2.0 spec.
    let tokenResp: GoogleTokenResponse;
    try {
        const body = new URLSearchParams({
            code: oauth_code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri,
            grant_type: 'authorization_code',
        });
        const resp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!resp.ok) {
            const text = await resp.text();
            return {
                ok: false,
                error_code: 'YOUTUBE_OAUTH_FAILED',
                message: `Google token exchange ${resp.status}: ${text.slice(0, 200)}`,
            };
        }
        tokenResp = (await resp.json()) as GoogleTokenResponse;
    } catch (e: any) {
        return {
            ok: false,
            error_code: 'YOUTUBE_OAUTH_FAILED',
            message: `Token exchange network error: ${e?.message ?? e}`,
        };
    }

    if (!tokenResp.access_token) {
        return {
            ok: false,
            error_code: 'YOUTUBE_OAUTH_FAILED',
            message: 'Google token response missing access_token',
        };
    }

    // Step 4-5: call channels.list?mine=true with the access token.
    let channelsResp: YoutubeChannelListResponse;
    try {
        const resp = await fetch(
            'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true',
            { headers: { Authorization: `Bearer ${tokenResp.access_token}` } },
        );
        if (!resp.ok) {
            const text = await resp.text();
            return {
                ok: false,
                error_code: 'YOUTUBE_OAUTH_FAILED',
                message: `channels.list ${resp.status}: ${text.slice(0, 200)}`,
            };
        }
        channelsResp = (await resp.json()) as YoutubeChannelListResponse;
    } catch (e: any) {
        return {
            ok: false,
            error_code: 'YOUTUBE_OAUTH_FAILED',
            message: `channels.list network error: ${e?.message ?? e}`,
        };
    }

    // Step 6: gates in order.
    const item = channelsResp.items?.[0];
    if (!item) {
        return {
            ok: false,
            error_code: 'YOUTUBE_NO_CHANNEL',
            message: 'The connected Google account has no associated YouTube channel.',
        };
    }
    if (item.statistics?.hiddenSubscriberCount === true) {
        return {
            ok: false,
            error_code: 'YOUTUBE_HIDDEN_SUBSCRIBERS',
            message: 'Your subscriber count is hidden. Please unhide it on YouTube and reconnect.',
        };
    }
    const rawCount = item.statistics?.subscriberCount;
    const subscriber_count = rawCount ? Number.parseInt(rawCount, 10) : 0;
    if (!Number.isFinite(subscriber_count) || subscriber_count < YOUTUBE_SUBSCRIBER_THRESHOLD) {
        return {
            ok: false,
            error_code: 'YOUTUBE_INSUFFICIENT_SUBSCRIBERS',
            message: `Channel has ${subscriber_count.toLocaleString()} subscribers; ${YOUTUBE_SUBSCRIBER_THRESHOLD.toLocaleString()} required.`,
            subscriber_count,
        };
    }

    // Step 7: dormancy gate. Off at MVP per identity.md §2.8.1; enable in
    // production by setting YOUTUBE_DORMANCY_ENABLED=true. When off, we skip
    // both the contentDetails parsing and the playlistItems.list call entirely
    // (saves one quota unit per verification + ~200ms of latency).
    let recent_upload_count = 0;
    if (YOUTUBE_DORMANCY_ENABLED) {
        // Walk the uploads playlist newest-first and count items with
        // publishedAt within the lookback window. Stops as soon as either
        // (a) we hit the minimum (pass) or (b) we exit the window (fail --
        // the rest of the playlist is older and can't help).
        const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
        if (!uploadsPlaylistId) {
            return {
                ok: false,
                error_code: 'YOUTUBE_DORMANT_CHANNEL',
                message: `Channel has no uploads. ${YOUTUBE_DORMANCY_MIN_UPLOADS} uploads in the last ${YOUTUBE_DORMANCY_LOOKBACK_DAYS} days required.`,
                recent_upload_count: 0,
            };
        }

        const windowStart = new Date(Date.now() - YOUTUBE_DORMANCY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
        let pageToken: string | undefined;
        let exitedWindow = false;
        try {
            // Cap pagination so a misconfigured channel doesn't make us walk the
            // whole upload history. Two pages (=100 items) is plenty: any channel
            // uploading 100 videos in 180 days vastly exceeds the gate.
            for (let page = 0; page < 2; page++) {
                const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
                url.searchParams.set('part', 'snippet');
                url.searchParams.set('playlistId', uploadsPlaylistId);
                url.searchParams.set('maxResults', '50');
                if (pageToken) url.searchParams.set('pageToken', pageToken);
                const resp = await fetch(url.toString(), {
                    headers: { Authorization: `Bearer ${tokenResp.access_token}` },
                });
                if (!resp.ok) {
                    const text = await resp.text();
                    return {
                        ok: false,
                        error_code: 'YOUTUBE_OAUTH_FAILED',
                        message: `playlistItems.list ${resp.status}: ${text.slice(0, 200)}`,
                    };
                }
                const data = (await resp.json()) as YoutubePlaylistItemsResponse;
                for (const it of data.items ?? []) {
                    const publishedAt = it.snippet?.publishedAt;
                    if (!publishedAt) continue;
                    const t = new Date(publishedAt);
                    if (Number.isNaN(t.getTime())) continue;
                    if (t >= windowStart) {
                        recent_upload_count++;
                        if (recent_upload_count >= YOUTUBE_DORMANCY_MIN_UPLOADS) break;
                    } else {
                        // playlistItems are returned newest-first; first out-of-window
                        // item means everything after is also out of window.
                        exitedWindow = true;
                        break;
                    }
                }
                if (recent_upload_count >= YOUTUBE_DORMANCY_MIN_UPLOADS) break;
                if (exitedWindow) break;
                pageToken = data.nextPageToken;
                if (!pageToken) break;
            }
        } catch (e: any) {
            return {
                ok: false,
                error_code: 'YOUTUBE_OAUTH_FAILED',
                message: `playlistItems.list network error: ${e?.message ?? e}`,
            };
        }

        if (recent_upload_count < YOUTUBE_DORMANCY_MIN_UPLOADS) {
            return {
                ok: false,
                error_code: 'YOUTUBE_DORMANT_CHANNEL',
                message: `Channel uploaded ${recent_upload_count} video${recent_upload_count === 1 ? '' : 's'} in the last ${YOUTUBE_DORMANCY_LOOKBACK_DAYS} days; ${YOUTUBE_DORMANCY_MIN_UPLOADS} required.`,
                recent_upload_count,
            };
        }
    }

    // Handle derivation: snippet.customUrl is canonical. YouTube returns it
    // with the leading '@' (e.g. '@samakar'); persist as-is to match the
    // existing DB convention. Fallback for older channels that don't yet
    // have a customUrl: 'UC' prefix from channel id.
    const channel_handle = (item.snippet?.customUrl ?? `@${item.id}`).trim();

    // access_token is discarded by going out of scope -- no storage. No refresh
    // token requested in the auth URL, so nothing to revoke.
    return {
        ok: true,
        channel_id: item.id,
        channel_handle,
        subscriber_count,
        recent_upload_count,
        verified_at: new Date(),
    };
}

// Helper: build the Google OAuth authorization URL the client redirects to.
// Single source of truth for scope + parameters per identity.md §2.8.2 step 1.
export function buildAuthorizationUrl(redirect_uri: string, state: string): string {
    const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
    if (!clientId) {
        throw new Error('YOUTUBE_OAUTH_CLIENT_ID not configured');
    }
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.readonly',
        access_type: 'online',     // no refresh token -- single-shot use
        prompt: 'consent',         // force consent screen so creator can pick the right Google account
        state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
