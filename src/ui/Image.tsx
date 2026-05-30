// Image.tsx
// MVP image page (R71 §2.7 + §3.4 row 3; R62 §4.3 composition).
// Design ref: /docs/ui_design.md §3 (zones), §4 (render states).
//
// Same URL /<image-id>; branches on (is_creator, viewer_is_owner, status,
// visibility). Owner-editable branches present a metadata form + "Put on sale"
// CTA when the row is draft (moderation passed) and all required fields are
// set. Owner-pending shows the same form with an "Awaiting review" notice
// (metadata can be prepared while moderation is still pending).

import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from './api';

type RenderState =
    | 'public-presale'   // visibility=public, status=live -> Listing preview + "Own this"
    | 'public-postsale'  // visibility=public, status=sold -> Share Copy + "View deed"
    | 'private-stub'     // visibility=private, not owner/creator -> blank lock
    | 'owner'            // post-sale viewer is deed owner -> Share + Collection
    | 'owner-editable'   // creator + (draft | pending_review) -> metadata form
    | 'loading'
    | 'not-found';

interface ImageData {
    image_id: string;
    title: string;
    creation_date: string;
    edition: string;
    listed_price_cents: number | null;
    status: string;
    visibility: string;
    preview_url: string;
    creator: {
        display_name: string;
        youtube_channel_handle: string;
        headshot_url: string | null;
        bio: string | null;
        context_video_url: string | null;
    };
    description: string;
    viewer_is_owner: boolean;
    is_creator: boolean;
    deed_mint_address: string | null;
}

export default function ImagePage() {
    const { imageId } = useParams();
    const [data, setData] = useState<ImageData | null>(null);
    const [state, setState] = useState<RenderState>('loading');

    const refetch = useCallback(async () => {
        if (!imageId) return;
        try {
            const d = await api<ImageData>(`/v1/images/${imageId}`);
            setData(d);
            setState(deriveState(d));
        } catch {
            setState('not-found');
        }
    }, [imageId]);

    useEffect(() => { refetch(); }, [refetch]);

    if (state === 'loading') return <Loading />;
    if (state === 'not-found' || !data) return <NotFound imageId={imageId} />;
    if (state === 'private-stub') return <PrivateStub imageId={imageId!} />;
    if (state === 'owner-editable') return <OwnerEditView data={data} onChanged={refetch} />;
    return <Page data={data} state={state} />;
}

function deriveState(d: ImageData): RenderState {
    if (d.is_creator && (d.status === 'pending_review' || d.status === 'draft')) {
        return 'owner-editable';
    }
    if (d.viewer_is_owner) return 'owner';
    if (d.visibility === 'private') return 'private-stub';
    if (d.status === 'live') return 'public-presale';
    if (d.status === 'sold') return 'public-postsale';
    return 'not-found';
}

// -------------------------------------------------------------------
// Basic states
// -------------------------------------------------------------------

function Loading() {
    return (
        <main className="min-h-screen flex items-center justify-center">
            <span className="loading loading-spinner" />
        </main>
    );
}

function NotFound({ imageId }: { imageId?: string }) {
    return (
        <main className="min-h-screen flex items-center justify-center px-4">
            <div className="card bg-base-200">
                <div className="card-body">
                    <h2 className="card-title">Not found</h2>
                    <p className="text-base-content/60">No image with id <code>{imageId}</code>.</p>
                </div>
            </div>
        </main>
    );
}

function PrivateStub({ imageId }: { imageId: string }) {
    return (
        <main className="min-h-screen flex items-center justify-center px-4">
            <div className="card bg-base-200 w-full max-w-sm aspect-square">
                <div className="card-body items-center justify-center text-center gap-4">
                    <span className="text-5xl text-base-content/40" aria-hidden>🔒</span>
                    <p className="text-sm text-base-content/60">
                        image <code>{imageId}</code> is private
                    </p>
                </div>
            </div>
        </main>
    );
}

// -------------------------------------------------------------------
// Owner-editable view: metadata form + "Put on sale"
// -------------------------------------------------------------------

function OwnerEditView({ data, onChanged }: { data: ImageData; onChanged: () => void }) {
    const [title, setTitle] = useState(data.title || '');
    const [description, setDescription] = useState(data.description || '');
    const [priceUsd, setPriceUsd] = useState(
        data.listed_price_cents != null ? String(data.listed_price_cents / 100) : ''
    );
    const [creationDate, setCreationDate] = useState(
        data.creation_date ? data.creation_date.slice(0, 10) : new Date().toISOString().slice(0, 10)
    );
    const [saving, setSaving] = useState(false);
    const [listing, setListing] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const missing: string[] = [];
    if (!title.trim()) missing.push('title');
    if (!description.trim()) missing.push('description');
    if (!priceUsd || Number(priceUsd) <= 0) missing.push('price');
    if (!creationDate) missing.push('creation date');

    const moderated = data.status === 'draft';
    const canList = moderated && missing.length === 0;

    async function save() {
        setSaving(true);
        setErr(null);
        try {
            await api(`/v1/images/${data.image_id}/metadata`, {
                method: 'PATCH',
                body: JSON.stringify({
                    title: title.trim(),
                    description: description.trim(),
                    listed_price_cents: Math.round(Number(priceUsd) * 100) || 0,
                    creation_date: creationDate,
                }),
            });
            onChanged();
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    }

    async function putOnSale() {
        setListing(true);
        setErr(null);
        try {
            await api(`/v1/images/${data.image_id}/list`, { method: 'POST' });
            onChanged();
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setListing(false);
        }
    }

    return (
        <main className="min-h-screen mx-auto max-w-5xl px-4 py-8 lg:py-12 space-y-8">
            <header className="flex items-center justify-between pb-4 border-b border-base-300">
                <h1 className="text-xl font-light tracking-tight">
                    {title || 'Untitled'}
                </h1>
                <Link to="/creator" className="link link-hover text-sm">
                    ← Back to grid
                </Link>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <section>
                    <img
                        src={data.preview_url}
                        alt={title || data.image_id}
                        className="w-full h-auto rounded-md shadow-sm"
                    />
                </section>

                <section className="space-y-4">
                    {data.status === 'pending_review' && (
                        <div className="alert text-sm">
                            Awaiting moderator review. You can prepare metadata now; "Put on sale"
                            unlocks once review passes.
                        </div>
                    )}

                    <label className="form-control">
                        <span className="label-text text-xs">Title</span>
                        <input
                            type="text"
                            className="input input-sm input-bordered"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                        />
                    </label>

                    <label className="form-control">
                        <span className="label-text text-xs">Description</span>
                        <textarea
                            className="textarea textarea-sm textarea-bordered"
                            rows={5}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />
                    </label>

                    <div className="grid grid-cols-2 gap-4">
                        <label className="form-control">
                            <span className="label-text text-xs">Price (USD)</span>
                            <input
                                type="number"
                                min="0"
                                step="1"
                                className="input input-sm input-bordered"
                                value={priceUsd}
                                onChange={e => setPriceUsd(e.target.value)}
                            />
                        </label>
                        <label className="form-control">
                            <span className="label-text text-xs">Creation date</span>
                            <input
                                type="date"
                                className="input input-sm input-bordered"
                                value={creationDate}
                                onChange={e => setCreationDate(e.target.value)}
                            />
                        </label>
                    </div>

                    {err && <div className="alert alert-error text-sm">{err}</div>}

                    <div className="flex flex-col gap-2 pt-2">
                        <button
                            type="button"
                            className="btn btn-sm"
                            onClick={save}
                            disabled={saving}
                        >
                            {saving ? 'Saving…' : 'Save changes'}
                        </button>
                        <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={putOnSale}
                            disabled={!canList || listing}
                        >
                            {listing ? 'Listing…' : 'Put on sale'}
                        </button>
                        {!canList && (
                            <ListingChecklist
                                moderated={moderated}
                                missing={missing}
                            />
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}

function ListingChecklist({
    moderated,
    missing,
}: {
    moderated: boolean;
    missing: string[];
}) {
    return (
        <ul className="text-xs text-base-content/60 space-y-0.5 pt-1">
            <li>{moderated ? '✓' : '○'} moderator approved</li>
            {missing.map(m => (
                <li key={m}>○ {m}</li>
            ))}
        </ul>
    );
}

// -------------------------------------------------------------------
// Public + post-sale owner page (R62 §4.3 composition)
// -------------------------------------------------------------------

function Page({ data, state }: { data: ImageData; state: RenderState }) {
    const isOwner = state === 'owner';
    const isPresale = state === 'public-presale';
    return (
        <main className="min-h-screen mx-auto max-w-6xl px-4 py-8 lg:py-12">
            <FramingChromeTop data={data} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-6">
                <section className="lg:col-span-2">
                    <img
                        src={data.preview_url}
                        alt={data.title}
                        className="w-full h-auto rounded-md shadow-sm"
                    />
                </section>
                <aside className="lg:col-span-1">
                    <CreatorPresence creator={data.creator} description={data.description} />
                </aside>
            </div>

            <div className="mt-10 lg:max-w-md">
                {isOwner ? <OwnerBar data={data} /> : <ConversionBar data={data} isPresale={isPresale} />}
            </div>

            <BelowTheFold data={data} />
            <FooterReport imageId={data.image_id} />
        </main>
    );
}

function FramingChromeTop({ data }: { data: ImageData }) {
    const year = data.creation_date ? new Date(data.creation_date).getFullYear() : '';
    return (
        <header className="space-y-1">
            <h1 className="text-2xl font-light tracking-tight">{data.title}</h1>
            <p className="text-sm text-base-content/70">
                <Link
                    to={`/creator/${data.creator.youtube_channel_handle}`}
                    className="link link-hover"
                >
                    {data.creator.display_name}
                </Link>
                <span className="mx-2 text-base-content/40">·</span>
                {year}
                <span className="mx-2 text-base-content/40">·</span>
                {data.edition}
            </p>
        </header>
    );
}

function CreatorPresence({
    creator,
    description,
}: {
    creator: ImageData['creator'];
    description: string;
}) {
    return (
        <div className="space-y-4">
            {creator.headshot_url && (
                <img
                    src={creator.headshot_url}
                    alt={creator.display_name}
                    className="w-20 h-20 rounded-full object-cover"
                />
            )}
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <p className="font-light">{creator.display_name}</p>
                    <span className="badge badge-sm badge-neutral">verified</span>
                </div>
                <a
                    href={`https://youtube.com/${creator.youtube_channel_handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link link-hover text-xs text-base-content/60"
                >
                    {creator.youtube_channel_handle} ↗
                </a>
            </div>
            <p className="text-sm text-base-content/80 leading-relaxed whitespace-pre-line">
                {description}
            </p>
            {creator.context_video_url && (
                <a
                    href={creator.context_video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link link-hover text-sm text-base-content/60"
                >
                    Watch context video ↗
                </a>
            )}
        </div>
    );
}

function ConversionBar({ data, isPresale }: { data: ImageData; isPresale: boolean }) {
    const priceUSD =
        data.listed_price_cents !== null ? (data.listed_price_cents / 100).toFixed(0) : null;
    return (
        <div className="card bg-base-200">
            <div className="card-body gap-4">
                {priceUSD !== null && <p className="text-2xl font-light">${priceUSD}</p>}
                <div className="flex flex-col gap-2">
                    {isPresale && (
                        <button type="button" className="btn btn-block">
                            Own this
                        </button>
                    )}
                    <Link to={`/${data.image_id}/deed`} className="btn btn-ghost btn-block btn-sm">
                        View deed
                    </Link>
                </div>
            </div>
        </div>
    );
}

function OwnerBar({ data }: { data: ImageData }) {
    const isPrivate = data.visibility === 'private';
    return (
        <div className="card bg-base-200">
            <div className="card-body gap-4">
                {isPrivate && (
                    <div className="alert text-sm">
                        This image is private. Click Share to make it publicly viewable.
                    </div>
                )}
                <div className="flex flex-col gap-2">
                    <button type="button" className="btn btn-block">
                        {isPrivate ? 'Share' : 'Copy link'}
                    </button>
                    <Link to="/collection" className="btn btn-ghost btn-block btn-sm">
                        Go to Collection
                    </Link>
                    <Link to={`/${data.image_id}/deed`} className="btn btn-ghost btn-block btn-sm">
                        View deed
                    </Link>
                </div>
            </div>
        </div>
    );
}

function BelowTheFold({ data }: { data: ImageData }) {
    return (
        <section className="mt-16 pt-8 border-t border-base-300 space-y-4 text-sm text-base-content/70">
            <h2 className="text-base font-light text-base-content">Provenance</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 max-w-md">
                <dt>Creator</dt>
                <dd>{data.creator.display_name}</dd>
                <dt>Created</dt>
                <dd>{data.creation_date ? new Date(data.creation_date).toLocaleDateString() : '—'}</dd>
                <dt>Edition</dt>
                <dd>{data.edition}</dd>
                {data.deed_mint_address && (
                    <>
                        <dt>Deed</dt>
                        <dd className="font-mono text-xs truncate">{data.deed_mint_address}</dd>
                    </>
                )}
            </dl>
            <Link to={`/${data.image_id}/deed`} className="link link-hover">
                View deed →
            </Link>
        </section>
    );
}

function FooterReport({ imageId }: { imageId: string }) {
    return (
        <footer className="mt-16 pt-8 border-t border-base-300 text-center">
            <a
                href={`mailto:abuse@epimage.com?subject=Report%20${imageId}`}
                className="link link-hover text-xs text-base-content/60"
            >
                Report this image
            </a>
        </footer>
    );
}
