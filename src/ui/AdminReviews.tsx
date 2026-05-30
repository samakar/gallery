// AdminReviews.tsx
// Moderator review queue (R71 §3.4 row 6).
// Design ref: /docs/cert/moderation.md (two-checkbox interface).
//
// MVP review surface is two booleans only -- "abuse" and "rights". No free-form
// notes, no rejection reasons. Per moderation.md the moderator confirms both
// checks for approve; either unchecked rejects. Backend: POST
// /v1/admin/reviews/:image_id with { abuse_clear, rights_clear }.

import { useEffect, useState } from 'react';
import { api } from './api';

interface PendingReview {
    image_id: string;
    creator_display_name: string;
    title: string;
    preview_url: string;            // Listing preview (NOT Original; INV-04)
    submitted_at: string;           // ISO
}

export default function AdminReviewsPage() {
    const [queue, setQueue] = useState<PendingReview[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api<{ queue: PendingReview[] }>('/v1/admin/reviews')
            .then(r => setQueue(r.queue))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    async function decide(image_id: string, abuse_clear: boolean, rights_clear: boolean) {
        try {
            await api(`/v1/admin/reviews/${image_id}`, {
                method: 'POST',
                body: JSON.stringify({ abuse_clear, rights_clear }),
            });
            setQueue(q => q.filter(r => r.image_id !== image_id));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }

    return (
        <main className="min-h-screen mx-auto max-w-4xl px-4 py-8 lg:py-12 space-y-8">
            <header className="space-y-1">
                <h1 className="text-2xl font-light tracking-tight">Review queue</h1>
                <p className="text-sm text-base-content/60">
                    Two checks per image. Both must pass to approve. Either unchecked rejects.
                </p>
            </header>

            {error && <div className="alert alert-error text-sm">{error}</div>}
            {loading ? (
                <span className="loading loading-spinner" />
            ) : queue.length === 0 ? (
                <p className="text-sm text-base-content/60">Queue is empty.</p>
            ) : (
                <ul className="space-y-6">
                    {queue.map(r => (
                        <ReviewCard key={r.image_id} review={r} onDecide={decide} />
                    ))}
                </ul>
            )}
        </main>
    );
}

function ReviewCard({
    review,
    onDecide,
}: {
    review: PendingReview;
    onDecide: (image_id: string, abuse_clear: boolean, rights_clear: boolean) => Promise<void>;
}) {
    const [abuseClear, setAbuseClear] = useState(false);
    const [rightsClear, setRightsClear] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    async function submit() {
        setSubmitting(true);
        try {
            await onDecide(review.image_id, abuseClear, rightsClear);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <li className="card bg-base-200">
            <div className="card-body grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
                <img
                    src={review.preview_url}
                    alt={review.title}
                    className="w-full aspect-square object-cover rounded-md"
                />
                <div className="space-y-4">
                    <header className="space-y-0.5">
                        <h2 className="text-base font-light">{review.title}</h2>
                        <p className="text-xs text-base-content/60">
                            {review.creator_display_name} ·{' '}
                            <code className="font-mono">{review.image_id}</code>
                        </p>
                        <p className="text-xs text-base-content/40">
                            submitted {new Date(review.submitted_at).toLocaleString()}
                        </p>
                    </header>

                    <div className="space-y-2">
                        <label className="label cursor-pointer justify-start gap-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-sm"
                                checked={abuseClear}
                                onChange={e => setAbuseClear(e.target.checked)}
                            />
                            <span className="label-text">
                                Abuse-clear -- no CSAM, no non-consensual nudity, no
                                weaponized content
                            </span>
                        </label>
                        <label className="label cursor-pointer justify-start gap-3">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-sm"
                                checked={rightsClear}
                                onChange={e => setRightsClear(e.target.checked)}
                            />
                            <span className="label-text">
                                Rights-clear -- creator appears to own all depicted IP
                                and likenesses
                            </span>
                        </label>
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button
                            type="button"
                            className="btn btn-sm"
                            disabled={submitting || !abuseClear || !rightsClear}
                            onClick={submit}
                        >
                            Approve
                        </button>
                        <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={submitting || (abuseClear && rightsClear)}
                            onClick={submit}
                        >
                            Reject
                        </button>
                    </div>
                </div>
            </div>
        </li>
    );
}

// -------------------------------------------------------------------
// DEV mock
// -------------------------------------------------------------------

function makeMockQueue(): PendingReview[] {
    return [
        {
            image_id: 'q9z3x',
            creator_display_name: 'Sample Creator',
            title: 'Untitled draft',
            preview_url: 'https://placehold.co/600x600/eee/aaa?text=Pending+1',
            submitted_at: '2026-05-26T10:14:00Z',
        },
        {
            image_id: 'r4y8n',
            creator_display_name: 'Another Creator',
            title: 'Studio test',
            preview_url: 'https://placehold.co/600x600/eee/aaa?text=Pending+2',
            submitted_at: '2026-05-27T08:02:00Z',
        },
    ];
}
