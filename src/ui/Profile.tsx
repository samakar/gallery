// Profile.tsx
// Creator profile -- editable.
// Source: GET /v1/creator/profile, PATCH /v1/creator/profile,
//         POST /v1/creator/profile/headshot.
//
// Form fields auto-save on Back-to-grid (matches the image editor pattern).
// Headshot uploads immediately (no draft state -- a new upload IS the change).
// entity_type is CMA/KYC data, not shown here per product decision.

import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from './api';

interface Profile {
    display_name: string;
    legal_name: string;
    youtube_channel_handle: string;
    creator_bio: string | null;
    creator_headshot_url: string | null;
}

export default function ProfilePage() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [redirectTo, setRedirectTo] = useState<string | null>(null);

    const load = async () => {
        try {
            const r = await api<{ profile: Profile }>('/v1/creator/profile');
            setProfile(r.profile);
        } catch (e: any) {
            // 404 NOT_A_CREATOR means the creators row doesn't exist yet --
            // the user is mid-onboarding. Route them to the next step
            // (creator_onboarding_wsd.md) instead of showing a raw error.
            const code = e?.body?.error;
            if (code === 'NOT_A_CREATOR') {
                try {
                    const status = await api<{ next_step: 'youtube-verify' | 'sign-cma' | 'complete' }>(
                        '/v1/creator/onboarding-status',
                    );
                    if (status.next_step === 'youtube-verify') {
                        setRedirectTo('/creator/youtube/connect');
                    } else if (status.next_step === 'sign-cma') {
                        setRedirectTo('/creator/sign-cma');
                    } else {
                        setError('Inconsistent state: profile lookup said NOT_A_CREATOR but onboarding-status says complete. Reload to retry.');
                    }
                    return;
                } catch (statusErr: any) {
                    setError(statusErr?.body?.error ?? statusErr?.message ?? String(statusErr));
                    return;
                }
            }
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    if (redirectTo) {
        return <Navigate to={redirectTo} replace />;
    }
    if (loading) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner" />
            </main>
        );
    }
    if (error) {
        return (
            <main className="min-h-screen flex items-center justify-center px-4">
                <div className="alert alert-error text-sm max-w-md">{error}</div>
            </main>
        );
    }
    if (!profile) return null;

    return <ProfileEditor profile={profile} onChanged={load} />;
}

function ProfileEditor({ profile, onChanged }: { profile: Profile; onChanged: () => void }) {
    const navigate = useNavigate();
    const headshotRef = useRef<HTMLInputElement>(null);

    const [displayName, setDisplayName] = useState(profile.display_name);
    const [bio, setBio] = useState(profile.creator_bio || '');

    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // legal_name, youtube_channel_handle, entity_type are bound to the signed
    // CMA (legal_name + entity_type embedded in document_version_hash) or the
    // verified channel (youtube_channel_handle). Editable here would silently
    // de-sync from the signed artifact, so they're displayed as read-only.
    const dirty =
        displayName !== profile.display_name ||
        bio !== (profile.creator_bio || '');

    async function persistProfile() {
        await api('/v1/creator/profile', {
            method: 'PATCH',
            body: JSON.stringify({
                display_name: displayName,
                creator_bio: bio,
            }),
        });
    }

    async function backToGrid() {
        if (!dirty) {
            navigate('/creator');
            return;
        }
        setSaving(true);
        setErr(null);
        try {
            await persistProfile();
            navigate('/creator');
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setSaving(false);
        }
    }

    async function onPickHeadshot(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setErr(null);
        try {
            // Mirror the server cap (5 MB) -- a 200×200 delivery doesn't
            // justify wasting bandwidth on a multi-MB upload.
            const MAX_BYTES = 5 * 1024 * 1024;
            if (file.size > MAX_BYTES) {
                setErr(`Headshot must be under 5 MB. Yours is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
                return;
            }
            // Reject under-size headshots before sending to the server.
            const dims = await readDims(file);
            if (dims.width < 200 || dims.height < 200) {
                setErr(`Headshot must be at least 200×200 px. Yours is ${dims.width}×${dims.height}.`);
                return;
            }
            const fd = new FormData();
            fd.append('file', file);
            await api('/v1/creator/profile/headshot', { method: 'POST', body: fd });
            onChanged();
        } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : String(e2));
        } finally {
            setUploading(false);
            if (headshotRef.current) headshotRef.current.value = '';
        }
    }

    function BioCounter({ bio }: { bio: string }) {
        const n = bio.trim().length;
        const ok = n >= 40 && n <= 280;
        return (
            <p className={`text-xs ${ok ? 'text-base-content/40' : 'text-warning'}`}>
                {n} / 40-280 chars
            </p>
        );
    }

    function readDims(file: File): Promise<{ width: number; height: number }> {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Could not read image. Try a different file.'));
            };
            img.src = url;
        });
    }

    return (
        <main className="min-h-screen mx-auto max-w-3xl px-4 py-8 lg:py-10 space-y-3">
            {/* Row 1: title | back-to-grid */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-base-200 rounded-md px-4 py-2 text-sm font-light">
                    Profile
                </div>
                <button
                    type="button"
                    onClick={backToGrid}
                    disabled={saving || uploading}
                    className="bg-base-200 rounded-md px-4 py-2 text-sm hover:bg-base-300 disabled:opacity-60"
                >
                    {saving ? 'Saving…' : '← back to folio'}
                </button>
            </div>

            {/* Headshot + form */}
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
                <section className="space-y-2">
                    <div className="bg-base-200 rounded-md overflow-hidden aspect-square">
                        {profile.creator_headshot_url ? (
                            <img
                                src={profile.creator_headshot_url}
                                alt={displayName}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-center gap-1 px-2">
                                <span className="text-base-content/40 text-sm">no photo</span>
                                <span className="text-base-content/40 text-xs">
                                    (min 200×200 px headshot)
                                </span>
                            </div>
                        )}
                    </div>
                    <input
                        ref={headshotRef}
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={onPickHeadshot}
                        disabled={uploading}
                        className="file-input file-input-bordered file-input-sm w-full bg-base-200"
                    />
                    {uploading && (
                        <p className="text-xs text-base-content/60">Uploading…</p>
                    )}
                </section>

                <section className="space-y-3">
                    {/* Editable: display name + bio first. */}
                    <label className="grid grid-cols-[110px_1fr] gap-3 items-center">
                        <span className="text-sm text-base-content/60 text-right">Display name</span>
                        <input
                            title="Display name -- shown on your image pages"
                            type="text"
                            placeholder="display name"
                            spellCheck
                            autoCapitalize="words"
                            autoCorrect="on"
                            lang="en"
                            value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            className="input input-bordered bg-base-200 w-full"
                        />
                    </label>
                    <label className="grid grid-cols-[110px_1fr] gap-3 items-start">
                        <span className="text-sm text-base-content/60 text-right pt-3">Bio</span>
                        <div className="space-y-1">
                            <textarea
                                title="Bio -- 40 to 280 characters; required before listing images"
                                placeholder="bio (about you, your work)"
                                rows={5}
                                spellCheck
                                autoCapitalize="sentences"
                                autoCorrect="on"
                                lang="en"
                                value={bio}
                                onChange={e => setBio(e.target.value)}
                                className="textarea textarea-bordered bg-base-200 w-full"
                            />
                            <BioCounter bio={bio} />
                        </div>
                    </label>
                    {/* Read-only: identity facts bound to onboarding artifacts.
                        Placed at the bottom to deemphasize and separate from
                        the editable fields above. */}
                    <div className="grid grid-cols-[110px_1fr] gap-3 items-center pt-3 border-t border-base-300">
                        <span className="text-sm text-base-content/60 text-right">Legal name</span>
                        <div
                            title="Bound to the Creator Master Agreement you signed at onboarding. Embedded in the CMA document hash; changes require a contract amendment, not a profile edit."
                            className="font-mono text-sm"
                        >
                            {profile.legal_name || '—'}
                        </div>
                    </div>
                    <div className="grid grid-cols-[110px_1fr] gap-3 items-center">
                        <span className="text-sm text-base-content/60 text-right">YouTube</span>
                        <div
                            title="Bound to your verified YouTube channel at onboarding; not editable. Contact support for a channel transfer."
                            className="font-mono text-sm"
                        >
                            {profile.youtube_channel_handle || '—'}
                        </div>
                    </div>
                </section>
            </div>

            {err && <div className="alert alert-error text-sm">{err}</div>}
        </main>
    );
}
