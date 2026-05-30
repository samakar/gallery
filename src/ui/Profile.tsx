// Profile.tsx
// Creator profile read-only view (R71 §3.4).
// Source: GET /v1/creator/profile.
//
// Fields per /docs/cert/identity.md §2.7 are captured at CMA signing (Card 1
// ESIGN). MVP shows whatever was captured; no edit affordance until an
// "update profile" workflow exists (deferred).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';

interface Profile {
    display_name: string;
    legal_name: string;
    entity_type: string;
    youtube_channel_handle: string;
    creator_bio: string | null;
    creator_headshot_url: string | null;
}

export default function ProfilePage() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api<{ profile: Profile }>('/v1/creator/profile')
            .then(r => setProfile(r.profile))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    return (
        <main className="min-h-screen mx-auto max-w-3xl px-4 py-8 lg:py-12 space-y-8">
            <header className="flex items-center justify-between pb-4 border-b border-base-300">
                <h1 className="text-2xl font-light tracking-tight">Profile</h1>
                <Link to="/creator" className="link link-hover text-sm">
                    ← Back to grid
                </Link>
            </header>
            {loading ? (
                <span className="loading loading-spinner" />
            ) : error ? (
                <div className="alert alert-error text-sm">{error}</div>
            ) : profile ? (
                <ProfileView profile={profile} />
            ) : null}
        </main>
    );
}

function ProfileView({ profile }: { profile: Profile }) {
    return (
        <section className="space-y-6">
            {profile.creator_headshot_url && (
                <img
                    src={profile.creator_headshot_url}
                    alt={profile.display_name}
                    className="w-24 h-24 rounded-full object-cover"
                />
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <Row label="Display name" value={profile.display_name} />
                <Row label="Legal name" value={profile.legal_name} />
                <Row label="Entity type" value={profile.entity_type} />
                <Row label="YouTube" value={profile.youtube_channel_handle} />
                <Row label="Bio" value={profile.creator_bio ?? '—'} />
            </dl>
        </section>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <>
            <dt className="text-base-content/60">{label}</dt>
            <dd>{value}</dd>
        </>
    );
}
