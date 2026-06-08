// Image.tsx
// MVP image page (R71 §2.7 + §3.4 row 3; R62 §4.3 composition).
// Design ref: /docs/ui_design.md §3 (zones), §4 (render states).
//
// Same URL /<image-id>; branches on (is_creator, viewer_is_owner, status,
// visibility). Owner-editable branches present a metadata form + "Put on sale"
// CTA when the row is draft (moderation passed) and all required fields are
// set. Owner-pending shows the same form with an "Awaiting review" notice
// (metadata can be prepared while moderation is still pending).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link, type NavigateFunction } from 'react-router-dom';
import { api, getActiveRole } from './api';
import { getDidToken } from './magic';
import { BuyWizard, shouldResumeBuyWizard } from './BuyWizard';
import { computePrintAndFrame } from '../commerce/print_size';

type RenderState =
    | 'public-presale'   // visibility=public, status=live -> Listing preview + "Own this"
    | 'public-postsale'  // visibility=public, status=sold -> Share Copy + "View deed"
    | 'private-stub'     // visibility=private, not owner/creator -> blank lock
    | 'owner'            // post-sale viewer is deed owner -> Share + Collection
    | 'owner-editable'   // creator + (draft | pending_review) -> metadata form
    | 'owner-listed'     // creator + live -> read-only with "Take off sale" CTA
    | 'loading'
    | 'not-found';

interface ImageData {
    image_id: string;
    title: string;
    creation_date: string;
    edition: string;
    listed_price_cents: number | null;
    // Surfaced only when viewer_is_owner -- R67 §6.6 no investment register.
    purchase_price_cents: number | null;
    // Sale completion timestamp -- replaces price card in Row 4 post-sale.
    purchased_at: string | null;
    // Set when the signed-in viewer has a paid-but-not-marked Purchase for
    // this image. Listing auto-opens the BuyWizard at the monogram step so
    // the buyer can finish what they started.
    pending_purchase_id: string | null;
    status: string;
    visibility: string;
    preview_url: string;
    thumbnail_url: string;
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
    creator_profile_missing: string | null;
    isa_signed_at: string | null;
    // Full deed surface; null pre-sale and rendered as ******* by DeedPanel.
    royalty_pct: number;
    royalty_recipient: string;
    image_spec: {
        width_px: number;
        height_px: number;
        color_space: string;
        icc_profile: string;
        color_depth_bits: number;
        file_type: string;
        file_size_bytes: number;
    } | null;
    // Fallback dimensions from the Image row (populated at upload by
    // image_spec.ts or the dev test-listing endpoint). image_spec may be null
    // on older rows; these columns are the authoritative source for print-
    // size calc when that happens.
    image_width_px: number | null;
    image_height_px: number | null;
    arweave_uri: string | null;
    sha256: string | null;
    phash: string | null;
    deed_asset_id: string | null;
    deed_owner_wallet: string | null;
    deed_minted_at: string | null;
    custody_state: 'draft' | 'sealed' | 'unsealed' | 'burned';
    legal_state: 'legit' | 'disputed' | 'void';
}

export default function ImagePage({ imageId: imageIdProp }: { imageId?: string } = {}) {
    const params = useParams();
    const imageId = imageIdProp ?? params.imageId;
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
    if (state === 'private-stub') return <PrivateStub data={data} />;
    if (state === 'owner-editable') return <OwnerEditView data={data} onChanged={refetch} />;
    if (state === 'owner-listed') return <OwnerListedView data={data} onChanged={refetch} />;
    if (state === 'public-presale') return <ListingPage data={data} isPresale={true} onChanged={refetch} />;
    if (state === 'public-postsale') return <ListingPage data={data} isPresale={false} onChanged={refetch} />;
    if (state === 'owner') return <ListingPage data={data} isPresale={false} isOwner={true} onChanged={refetch} />;
    return <Page data={data} state={state} />; // fallback for any future render state
}

function deriveState(d: ImageData): RenderState {
    if (d.is_creator) {
        if (d.status === 'pending_review' || d.status === 'draft') return 'owner-editable';
        if (d.status === 'live') return 'owner-listed';
        // sold / taken_down -> immutable; fall through to public views
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

// Private-state public view (R71 §2.7 revised): an anonymous visitor who
// lands on a sold-but-private deed sees the unwatermarked Thumbnail plus the
// COA panel and the sold-date strip. The Share Copy itself is hidden until
// the owner toggles visibility to public. This is the "deed exists, image
// content not on display" composition -- museum case shut, label still
// readable -- rather than the prior blank-lock stub.
function PrivateStub({ data }: { data: ImageData }) {
    const soldDate = data.purchased_at
        ? new Date(data.purchased_at).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
        })
        : null;
    return (
        <main className="min-h-screen px-4 py-8 max-w-3xl mx-auto">
            <section className="flex flex-col items-center gap-3 mb-6">
                {/* Two-tone gallery frame: dark-brown wood frame stripe +
                    inner lighter "mat" stripe, evoking a museum-framed print
                    on a wall. Drop shadow gives the sense the work is hanging. */}
                <div className="p-3 shadow-2xl rounded-sm w-full max-w-sm" style={{ backgroundColor: '#3e2723' }}>
                    <div className="bg-base-100 p-4">
                        <div className="aspect-square w-full flex items-center justify-center overflow-hidden">
                            <img
                                src={data.thumbnail_url}
                                alt={data.title || 'Untitled'}
                                className="max-w-full max-h-full object-contain"
                            />
                        </div>
                    </div>
                </div>
                <div className="text-center">
                    <h1 className="text-lg font-semibold">{data.title || 'Untitled'}</h1>
                    <p className="text-sm text-base-content/70">{data.creator.display_name}</p>
                </div>
                {soldDate && (
                    <p className="text-xs text-base-content/50 italic">
                        Sold {soldDate}
                    </p>
                )}
            </section>
            <CoaPanel data={data} />
        </main>
    );
}

// -------------------------------------------------------------------
// Owner-editable view: metadata form + "Put on sale"
// -------------------------------------------------------------------

function OwnerEditView({ data, onChanged }: { data: ImageData; onChanged: () => void }) {
    const navigate = useNavigate();
    const [title, setTitle] = useState(data.title || '');
    const [description, setDescription] = useState(data.description || '');
    const [priceUsd, setPriceUsd] = useState(
        data.listed_price_cents != null && data.listed_price_cents > 0
            ? String(data.listed_price_cents / 100)
            : '10'
    );
    const [creationDate, setCreationDate] = useState(
        data.creation_date ? data.creation_date.slice(0, 10) : new Date().toISOString().slice(0, 10)
    );
    const [saving, setSaving] = useState(false);
    const [listing, setListing] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [signing, setSigning] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const missing: string[] = [];
    const titleTrim = title.trim();
    const titleWords = titleTrim ? titleTrim.split(/\s+/).filter(Boolean).length : 0;
    if (titleTrim.length < 5 || titleTrim.length > 50 || titleWords < 2 || titleWords > 5) {
        missing.push('title (5-50 chars, 2-5 words)');
    }
    const descTrim = description.trim();
    if (descTrim.length < 40 || descTrim.length > 280) {
        missing.push('description (40-280 chars)');
    }
    const priceNum = Number(priceUsd);
    if (!priceUsd || !Number.isInteger(priceNum) || priceNum < 5 || priceNum > 500) {
        missing.push('price ($5-$500 whole dollar)');
    }
    // creation_date is EXIF-sourced; never blocks listing.

    if (data.creator_profile_missing) {
        missing.push(`profile (${data.creator_profile_missing})`);
    }
    if (!data.isa_signed_at) {
        missing.push('signed affirmation');
    }

    const moderated = data.status === 'draft';
    const canList = moderated && missing.length === 0;

    // Dirty tracking for auto-save on navigation away.
    // creation_date is excluded -- it's EXIF-sourced and read-only.
    const currentPriceCents = Math.round(priceNum * 100) || 0;
    const dirty =
        title.trim() !== (data.title || '') ||
        description.trim() !== (data.description || '') ||
        currentPriceCents !== (data.listed_price_cents || 0);

    async function persistMetadata() {
        await api(`/v1/images/${data.image_id}/metadata`, {
            method: 'PATCH',
            body: JSON.stringify({
                title: title.trim(),
                description: description.trim(),
                listed_price_cents: currentPriceCents,
                // creation_date intentionally omitted -- it's EXIF-sourced
                // and the server PATCH route is the source of truth.
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
            await persistMetadata();
            navigate('/creator');
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setSaving(false);  // stay on page so user can fix
        }
    }

    async function putOnSale() {
        setListing(true);
        setErr(null);
        try {
            if (dirty) await persistMetadata();
            await api(`/v1/images/${data.image_id}/list`, { method: 'POST' });
            onChanged();
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setListing(false);
        }
    }

    async function signAffirmation() {
        setSigning(true);
        setErr(null);
        try {
            // Auto-save in-progress edits first so the ISA's rendered text
            // references the up-to-date title.
            if (dirty) await persistMetadata();
            await api(`/v1/images/${data.image_id}/sign-affirmation`, { method: 'POST' });
            onChanged();
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setSigning(false);
        }
    }

    async function del() {
        if (!window.confirm(`Delete "${title || data.image_id}"? This cannot be undone.`)) return;
        setDeleting(true);
        setErr(null);
        try {
            await api(`/v1/images/${data.image_id}`, { method: 'DELETE' });
            navigate('/creator');
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setDeleting(false);
        }
    }

    return (
        <main className="min-h-screen mx-auto max-w-3xl px-4 py-8 lg:py-10 space-y-3">
            {/* Row 1: [trash] | filename | back-to-grid */}
            <div className="flex items-stretch gap-3">
                <button
                    type="button"
                    onClick={del}
                    disabled={deleting || saving || listing}
                    aria-label="Delete"
                    title="Delete"
                    className="btn btn-ghost btn-square disabled:opacity-60"
                >
                    {deleting
                        ? <span className="loading loading-spinner loading-sm" />
                        : <TrashIcon />}
                </button>
                <div className="grid grid-cols-2 gap-3 flex-1">
                    <div
                        title={`${title || 'Untitled'}.jpg`}
                        className="bg-base-200 rounded-md px-4 py-2 text-sm font-light flex items-center min-w-0"
                    >
                        <span className="truncate">{title || 'Untitled'}</span>
                    </div>
                    <button
                        type="button"
                        onClick={backToGrid}
                        disabled={saving || listing || deleting}
                        className="bg-base-200 rounded-md px-4 py-2 text-sm hover:bg-base-300 disabled:opacity-60"
                    >
                        {saving ? 'Saving…' : '← back to grid'}
                    </button>
                </div>
            </div>

            {/* Row 2: image */}
            <section className="bg-base-200 rounded-md overflow-hidden">
                <img
                    src={data.preview_url}
                    alt={title || data.image_id}
                    className="w-full h-auto"
                />
            </section>

            {/* Row 3: description */}
            <textarea
                title="Description -- 40 to 280 characters"
                className="textarea textarea-bordered w-full bg-base-200"
                placeholder="description"
                rows={2}
                spellCheck
                autoCapitalize="sentences"
                autoCorrect="on"
                lang="en"
                value={description}
                onChange={e => setDescription(e.target.value)}
            />

            {/* Row 4: title | creation date | price */}
            <div className="grid grid-cols-[2fr_2fr_1fr] gap-3">
                <input
                    title="Title -- 5 to 50 characters, 2 to 5 words"
                    type="text"
                    placeholder="title"
                    className="input input-bordered bg-base-200"
                    spellCheck
                    autoCapitalize="words"
                    autoCorrect="on"
                    lang="en"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                />
                <input
                    title="Creation date -- read from the image's EXIF DateTimeOriginal at upload; not editable"
                    type="date"
                    className="input input-bordered bg-base-200 cursor-default focus:outline-none"
                    value={creationDate}
                    readOnly
                    onKeyDown={e => e.preventDefault()}
                />
                <label
                    title="Price (USD) -- $5 to $500, whole dollar"
                    className="input input-bordered bg-base-200 flex items-center gap-1"
                >
                    <span className="text-base-content/60">$</span>
                    <input
                        type="number"
                        min="5"
                        max="500"
                        step="1"
                        placeholder="price"
                        className="grow bg-transparent outline-none"
                        value={priceUsd}
                        onChange={e => setPriceUsd(e.target.value)}
                    />
                </label>
            </div>

            {/* ISA gate -- one line directly above Put on Sale. */}
            <IsaRow
                signedAt={data.isa_signed_at}
                signing={signing}
                onSign={signAffirmation}
            />

            {/* Row 5: moderator status | Put on Sale */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-base-200 rounded-md px-4 py-2 text-sm">
                    moderator: {moderated ? 'approved' : 'pending'}
                </div>
                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={putOnSale}
                    disabled={!canList || listing || deleting || saving}
                >
                    {listing ? 'Listing…' : 'Put on Sale'}
                </button>
            </div>

            {/* Diagnostics */}
            {!canList && missing.length > 0 && (
                <p className="text-xs text-base-content/60">
                    Need: {missing.join(', ')}
                    {data.creator_profile_missing && (
                        <>
                            {' '}
                            (<Link to="/creator/profile" className="link link-hover">edit profile</Link>)
                        </>
                    )}
                </p>
            )}
            {err && <div className="alert alert-error text-sm">{err}</div>}
        </main>
    );
}

function TrashIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    );
}

// -------------------------------------------------------------------
// Owner-listed view: the creator sees EXACTLY the buyer-facing page (same
// composition as public-presale -- hero, creator-presence, conversion bar,
// provenance), plus a creator-only "Remove from list" action at the bottom.
// Faithful preview of the public listing + the one creator-side action.
// -------------------------------------------------------------------

function OwnerListedView({ data, onChanged }: { data: ImageData; onChanged: () => void }) {
    const [unlisting, setUnlisting] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function unlist() {
        setUnlisting(true);
        setErr(null);
        try {
            await api(`/v1/images/${data.image_id}/unlist`, { method: 'POST' });
            onChanged();
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setUnlisting(false);
        }
    }

    return (
        <ListingPage
            data={data}
            isPresale={true}
            creatorAction={
                <section className="pt-4 space-y-3">
                    <p className="text-xs text-base-content/60 text-center">
                        You are the creator. This is what buyers see -- the action below removes the listing.
                    </p>
                    {err && <div className="alert alert-error text-sm">{err}</div>}
                    <div className="flex justify-center">
                        <button
                            type="button"
                            className="btn btn-warning"
                            onClick={unlist}
                            disabled={unlisting}
                        >
                            {unlisting ? 'Removing…' : 'Remove from list'}
                        </button>
                    </div>
                </section>
            }
        />
    );
}

// -------------------------------------------------------------------
// Public listing layout (per the wireframe). Used for public-presale,
// public-postsale, and the creator's preview (owner-listed). Compact 3-row
// content (image / actions / metadata) + collapsible CoA and Deed panels.
// -------------------------------------------------------------------

function ListingPage({
    data,
    isPresale,
    isOwner = false,
    onChanged,
    creatorAction,
}: {
    data: ImageData;
    isPresale: boolean;
    isOwner?: boolean;
    onChanged?: () => void;
    creatorAction?: React.ReactNode;
}) {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    // Single buy modal -- BuyWizard internally orchestrates sign-in,
    // contracts, payment, monogram. Replaces the old separate Esign /
    // Checkout / Monogram modal stack.
    const [wizardOpen, setWizardOpen] = useState(false);
    const beginBuy = () => setWizardOpen(true);
    // `?paid=<session_id>&purchase=<purchase_id>` is set by Stripe's return_url
    // after a successful Embedded Checkout. We capture the purchase id and
    // swap the Buy slot for owner actions.
    const [paidPurchaseId, setPaidPurchaseId] = useState<string | null>(null);
    type MintStage = 'idle' | 'minting' | 'minted' | 'failed';
    const [mintStage, setMintStage] = useState<MintStage>('idle');
    const [assetId, setAssetId] = useState<string | null>(null);
    const [mintError, setMintError] = useState<string | null>(null);
    // `?checkout=open` on the URL auto-opens the modal on mount when the
    // viewer is signed in and the listing is presale -- used by the
    // SignIn "Test checkout as dev Buyer" shortcut and by the buy-button
    // post-signin bounce-back so a buyer who just signed in doesn't need to
    // click Buy a second time.
    // Optional initial step for the wizard -- only set when recovering a
    // paid-but-stranded purchase from a legacy `?paid=` redirect.
    const [wizardInitialStep, setWizardInitialStep] = useState<
        'monogram' | undefined
    >(undefined);
    // Recover a stranded paid purchase that has no monogram yet. The buyer
    // closed the tab between Stripe success and the monogram step; when they
    // come back to this listing signed in, we drop them straight into the
    // monogram step of the wizard. Fires once per data refresh.
    const recoveredRef = useRef(false);
    useEffect(() => {
        if (recoveredRef.current) return;
        if (!data.pending_purchase_id) return;
        recoveredRef.current = true;
        sessionStorage.setItem('buy-wizard-purchase-id', data.pending_purchase_id);
        setWizardInitialStep('monogram');
        setWizardOpen(true);
    }, [data.pending_purchase_id]);

    // Open the BuyWizard automatically when:
    //  - `?buy=resume` -- the OAuth round-trip landed back here mid-wizard
    //  - `?checkout=open` -- the /backdoor "Test checkout" shortcut
    //  - `?paid=...&purchase=...` -- recovery from a Stripe iframe redirect
    //    that fired before the wizard could catch onComplete. Resumes at the
    //    monogram step using the purchase_id from the URL.
    useEffect(() => {
        if (!isPresale) return;
        const paid = searchParams.get('paid');
        const purchaseId = searchParams.get('purchase');
        if (paid && purchaseId) {
            sessionStorage.setItem('buy-wizard-purchase-id', purchaseId);
            setWizardInitialStep('monogram');
            setWizardOpen(true);
            const next = new URLSearchParams(searchParams);
            next.delete('paid');
            next.delete('purchase');
            setSearchParams(next, { replace: true });
            return;
        }
        const wantsResume = shouldResumeBuyWizard(searchParams, data.image_id);
        const wantsCheckout = searchParams.get('checkout') === 'open' && getActiveRole() !== null;
        if (!wantsResume && !wantsCheckout) return;
        setWizardInitialStep(undefined);
        setWizardOpen(true);
        const next = new URLSearchParams(searchParams);
        next.delete('checkout');
        next.delete('buy');
        setSearchParams(next, { replace: true });
    }, [isPresale, searchParams, setSearchParams, data.image_id]);

    // Post-payment ownership state (R71 §2.4 steps 12-16) renders inside the
    // normal listing layout below. The Buy slot in Row 3 swaps for owner
    // actions (Share / Download / Make Public) and a monogram modal opens
    // automatically until the buyer confirms.

    // Poll mint status when in 'minting'; self-cancels on stage change.
    useEffect(() => {
        if (mintStage !== 'minting' || !paidPurchaseId) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const poll = async () => {
            try {
                const s = await api<{
                    status: string;
                    asset_id: string | null;
                    failure_reason?: string | null;
                }>(`/v1/purchases/${paidPurchaseId}/status`);
                if (cancelled) return;
                if (s.status === 'confirmed' && s.asset_id) {
                    setAssetId(s.asset_id);
                    setMintStage('minted');
                    // Refetch the image now that the deed exists -- the server
                    // swaps `preview_url` to the Share Copy variant (monogram
                    // baked in, central watermark dropped).
                    onChanged?.();
                    return;
                }
                if (s.status === 'failed') {
                    setMintError(s.failure_reason ?? 'Mint failed.');
                    setMintStage('failed');
                    return;
                }
                timer = setTimeout(poll, 3000);
            } catch {
                if (cancelled) return;
                timer = setTimeout(poll, 3000);
            }
        };
        timer = setTimeout(poll, 1500);
        return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }, [mintStage, paidPurchaseId]);

    const isPostPurchase = paidPurchaseId !== null;
    const actionsEnabled = mintStage === 'minted';
    const priceUsd =
        data.listed_price_cents != null ? (data.listed_price_cents / 100).toFixed(0) : null;
    const rawTitle = data.title || 'Untitled';
    // Newspaper-headline title case: capitalize the first letter of every word.
    // Display-only -- stored data.title is unchanged so creator intent is preserved.
    const displayTitle = rawTitle.replace(/\b\w/g, c => c.toUpperCase());

    return (
        <main className="min-h-screen mx-auto max-w-3xl px-4 py-8 lg:py-10 space-y-3">
            {/* Row 1: Title | Share | ← Home */}
            <div className="flex items-center justify-between gap-3">
                <h1
                    title={displayTitle}
                    className="text-2xl font-semibold tracking-tight truncate min-w-0"
                >
                    {displayTitle}
                </h1>
                <div className="flex items-center gap-2 shrink-0">
                    <ShareButton imageId={data.image_id} />
                    <Link
                        to="/"
                        className="bg-base-200 rounded-md px-4 py-2 text-sm hover:bg-base-300"
                    >
                        ← Home
                    </Link>
                </div>
            </div>

            {/* Row 2: Image. Buyer's confirmed monogram is overlaid inline
                with the baked-in "1 of 1" edition mark for preview; the real
                Share Copy with the monogram baked in is generated post-mint
                by image_gen.generateShareCopy (TODO). */}
            <section className="relative bg-base-200 rounded-md overflow-hidden">
                <img
                    src={data.preview_url}
                    alt={data.title}
                    className="w-full h-auto block"
                />
            </section>

            {/* Row 3: Headshot (grayscale) | Description | Buy / Deed */}
            <div className="grid grid-cols-[88px_1fr_88px] gap-3">
                <div
                    title={data.creator.display_name}
                    className="bg-base-200 rounded-md overflow-hidden aspect-square flex items-center justify-center"
                >
                    {data.creator.headshot_url ? (
                        <img
                            src={data.creator.headshot_url}
                            alt={data.creator.display_name}
                            className="w-full h-full object-cover grayscale"
                        />
                    ) : (
                        <div className="text-xs text-base-content/40 text-center leading-tight px-1">
                            creator<br />head shot
                        </div>
                    )}
                </div>
                <div
                    title={data.description || ''}
                    className="font-deed italic text-base-content/75 leading-relaxed bg-base-200 rounded-md px-4 py-3 whitespace-pre-line overflow-y-auto"
                >
                    {data.description || (
                        <span className="text-base-content/40">No description yet.</span>
                    )}
                </div>
                {isPostPurchase || isOwner ? (
                    <PostPurchaseActions
                        imageId={data.image_id}
                        previewUrl={data.preview_url}
                        visibility={(data.visibility as 'public' | 'private') ?? 'private'}
                        actionsEnabled={isOwner || actionsEnabled}
                        mintStage={isOwner ? 'minted' : mintStage}
                        assetId={isOwner ? data.deed_asset_id : assetId}
                        mintError={mintError}
                        onChanged={onChanged}
                    />
                ) : isPresale ? (
                    <button
                        type="button"
                        disabled={data.is_creator}
                        title={data.is_creator ? 'You created this image -- self-purchase is not allowed.' : undefined}
                        onClick={() => handleBuyClick(data.image_id, navigate, beginBuy)}
                        className="btn btn-neutral h-full text-base"
                    >
                        Buy
                    </button>
                ) : (
                    <Link
                        to={`/${data.image_id}/deed`}
                        className="btn btn-neutral h-full text-base flex items-center justify-center"
                    >
                        Deed
                    </Link>
                )}
            </div>

            {/* Row 4: Creation date | Print Size | Price (pre-sale) OR Purchased (post-sale)
                R67 §6.6 / §5.8: no investment register post-sale; we swap the
                price card for the sale completion date so anyone viewing the
                listing sees provenance instead of market signal. */}
            <div className="grid grid-cols-[1fr_1.4fr_88px] gap-3">
                <div className="bg-base-200 rounded-md px-4 py-2 text-sm text-center">
                    {data.creation_date
                        ? new Date(data.creation_date).toLocaleDateString()
                        : '—'}
                </div>
                {(() => {
                    // Prefer image_spec; fall back to top-level Image columns
                    // populated at upload. Both refer to the original
                    // uploaded image, not the Cloudinary display variant.
                    const w = data.image_spec?.width_px ?? data.image_width_px;
                    const h = data.image_spec?.height_px ?? data.image_height_px;
                    if (!w || !h) {
                        return (
                            <div className="bg-base-200 rounded-md px-4 py-2 text-sm text-center text-base-content/70">
                                —
                            </div>
                        );
                    }
                    const r = computePrintAndFrame(w, h);
                    return (
                        <div
                            className="bg-base-200 rounded-md px-4 py-2 text-sm text-center text-base-content/70"
                            title={`Print at 300 DPI: ${r.print_label}${r.frame_label ? ` · Largest standard frame: ${r.frame_label}` : ''}`}
                        >
                            {r.frame_label ? `Frame: ${r.frame_label}` : `${r.print_label} (no standard frame)`}
                        </div>
                    );
                })()}
                <div className="bg-base-200 rounded-md px-4 py-2 text-sm text-center font-light">
                    {data.purchased_at
                        ? new Date(data.purchased_at).toLocaleDateString()
                        : priceUsd !== null
                            ? `$${priceUsd}`
                            : '—'}
                </div>
            </div>

            {/* Collapsible CoA panel */}
            <CoaPanel data={data} />

            {/* Collapsible Deed panel */}
            <DeedPanel data={data} />

            {creatorAction}

            {/* Report link: faint footer, visible on every listed + sold rendering
                (public-presale, public-postsale, owner-listed via ListingPage,
                owner via ListingPage). Mailto pre-fills the image_id so the
                abuse inbox can correlate without the reporter having to type
                an opaque slug. Hidden on pre-listing states (pending_review /
                draft) and on private-stub renders, which use different
                components and don't include this footer. */}
            <FooterReport imageId={data.image_id} />

            {wizardOpen && (
                <BuyWizard
                    imageId={data.image_id}
                    initialStep={wizardInitialStep}
                    onClose={() => setWizardOpen(false)}
                    onComplete={dispatchError => {
                        const purchaseId = sessionStorage.getItem('buy-wizard-purchase-id');
                        sessionStorage.removeItem('buy-wizard-purchase-id');
                        sessionStorage.removeItem('buy-wizard-esign');
                        setWizardOpen(false);
                        if (purchaseId) setPaidPurchaseId(purchaseId);
                        if (dispatchError) {
                            // Build dispatch failed -- still close the wizard,
                            // surface a Retry affordance on the owner page.
                            setMintError(dispatchError);
                            setMintStage('failed');
                        } else {
                            setMintStage('minting');
                        }
                        onChanged?.();
                    }}
                />
            )}
        </main>
    );
}

// Replaces the Buy button in Row 3 after payment. Three vertical buttons:
//   - Share: confirm modal warns visibility flips to public, then opens a
//     link-copy modal.
//   - Download: confirm modal warns the original cannot be resold or have its
//     deed transferred after download, then opens the file.
//   - Make Public / Make Private: toggle by current visibility. No modal --
//     direct flip. (Deliberate divergence from R71/R62 one-way share spec.)
// All three are disabled until the mint settles.
function PostPurchaseActions({
    imageId,
    previewUrl,
    visibility,
    actionsEnabled,
    mintStage,
    assetId,
    mintError,
    onChanged,
}: {
    imageId: string;
    previewUrl: string;
    visibility: 'public' | 'private';
    actionsEnabled: boolean;
    mintStage: 'idle' | 'minting' | 'minted' | 'failed';
    assetId: string | null;
    mintError: string | null;
    onChanged?: () => void;
}) {
    const [shareConfirm, setShareConfirm] = useState(false);
    const [shareLink, setShareLink] = useState(false);
    const [downloadConfirm, setDownloadConfirm] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [flipping, setFlipping] = useState(false);
    const [flipError, setFlipError] = useState<string | null>(null);
    const shareUrl = `${window.location.origin}/${imageId}`;
    const isPublic = visibility === 'public';

    const flipVisibility = async (target: 'public' | 'private') => {
        setFlipping(true);
        setFlipError(null);
        try {
            await api(`/v1/images/${imageId}/visibility`, {
                method: 'POST',
                body: JSON.stringify({ visibility: target }),
            });
            onChanged?.();
        } catch (e: any) {
            setFlipError(e?.message ?? 'Privacy flip failed.');
        } finally {
            setFlipping(false);
        }
    };

    const disabledHint = 'Available once your deed is issued.';
    // Share / Download stay enabled during a privacy flip -- only the toggle
    // itself locks while its own API request is in flight.
    const actionsDisabled = !actionsEnabled;
    const toggleDisabled = !actionsEnabled || flipping;
    return (
        <>
            <div className="flex flex-col gap-1 h-full">
                <button
                    type="button"
                    disabled={actionsDisabled}
                    onClick={() => setShareConfirm(true)}
                    title={actionsDisabled ? disabledHint : 'Copy link to this image'}
                    className="btn btn-neutral btn-sm flex-1"
                >
                    Share
                </button>
                <button
                    type="button"
                    disabled={actionsDisabled || downloading}
                    onClick={() => setDownloadConfirm(true)}
                    title={actionsDisabled ? disabledHint : undefined}
                    className={`flex items-center justify-center px-3 py-1.5 rounded-md text-xs flex-1 border border-base-300 ${
                        actionsDisabled || downloading
                            ? 'bg-base-200 text-base-content/40 cursor-not-allowed'
                            : 'bg-base-100 text-base-content hover:bg-base-200'
                    }`}
                >
                    {downloading ? 'Downloading…' : 'Download'}
                </button>
                <label
                    title={actionsDisabled ? disabledHint : isPublic ? 'Drag to make private' : 'Drag to make public'}
                    className={`flex items-center justify-between px-3 py-1.5 rounded-md text-xs flex-1 cursor-pointer select-none border border-base-300 ${
                        toggleDisabled
                            ? 'bg-base-200 text-base-content/40 cursor-not-allowed'
                            : 'bg-base-100 text-base-content'
                    }`}
                >
                    <span>{isPublic ? 'Public' : 'Private'}</span>
                    <input
                        type="checkbox"
                        disabled={toggleDisabled}
                        checked={isPublic}
                        onChange={e => flipVisibility(e.target.checked ? 'public' : 'private')}
                        className="toggle toggle-xs toggle-success"
                    />
                </label>
                {mintStage === 'minting' && (
                    <p className="text-[10px] text-base-content/60 text-center leading-tight pt-1">
                        Issuing your deed…
                    </p>
                )}
                {mintStage === 'failed' && (
                    // Sweeper retries in the background; the buyer doesn't
                    // need to act. Surface the long-running state honestly
                    // without alarming the buyer.
                    <p className="text-[10px] text-base-content/60 text-center leading-tight pt-1" title={mintError ?? ''}>
                        Still issuing your deed…
                    </p>
                )}
                {flipError && (
                    <p className="text-[10px] text-error text-center leading-tight pt-1">
                        {flipError}
                    </p>
                )}
                {downloadError && (
                    <p className="text-[10px] text-error text-center leading-tight pt-1" title={downloadError}>
                        {downloadError}
                    </p>
                )}
            </div>

            {shareConfirm && (
                <ConfirmModal
                    title="Share this image?"
                    body="Sharing will make your image visible to anyone with the link. Your edition will become public until you make it private again."
                    confirmLabel="Share"
                    cancelLabel="Cancel"
                    onCancel={() => setShareConfirm(false)}
                    onConfirm={async () => {
                        setShareConfirm(false);
                        if (!isPublic) await flipVisibility('public');
                        setShareLink(true);
                    }}
                />
            )}

            {shareLink && (
                <LinkCopyModal
                    url={shareUrl}
                    onClose={() => setShareLink(false)}
                />
            )}

            {downloadConfirm && (
                <ConfirmModal
                    title="Download the original?"
                    body="After you download the original file, Epimage no longer supports resale or transfer of the deed for this edition. Continue?"
                    confirmLabel="Download"
                    cancelLabel="Cancel"
                    onCancel={() => setDownloadConfirm(false)}
                    onConfirm={async () => {
                        setDownloadConfirm(false);
                        setDownloading(true);
                        setDownloadError(null);
                        try {
                            // POST -> server decrypts the Master from Arweave +
                            // PLATFORM_DEK, flips custody_state sealed->unsealed
                            // (first call only), streams bytes with
                            // Content-Disposition: attachment. Use a blob URL
                            // + dynamic <a download> click to trigger the
                            // browser's save dialog with the right filename.
                            const didToken = await getDidToken();
                            const resp = await fetch(
                                `/v1/deeds/${imageId}/download-master`,
                                {
                                    method: 'POST',
                                    headers: didToken
                                        ? { Authorization: `Bearer ${didToken}` }
                                        : {},
                                },
                            );
                            if (!resp.ok) {
                                const body = await resp.json().catch(() => ({}));
                                throw new Error(
                                    body.message ?? body.error ?? `HTTP ${resp.status}`,
                                );
                            }
                            // R62 §2.3 specifies the filename format:
                            // epimage_<youtube-handle>_<owner-ordinal>_<image-id>.<ext>
                            // The server computes it and returns via
                            // Content-Disposition; we extract here because for
                            // blob URLs the browser uses a.download, not the
                            // response header.
                            const cd = resp.headers.get('Content-Disposition') ?? '';
                            const cdMatch = cd.match(/filename="([^"]+)"/);
                            const filename = cdMatch?.[1] ?? `epimage_${imageId}.jpg`;
                            const blob = await resp.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            URL.revokeObjectURL(url);
                            // custody_state transitioned; refresh parent so the
                            // Deed of Ownership panel shows 'unsealed'.
                            onChanged?.();
                        } catch (e: any) {
                            setDownloadError(e?.message ?? 'Download failed.');
                        } finally {
                            setDownloading(false);
                        }
                    }}
                />
            )}
        </>
    );
}

// Generic confirm modal used by Share and Download flows. Two buttons,
// destructive-looking confirm color when the action is consequential.
function ConfirmModal({
    title,
    body,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
}: {
    title: string;
    body: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={onCancel}
        >
            <div
                className="bg-base-100 rounded-lg max-w-sm w-full p-6 space-y-4"
                onClick={e => e.stopPropagation()}
            >
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-base-content/70 leading-relaxed">{body}</p>
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
                        {cancelLabel}
                    </button>
                    <button type="button" onClick={onConfirm} className="btn btn-neutral btn-sm">
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Modal shown after sharing is confirmed. Surfaces the canonical URL with a
// copy button + auto-selects the text for keyboard copy. Closes on dismiss.
function LinkCopyModal({ url, onClose }: { url: string; onClose: () => void }) {
    const [copied, setCopied] = useState(false);
    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* swallow */ }
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-base-100 rounded-lg max-w-sm w-full p-6 space-y-4"
                onClick={e => e.stopPropagation()}
            >
                <h3 className="font-semibold">Your edition is public</h3>
                <p className="text-sm text-base-content/70">
                    Anyone with this link can view your edition:
                </p>
                <input
                    type="text"
                    readOnly
                    value={url}
                    onFocus={e => e.currentTarget.select()}
                    className="input input-bordered w-full text-sm"
                />
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
                        Done
                    </button>
                    <button type="button" onClick={onCopy} className="btn btn-neutral btn-sm">
                        {copied ? 'Copied!' : 'Copy link'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Monogram modal -- auto-opens after payment. Buyer enters 1-3 letters; on
// Confirm the parent dispatches start-build with the chosen monogram and
// transitions the listing into the minting state. No Cancel button: the
// buyer has already paid and the build needs to happen.
function MonogramModal({ onConfirm }: { onConfirm: (m: string) => void }) {
    const [value, setValue] = useState('');
    const trimmed = value.trim().toUpperCase();
    const valid = trimmed.length >= 1 && trimmed.length <= 3;
    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-base-100 rounded-lg max-w-sm w-full p-6 space-y-4">
                <header>
                    <h3 className="font-semibold">Choose your monogram</h3>
                    <p className="text-sm text-base-content/60 mt-1">
                        1–3 letters. Appears on the Share Copy of your edition,
                        inline with “1 of 1”.
                    </p>
                </header>
                <input
                    type="text"
                    maxLength={3}
                    value={value}
                    onChange={e => setValue(e.target.value.replace(/[^A-Za-z]/g, ''))}
                    placeholder="A"
                    className="input input-bordered w-full text-center text-xl tracking-widest"
                    autoFocus
                />
                <button
                    type="button"
                    disabled={!valid}
                    onClick={() => onConfirm(trimmed)}
                    className="btn btn-neutral btn-block"
                >
                    Issue deed
                </button>
            </div>
        </div>
    );
}

function CoaPanel({ data }: { data: ImageData }) {
    const creator = data.creator.display_name;
    const title = data.title || 'Untitled';
    const creationDate = data.creation_date
        ? new Date(data.creation_date).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
        })
        : '—';
    // ISA -- the creator's authorship affirmation signed at Card 1. This is
    // the CoA's signature event; once signed, it stands independently of any
    // future deed mint or purchase.
    const esignedAt = data.isa_signed_at
        ? new Date(data.isa_signed_at).toLocaleString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
        })
        : null;
    return (
        <details className="bg-base-200 rounded-md group">
            <summary className="cursor-pointer px-4 py-2 text-sm text-center list-none flex items-center justify-center select-none text-base-content/55">
                <span>Certificate of Authenticity</span>
                <span className="ml-2 text-base-content/40 text-xs transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div className="font-deed px-6 pb-6 pt-2 space-y-4 text-base-content/80">
                <p className="text-justify leading-relaxed">
                    This is to certify that the digital photograph identified herein,
                    titled <em>{title}</em>, is an original and authentic work created
                    by <strong>{creator}</strong> on {creationDate}, and offered through
                    the Epimage Gallery as a unique (1 of 1) limited edition.
                </p>

                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs pt-2 border-t border-base-300">
                    <span className="text-base-content/50">Title</span>
                    <span>{title}</span>
                    <span className="text-base-content/50">Creator</span>
                    <span>{creator}</span>
                    <span className="text-base-content/50">Creation date</span>
                    <span>{creationDate}</span>
                    <span className="text-base-content/50">Edition</span>
                    <span>{data.edition || 'Unique (1 of 1)'}</span>
                    <span className="text-base-content/50">Image ID</span>
                    <span className="font-mono">{data.image_id}</span>
                    <span className="text-base-content/50">eSigned by creator</span>
                    <span>
                        {esignedAt
                            ? esignedAt
                            : data.deed_asset_id
                                // Deed exists -> the creator HAS signed by definition
                                // (the deed could not mint without the Card 1 ESIGN
                                // affirmation per R62 §3.4). Specific timestamp
                                // missing only when the signature event ID didn't
                                // get linked to the image row (legacy / seed data).
                                ? <span>Affirmed by creator</span>
                                : <span className="text-base-content/40">Pending creator signature</span>}
                    </span>
                </div>
            </div>
        </details>
    );
}

// Redaction marker for fields that aren't known yet (mostly pre-sale). The
// user requested *******; matched on null from the API.
const REDACTED = '*******';

function redact(v: string | null | undefined): string {
    return v == null || v === '' ? REDACTED : v;
}

// Full-hash display. Same monospace styling as the pHash row; font shrunk so
// the 64-char SHA-256 fits inside the card on one line at typical widths and
// wraps character-by-character on narrower screens via break-all (hex strings
// have no natural break points).
function HashCell({ value }: { value: string }) {
    return (
        <span className="font-mono text-[9px] leading-snug break-all">
            {value}
        </span>
    );
}

function DeedPanel({ data }: { data: ImageData }) {
    // Post-purchase: deed has been minted -> swap the ******* placeholder for
    // a subtle "—" so the panel doesn't look noisy when most fields are real.
    const isPostPurchase = data.deed_asset_id !== null;
    const cell = (v: string | null | undefined): React.ReactNode =>
        v
            ? v
            : isPostPurchase
                ? <span className="text-base-content/40">—</span>
                : <span className="font-mono">{REDACTED}</span>;
    const creator = data.creator.display_name;
    const title = data.title || 'Untitled';
    const creationDate = data.creation_date
        ? new Date(data.creation_date).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
        })
        : REDACTED;
    const mintedAt = data.deed_minted_at
        ? new Date(data.deed_minted_at).toLocaleString()
        : REDACTED;

    return (
        <details className="bg-base-200 rounded-md group">
            <summary className="cursor-pointer px-4 py-2 text-sm text-center list-none flex items-center justify-center select-none text-base-content/55">
                <span>Deed of Ownership</span>
                <span className="ml-2 text-base-content/40 text-xs transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div className="font-deed px-6 pb-6 pt-2 space-y-4 text-base-content/80">

                {/* Recitals */}
                <p className="text-justify leading-relaxed">
                    This Deed records the unique edition of <em>{title}</em>,
                    a digital photograph by <strong>{creator}</strong>, created
                    on {creationDate}. Ownership of this edition is conveyed to
                    the bearer at the moment of purchase and is permanently
                    anchored on the Solana blockchain, providing an immutable
                    record of title and provenance.
                </p>

                {/* Rights granted */}
                <section className="space-y-2">
                    <h4 className="text-xs uppercase tracking-widest text-base-content/50">
                        Rights of the Owner
                    </h4>
                    <p className="text-justify leading-relaxed">
                        The bearer of this Deed holds the exclusive right to
                        display, exhibit, and privately enjoy the work in its
                        unique-edition form, and to transfer or resell the Deed
                        on any compatible venue. The creator retains all
                        copyright in the work; the owner's right is to the
                        edition itself and not to reproduction or commercial
                        use of the underlying image. Any such use remains in
                        violation of applicable copyright law.
                    </p>
                </section>

                {/* Royalty */}
                <section className="space-y-2">
                    <h4 className="text-xs uppercase tracking-widest text-base-content/50">
                        Resale Royalty
                    </h4>
                    <p className="text-justify leading-relaxed">
                        Upon any resale of the Deed,{' '}
                        <strong>{data.royalty_pct}%</strong> of the sale
                        proceeds are paid in perpetuity to{' '}
                        <strong>{data.royalty_recipient}</strong>, enforced at
                        the blockchain protocol level.
                    </p>
                </section>

                {/* Sale Record -- price + date are revealed only to the deed
                    owner (server-side gate via viewer_is_owner). Public
                    viewers never see what was paid; the field is omitted from
                    the JSON entirely. */}
                {data.purchase_price_cents !== null && (
                    <section className="space-y-2 pt-3 border-t border-base-300">
                        <h4 className="text-xs uppercase tracking-widest text-base-content/50">
                            Your Purchase
                        </h4>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                            <dt className="text-base-content/50">Price paid</dt>
                            <dd>${(data.purchase_price_cents / 100).toFixed(2)}</dd>
                            <dt className="text-base-content/50">Purchased on</dt>
                            <dd>{data.purchased_at ? new Date(data.purchased_at).toLocaleString() : cell(null)}</dd>
                        </dl>
                    </section>
                )}

                {/* Identification block */}
                <section className="space-y-2 pt-3 border-t border-base-300">
                    <h4 className="text-xs uppercase tracking-widest text-base-content/50">
                        Identification
                    </h4>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                        <dt className="text-base-content/50">Title</dt>
                        <dd>{title}</dd>
                        <dt className="text-base-content/50">Creator</dt>
                        <dd>{creator}</dd>
                        <dt className="text-base-content/50">Created on</dt>
                        <dd>{creationDate}</dd>
                        <dt className="text-base-content/50">Edition</dt>
                        <dd>{data.edition || 'Unique (1 of 1)'}</dd>
                        <dt className="text-base-content/50">Image ID</dt>
                        <dd className="font-mono">{data.image_id}</dd>
                    </dl>
                    {data.description && (
                        <div className="pt-2">
                            <p className="text-base-content/50 text-xs">Artist's statement</p>
                            <p className="text-xs whitespace-pre-line leading-relaxed pt-1">
                                {data.description}
                            </p>
                        </div>
                    )}
                </section>

                {/* On-chain record (R62 §2.3 deed_anchor fields) */}
                <section className="space-y-2 pt-3 border-t border-base-300">
                    <h4 className="text-xs uppercase tracking-widest text-base-content/50">
                        On-chain Record
                    </h4>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                        <dt className="text-base-content/50">Custody state</dt>
                        <dd>{cell(data.custody_state)}</dd>
                        <dt className="text-base-content/50">Legal state</dt>
                        <dd>{cell(data.legal_state)}</dd>
                        <dt className="text-base-content/50">Deed number</dt>
                        <dd className="font-mono truncate" title={data.deed_asset_id ?? ''}>
                            {data.deed_asset_id ? (
                                <a
                                    // cNFTs are Merkle-tree leaves, not on-chain accounts.
                                    // Solana Explorer's /address/ view resolves cNFT asset_ids
                                    // via DAS and renders the asset (owner, metadata, plugins)
                                    // when found, or "Account does not exist" honestly when
                                    // DAS hasn't indexed yet. xray's /token/ route falls back
                                    // to an empty "0 SOL" account view which reads misleadingly.
                                    // TODO: drive ?cluster from a VITE_SOLANA_NETWORK env var at mainnet deploy.
                                    href={`https://explorer.solana.com/address/${data.deed_asset_id}?cluster=devnet`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="link link-hover"
                                >
                                    {data.deed_asset_id}
                                </a>
                            ) : (
                                cell(null)
                            )}
                        </dd>
                        <dt className="text-base-content/50">Owner wallet</dt>
                        <dd className="font-mono truncate" title={data.deed_owner_wallet ?? ''}>
                            {cell(data.deed_owner_wallet)}
                        </dd>
                        <dt className="text-base-content/50">Minted at</dt>
                        <dd>{data.deed_minted_at ? mintedAt : cell(null)}</dd>
                        <dt className="text-base-content/50">Arweave URI</dt>
                        <dd className="font-mono truncate" title={data.arweave_uri ?? ''}>
                            {data.arweave_uri ? (
                                // Display text is the canonical permanent
                                // arweave.net URL (verifiable, survives
                                // platform cessation). Click target is the
                                // platform proxy /a/<imageId> which streams
                                // the Arweave bytes back with a friendly
                                // Content-Disposition filename (es0rx.zip)
                                // so the buyer's browser saves a recognized
                                // file. Post-cessation the proxy is gone;
                                // the canonical arweave.net URL still resolves
                                // and the buyer fetches directly with a
                                // recovery client. Per D-19.
                                <a
                                    href={`/a/${data.image_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="link link-hover"
                                    title="Click to download (proxied); displayed text is the permanent Arweave URI"
                                >
                                    {data.arweave_uri}
                                </a>
                            ) : (
                                cell(null)
                            )}
                        </dd>
                        <dt className="text-base-content/50">SHA-256 (M+00)</dt>
                        <dd className="font-mono">
                            {data.sha256 ? <HashCell value={data.sha256} /> : cell(null)}
                        </dd>
                        <dt className="text-base-content/50">pHash (M+00)</dt>
                        <dd className="font-mono">
                            {data.phash ? <HashCell value={data.phash} /> : cell(null)}
                        </dd>
                    </dl>
                </section>

                {/* Technical specification (R62 §2.3 image_spec, Card 2 ingestion) */}
                <section className="space-y-2 pt-3 border-t border-base-300">
                    <h4 className="text-xs uppercase tracking-widest text-base-content/50">
                        Technical Specification
                    </h4>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                        <dt className="text-base-content/50">Dimensions</dt>
                        <dd>
                            {data.image_spec
                                ? `${data.image_spec.width_px} × ${data.image_spec.height_px} px`
                                : cell(null)}
                        </dd>
                        <dt className="text-base-content/50">Color space</dt>
                        <dd>{cell(data.image_spec?.color_space)}</dd>
                        <dt className="text-base-content/50">ICC profile</dt>
                        <dd className="font-mono">{cell(data.image_spec?.icc_profile)}</dd>
                        <dt className="text-base-content/50">Color depth</dt>
                        <dd>
                            {data.image_spec
                                ? `${data.image_spec.color_depth_bits}-bit`
                                : cell(null)}
                        </dd>
                        <dt className="text-base-content/50">File type</dt>
                        <dd>{cell(data.image_spec?.file_type)}</dd>
                        <dt className="text-base-content/50">File size</dt>
                        <dd>
                            {data.image_spec
                                ? `${data.image_spec.file_size_bytes.toLocaleString()} bytes`
                                : cell(null)}
                        </dd>
                    </dl>
                </section>

                {!isPostPurchase && (
                    <p className="pt-2 italic text-xs text-base-content/50">
                        Fields shown as <span className="font-mono">*******</span> are filled after deed is issued.
                    </p>
                )}
            </div>
        </details>
    );
}

// ISA gate row. Affirmation copy stays visible always (ESIGN: user must see
// what they're binding to whether the click is pending or completed). Button
// label toggles 'Sign affirmation' -> 'Signed' on completion; the signed
// date surfaces as a tooltip on the disabled signed button.
const ISA_AFFIRMATION =
    'I affirm that this image complies with my Creator Agreement [v1.0], ' +
    'including its representations on authorship, rights, and third-party ' +
    'clearances, and I authorize its sale on Epimage.';

function IsaRow({
    signedAt,
    signing,
    onSign,
}: {
    signedAt: string | null;
    signing: boolean;
    onSign: () => void;
}) {
    return (
        <div className="bg-base-200 rounded-md pl-4 pr-1 py-2 text-sm flex items-start gap-3">
            <span className="flex-1 leading-relaxed">{ISA_AFFIRMATION}</span>
            {signedAt ? (
                <button
                    type="button"
                    disabled
                    title={`Signed on ${new Date(signedAt).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', year: 'numeric',
                        hour: 'numeric', minute: '2-digit',
                    })}`}
                    className="btn btn-sm btn-success shrink-0"
                >
                    ✓ Signed
                </button>
            ) : (
                <button
                    type="button"
                    onClick={onSign}
                    disabled={signing}
                    className="btn btn-sm btn-neutral shrink-0"
                >
                    {signing ? 'Signing…' : 'Sign affirmation'}
                </button>
            )}
        </div>
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

function Page({
    data,
    state,
    creatorAction,
}: {
    data: ImageData;
    state: RenderState;
    creatorAction?: React.ReactNode;
}) {
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
            {creatorAction}
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
                    to={`/c/${data.creator.youtube_channel_handle.replace(/^@/, '')}`}
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

// Share the canonical listing URL. Available to every viewer (anon, buyer,
// owner, creator) -- the URL `<origin>/<image_id>` is the public-facing handle
// and resolves to whichever render state the recipient's session warrants.
// Uses navigator.clipboard.writeText; falls back to a tiny textarea+execCommand
// trick for non-secure contexts (file:// previews, older Safari) so the button
// still does something useful when the Clipboard API is gated.
function ShareButton({ imageId }: { imageId: string }) {
    const [copied, setCopied] = useState(false);
    const onShare = useCallback(async () => {
        const url = `${window.location.origin}/${imageId}`;
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* swallow -- best effort */ }
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [imageId]);
    return (
        <button
            type="button"
            onClick={onShare}
            title="Copy link to this image"
            className="bg-base-200 rounded-md px-4 py-2 text-sm hover:bg-base-300"
        >
            {copied ? 'Link copied' : 'Share'}
        </button>
    );
}

// Buy-button click. Anon viewer -> bounce to /signin with a `?return=` so the
// listing page is restored after auth completes. Signed-in viewer -> open the
// caller's Stripe Embedded Checkout modal via `onSignedIn`. The modal state
// lives in the calling component so the click handler stays pure.
// Buy click. Always opens the wizard via the caller's onOpen callback --
// the wizard's welcome step handles sign-in inline (it triggers Magic
// OAuth itself when the buyer is anon). No more page redirect to /signin.
function handleBuyClick(
    _imageId: string,
    _navigate: NavigateFunction,
    onOpen?: () => void,
): void {
    if (onOpen) onOpen();
}

function ConversionBar({ data, isPresale }: { data: ImageData; isPresale: boolean }) {
    const navigate = useNavigate();
    const priceUSD =
        data.listed_price_cents !== null ? (data.listed_price_cents / 100).toFixed(0) : null;
    return (
        <div className="card bg-base-200">
            <div className="card-body gap-4">
                {priceUSD !== null && <p className="text-2xl font-light">${priceUSD}</p>}
                <div className="flex flex-col gap-2">
                    {isPresale && (
                        <button
                            type="button"
                            disabled={data.is_creator}
                            title={data.is_creator ? 'You created this image -- self-purchase is not allowed.' : undefined}
                            onClick={() => handleBuyClick(data.image_id, navigate)}
                            className="btn btn-block"
                        >
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
                {data.deed_asset_id && (
                    <>
                        <dt>Deed</dt>
                        <dd className="font-mono text-xs truncate">{data.deed_asset_id}</dd>
                    </>
                )}
            </dl>
            <Link to={`/${data.image_id}/deed`} className="link link-hover">
                View deed →
            </Link>
        </section>
    );
}

// reCAPTCHA Enterprise loader. Cached promise so the script only ever loads
// once per page session even if multiple report modals open/close.
let recaptchaScriptPromise: Promise<void> | null = null;
function loadRecaptchaScript(siteKey: string): Promise<void> {
    if (recaptchaScriptPromise) return recaptchaScriptPromise;
    if ((window as any).grecaptcha?.enterprise) return Promise.resolve();
    recaptchaScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            // grecaptcha.enterprise.ready resolves once the SDK is fully initialized
            // (separate from script DOM-load completion).
            const grecaptcha = (window as any).grecaptcha;
            if (grecaptcha?.enterprise?.ready) {
                grecaptcha.enterprise.ready(() => resolve());
            } else {
                resolve();
            }
        };
        script.onerror = () => {
            recaptchaScriptPromise = null;
            reject(new Error('Failed to load reCAPTCHA Enterprise script'));
        };
        document.head.appendChild(script);
    });
    return recaptchaScriptPromise;
}

type ReportReason = 'rights' | 'safety' | 'fraud' | 'quality' | 'other';
const REPORT_REASONS: { value: ReportReason; label: string }[] = [
    { value: 'rights', label: 'Copyright / rights claim' },
    { value: 'safety', label: 'Safety / minors / harmful content' },
    { value: 'fraud', label: 'Fraud / impersonation' },
    { value: 'quality', label: 'Off-brand / low quality' },
    { value: 'other', label: 'Other' },
];

function FooterReport({ imageId }: { imageId: string }) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState<ReportReason>('rights');
    const [description, setDescription] = useState('');
    const [email, setEmail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const siteKey = (import.meta as any).env?.VITE_RECAPTCHA_SITE_KEY as string | undefined;

    // Pre-warm the reCAPTCHA script when the modal opens so the token-mint
    // call on Submit doesn't pay the full cold-start latency.
    useEffect(() => {
        if (!open || !siteKey) return;
        loadRecaptchaScript(siteKey).catch(err => {
            console.warn('[recaptcha] preload failed:', err);
        });
    }, [open, siteKey]);

    function reset() {
        setReason('rights');
        setDescription('');
        setEmail('');
        setError(null);
        setSuccess(false);
        setSubmitting(false);
    }

    async function handleSubmit() {
        if (submitting) return;
        if (!siteKey) {
            setError('Report system not configured. Please contact support.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await loadRecaptchaScript(siteKey);
            const grecaptcha = (window as any).grecaptcha;
            const token: string = await grecaptcha.enterprise.execute(siteKey, { action: 'submit_report' });
            const resp = await fetch(`/v1/images/${encodeURIComponent(imageId)}/report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reason,
                    description: description.trim() || undefined,
                    email: email.trim() || undefined,
                    recaptcha_token: token,
                }),
            });
            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                const friendly = messageForReportError(body.error, resp.status);
                throw new Error(body.error ? `${friendly} [${body.error}]` : friendly);
            }
            setSuccess(true);
        } catch (e: any) {
            setError(e?.message ?? 'Could not submit report.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <footer className="mt-12 text-center">
            <button
                type="button"
                onClick={() => {
                    reset();
                    setOpen(true);
                }}
                className="text-[11px] text-base-content/30 hover:text-base-content/60 underline-offset-2 hover:underline transition-colors bg-transparent border-0 p-0 cursor-pointer"
            >
                Report this image
            </button>
            {open && (
                <div
                    className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4"
                    onClick={() => setOpen(false)}
                >
                    <div
                        className="bg-base-100 rounded-md shadow-lg max-w-md w-full p-6 space-y-4 text-left"
                        onClick={e => e.stopPropagation()}
                    >
                        {success ? (
                            <>
                                <h2 className="text-lg font-light">Report received</h2>
                                <p className="text-sm text-base-content/70">
                                    Thanks. Our moderation team will review it shortly. You won't
                                    receive a confirmation email unless you provided one.
                                </p>
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => setOpen(false)}
                                        className="btn btn-sm"
                                    >
                                        Close
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 className="text-lg font-light">Report this image</h2>
                                <p className="text-xs text-base-content/60">
                                    Image ID: <span className="font-mono">{imageId}</span>
                                </p>
                                <label className="form-control">
                                    <span className="label-text text-sm">Reason</span>
                                    <select
                                        value={reason}
                                        onChange={e => setReason(e.target.value as ReportReason)}
                                        className="select select-bordered select-sm"
                                        disabled={submitting}
                                    >
                                        {REPORT_REASONS.map(r => (
                                            <option key={r.value} value={r.value}>{r.label}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="form-control">
                                    <span className="label-text text-sm">Description (optional)</span>
                                    <textarea
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        rows={4}
                                        maxLength={2000}
                                        placeholder="Anything you want our moderators to know."
                                        className="textarea textarea-bordered text-sm"
                                        disabled={submitting}
                                    />
                                </label>
                                <label className="form-control">
                                    <span className="label-text text-sm">
                                        Email <span className="text-base-content/40">(optional, for follow-up)</span>
                                    </span>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        maxLength={254}
                                        placeholder="you@example.com"
                                        className="input input-bordered input-sm"
                                        disabled={submitting}
                                    />
                                </label>
                                {error && (
                                    <div className="alert alert-error text-xs py-2">{error}</div>
                                )}
                                <div className="flex items-center justify-between pt-2">
                                    <p className="text-[10px] text-base-content/40">
                                        Protected by reCAPTCHA.
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setOpen(false)}
                                            className="btn btn-ghost btn-sm"
                                            disabled={submitting}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSubmit}
                                            disabled={submitting}
                                            className="btn btn-primary btn-sm"
                                        >
                                            {submitting ? 'Submitting…' : 'Submit report'}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </footer>
    );
}

function messageForReportError(code: string | undefined, httpStatus: number): string {
    switch (code) {
        case 'IMAGE_NOT_FOUND': return 'This image no longer exists.';
        case 'INVALID_REASON': return 'Please pick a reason.';
        case 'MISSING_RECAPTCHA_TOKEN': return 'Bot check did not complete. Please retry.';
        case 'RECAPTCHA_LOW_SCORE': return 'We could not verify the submission. If you keep seeing this, please email us directly.';
        case 'RECAPTCHA_TOKEN_INVALID':
        case 'RECAPTCHA_ACTION_MISMATCH':
        case 'RECAPTCHA_HTTP_ERROR':
            return 'Verification failed. Please retry in a moment.';
        case 'RECAPTCHA_NOT_CONFIGURED': return 'Report system temporarily unavailable.';
        default: return `Could not submit report (HTTP ${httpStatus}).`;
    }
}
