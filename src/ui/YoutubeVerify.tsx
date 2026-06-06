// YoutubeVerify.tsx
// Creator YouTube OAuth verification surface per identity.md §2.8.
// Two states on the same component:
//   1. No `?code=` in URL: shows the "Connect YouTube" CTA + current status.
//   2. `?code=...` returned by Google OAuth: posts to /v1/creator/youtube/verify,
//      then renders pass / fail result.
//
// The bare /v1/creator/youtube/verify endpoint does the gating; this UI is
// just the operator dashboard for it.

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from './api';

type Status =
    | { kind: 'loading' }
    | { kind: 'unverified' }
    | { kind: 'verified'; channel_handle: string; subscriber_count: number; verified_at: string }
    | { kind: 'verifying' }
    | { kind: 'pass'; channel_handle: string; subscriber_count: number }
    | { kind: 'fail'; error_code: string; message: string; subscriber_count?: number; recent_upload_count?: number };

export default function YoutubeVerifyPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [status, setStatus] = useState<Status>({ kind: 'loading' });

    useEffect(() => {
        const code = searchParams.get('code');
        const oauthErr = searchParams.get('error');
        if (oauthErr) {
            setStatus({ kind: 'fail', error_code: 'OAUTH_DENIED', message: `Google OAuth: ${oauthErr}` });
            const next = new URLSearchParams(searchParams);
            next.delete('error');
            next.delete('error_description');
            setSearchParams(next, { replace: true });
            return;
        }
        if (code) {
            setStatus({ kind: 'verifying' });
            const baseUrl = window.location.origin;
            const redirect_uri = `${baseUrl}/creator/youtube/callback`;
            api<{
                ok: true;
                channel_handle: string;
                subscriber_count: number;
            }>('/v1/creator/youtube/verify', {
                method: 'POST',
                body: JSON.stringify({ code, redirect_uri }),
                headers: { 'Content-Type': 'application/json' },
            })
                .then(r => {
                    setStatus({ kind: 'pass', channel_handle: r.channel_handle, subscriber_count: r.subscriber_count });
                    const next = new URLSearchParams(searchParams);
                    next.delete('code');
                    next.delete('state');
                    next.delete('scope');
                    setSearchParams(next, { replace: true });
                })
                .catch(e => {
                    const body = e?.body ?? {};
                    setStatus({
                        kind: 'fail',
                        error_code: body.error ?? 'UNKNOWN',
                        message: body.message ?? e?.message ?? 'Verification failed.',
                        subscriber_count: body.subscriber_count,
                        recent_upload_count: body.recent_upload_count,
                    });
                });
            return;
        }
        // No `?code` -- this is the "connect" landing. Check current state.
        api<{
            verified: boolean;
            channel_handle: string | null;
            subscriber_count_at_onboarding: number | null;
            verified_at: string | null;
        }>('/v1/me/youtube-status')
            .then(r => {
                if (r.verified && r.channel_handle && r.subscriber_count_at_onboarding != null && r.verified_at) {
                    setStatus({
                        kind: 'verified',
                        channel_handle: r.channel_handle,
                        subscriber_count: r.subscriber_count_at_onboarding,
                        verified_at: r.verified_at,
                    });
                } else {
                    setStatus({ kind: 'unverified' });
                }
            })
            .catch(() => setStatus({ kind: 'unverified' }));
    }, [searchParams, setSearchParams]);

    const startOauth = async () => {
        try {
            const redirect_uri = `${window.location.origin}/creator/youtube/callback`;
            const { authorize_url } = await api<{ authorize_url: string }>(
                `/v1/creator/youtube/authorize-url?redirect_uri=${encodeURIComponent(redirect_uri)}`,
            );
            window.location.href = authorize_url;
        } catch (e: any) {
            const body = e?.body ?? {};
            setStatus({
                kind: 'fail',
                error_code: body.error ?? 'CONFIG_ERROR',
                message: body.message ?? e?.message ?? 'Could not start OAuth.',
            });
        }
    };

    return (
        <main className="min-h-screen mx-auto max-w-2xl px-4 py-10 space-y-6">
            <header className="space-y-1">
                <p className="text-xs uppercase tracking-widest text-base-content/50">Creator onboarding</p>
                <h1 className="text-2xl font-light tracking-tight">Connect your YouTube channel</h1>
                <p className="text-sm text-base-content/70">
                    Epimage admits creators on YouTube with Silver Creator Award.
                </p>
            </header>

            {status.kind === 'loading' && (
                <div className="card bg-base-200"><div className="card-body items-center">
                    <span className="loading loading-spinner" />
                </div></div>
            )}

            {status.kind === 'unverified' && (
                <div className="card bg-base-200">
                    <div className="card-body space-y-3">
                        <p className="text-sm text-base-content/70">
                            Click below to sign in to YouTube. Google will ask you to grant
                            Epimage read-only access to your channel profile. It allows us
                            to read the channel handle and subscriber count.
                        </p>
                        <button type="button" onClick={startOauth} className="btn btn-primary">
                            Connect YouTube
                        </button>
                    </div>
                </div>
            )}

            {status.kind === 'verifying' && (
                <div className="card bg-base-200"><div className="card-body items-center space-y-2">
                    <span className="loading loading-spinner" />
                    <p className="text-sm text-base-content/70">Checking your channel...</p>
                </div></div>
            )}

            {status.kind === 'verified' && (
                <div className="card bg-success/10 border border-success/30">
                    <div className="card-body space-y-2">
                        <h2 className="card-title text-success">YouTube channel verified</h2>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                            <dt className="text-base-content/60">Channel</dt>
                            <dd className="font-mono">{status.channel_handle}</dd>
                            <dt className="text-base-content/60">Subscribers at onboarding</dt>
                            <dd className="font-mono">{status.subscriber_count.toLocaleString()}</dd>
                            <dt className="text-base-content/60">Verified at</dt>
                            <dd className="font-mono">{new Date(status.verified_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</dd>
                        </dl>
                        <Link to="/creator/sign-cma" className="btn btn-ghost btn-sm self-start">Continue to sign CMA →</Link>
                    </div>
                </div>
            )}

            {status.kind === 'pass' && (
                <div className="card bg-success/10 border border-success/30">
                    <div className="card-body space-y-2">
                        <h2 className="card-title text-success">Verified -- welcome.</h2>
                        <p className="text-sm">
                            Channel <span className="font-mono">{status.channel_handle}</span> ·
                            {' '}{status.subscriber_count.toLocaleString()} subscribers
                        </p>
                        <Link to="/creator/profile" className="btn btn-primary btn-sm self-start">Continue to profile →</Link>
                    </div>
                </div>
            )}

            {status.kind === 'fail' && (
                <div className="card bg-error/10 border border-error/30">
                    <div className="card-body space-y-2">
                        <h2 className="card-title text-error">{titleForError(status.error_code)}</h2>
                        <p className="text-sm">{status.message}</p>
                        {status.error_code === 'YOUTUBE_INSUFFICIENT_SUBSCRIBERS' && (
                            <p className="text-xs text-base-content/60">
                                Epimage admits creators at the YouTube Silver Creator Award tier and above.
                            </p>
                        )}
                        {status.error_code === 'YOUTUBE_HIDDEN_SUBSCRIBERS' && (
                            <p className="text-xs text-base-content/60">
                                {'On YouTube: Studio → Settings → Channel → Advanced settings → Subscriber count → "Display the number of people subscribed to my channel".'}
                            </p>
                        )}
                        {status.error_code === 'YOUTUBE_DORMANT_CHANNEL' && (
                            <p className="text-xs text-base-content/60">
                                Epimage requires active channels: at least 6 public uploads in the last 180 days.
                                Come back when your channel meets that cadence.
                            </p>
                        )}
                        <button type="button" onClick={startOauth} className="btn btn-ghost btn-sm self-start">Try again</button>
                    </div>
                </div>
            )}
        </main>
    );
}

function titleForError(code: string): string {
    switch (code) {
        case 'YOUTUBE_INSUFFICIENT_SUBSCRIBERS': return 'Subscriber threshold not met';
        case 'YOUTUBE_HIDDEN_SUBSCRIBERS': return 'Subscriber count is hidden';
        case 'YOUTUBE_NO_CHANNEL': return 'No YouTube channel found';
        case 'YOUTUBE_DORMANT_CHANNEL': return 'Channel is not active enough';
        case 'YOUTUBE_OAUTH_FAILED': return 'Could not reach YouTube';
        case 'YOUTUBE_OAUTH_NOT_CONFIGURED': return 'YouTube OAuth not configured';
        case 'OAUTH_DENIED': return 'OAuth canceled';
        case 'ALREADY_VERIFIED': return 'Already verified';
        case 'YOUTUBE_CHANNEL_ALREADY_CLAIMED': return 'Channel already linked';
        default: return 'Verification failed';
    }
}
