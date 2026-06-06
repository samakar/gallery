// BuyWizard.tsx
// Unified buy flow inside a single modal. Replaces the previous EsignModal +
// CheckoutModal + MonogramModal stack. Walks the buyer through:
//   1. welcome   -- "sign in to sign ownership documents" + Continue with Google
//   2. contracts -- bundled MJA + per-image License Acceptance click-wrap
//   3. payment   -- Stripe Embedded Checkout (Managed Payments)
//   4. monogram  -- buyer enters 1-3 letters; on confirm we POST start-build
//   5. building  -- transient progress while runImageOps + Crossmint resolve
//
// Magic OAuth requires a full-page redirect, which would destroy in-memory
// wizard state. We persist the active state to sessionStorage just before
// triggering loginWithRedirect; AuthCallback resumes by navigating back to
// `<image_id>?buy=resume`, and we restore from sessionStorage on mount.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { api, getActiveRole } from './api';
import { magic } from './magic';

// sessionStorage keys. WIZARD_STATE_KEY is retained for backward-compat with
// any in-flight redirect sessions (pre-popup); new sign-ins via popup don't
// write it. ESIGN_RESULT_KEY survives the payment-step iframe transition.
const WIZARD_STATE_KEY = 'buy-wizard-state';
const ESIGN_RESULT_KEY = 'buy-wizard-esign';

// Same cache as CheckoutModal -- the Stripe.js script gets fetched once.
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeLoaded(): Promise<StripeJs | null> {
    if (!stripePromise) {
        stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : Promise.resolve(null);
    }
    return stripePromise;
}

type Step = 'welcome' | 'contracts' | 'payment' | 'monogram' | 'building' | 'failed';

interface PersistedState {
    image_id: string;
    step: Step;
}

interface LegalDoc {
    type: string;
    label: string;
    hash: string;
    text: string;
}

interface EsignResult {
    mja_signature_id: string | null;
    license_signature_id: string;
}

export interface BuyWizardProps {
    imageId: string;
    onClose: () => void;
    // Called when the buyer has marked the image (monogram chosen, build
    // attempted). `dispatchError` is null on a clean dispatch; a string when
    // the build endpoint errored (e.g. Arweave out of credits). The caller
    // closes the wizard and surfaces the error on the owner page with a
    // Retry affordance so the dispatch can be re-attempted without re-paying.
    onComplete: (dispatchError: string | null) => void;
    // Optional override -- used by the ListingPage when a Stripe `?paid=` URL
    // lands and we need to recover an already-paid purchase at the monogram
    // step (skipping welcome / contracts / payment).
    initialStep?: Step;
}

export function BuyWizard({ imageId, onClose, onComplete, initialStep }: BuyWizardProps) {
    // Determine starting step:
    //   - Caller-supplied initialStep wins (recovery from a paid-but-stranded
    //     purchase).
    //   - Resumed from OAuth: read from sessionStorage and advance to contracts.
    //   - Already signed in: skip welcome, start at contracts directly.
    //   - Anon: welcome.
    const [step, setStep] = useState<Step>(() => {
        if (initialStep) return initialStep;
        const persisted = readPersisted();
        if (persisted && persisted.image_id === imageId) {
            sessionStorage.removeItem(WIZARD_STATE_KEY);
            return getActiveRole() ? 'contracts' : 'welcome';
        }
        return getActiveRole() ? 'contracts' : 'welcome';
    });
    const [error, setError] = useState<string | null>(null);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-base-100 rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <header className="px-5 py-3 border-b border-base-300 flex items-center justify-between shrink-0">
                    <h3 className="font-semibold">{titleFor(step)}</h3>
                    <button type="button" onClick={onClose} aria-label="Close" className="btn btn-sm btn-ghost">
                        ✕
                    </button>
                </header>
                <ProgressStrip current={step} />
                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {error && <p className="text-sm text-error mb-3">{error}</p>}
                    {step === 'welcome' && (
                        <WelcomeStep
                            imageId={imageId}
                            onError={setError}
                        />
                    )}
                    {step === 'contracts' && (
                        <ContractsStep
                            imageId={imageId}
                            onSigned={result => {
                                // Survive a potential payment-step refresh.
                                sessionStorage.setItem(ESIGN_RESULT_KEY, JSON.stringify(result));
                                setStep('payment');
                            }}
                            onError={setError}
                        />
                    )}
                    {step === 'payment' && (
                        <PaymentStep
                            imageId={imageId}
                            onCompleted={() => setStep('monogram')}
                            onError={setError}
                        />
                    )}
                    {step === 'monogram' && (
                        <MonogramStep
                            onConfirmed={dispatchError => {
                                sessionStorage.removeItem(ESIGN_RESULT_KEY);
                                onComplete(dispatchError);
                            }}
                            onError={setError}
                        />
                    )}
                    {step === 'building' && (
                        <BuildingPanel />
                    )}
                    {step === 'failed' && (
                        <p className="text-sm text-error">{error ?? 'Something went wrong.'}</p>
                    )}
                </div>
            </div>
        </div>
    );
}

function titleFor(step: Step): string {
    switch (step) {
        case 'welcome': return 'Sign in';
        case 'contracts': return 'Sign documents';
        case 'payment': return 'Payment';
        case 'monogram': return 'Personalize your edition';
        case 'building': return 'Issuing your deed';
        case 'failed': return 'Something went wrong';
    }
}

function ProgressStrip({ current }: { current: Step }) {
    const order: Step[] = ['welcome', 'contracts', 'payment', 'monogram'];
    const idx = order.indexOf(current);
    return (
        <div className="px-5 py-2 flex items-center gap-2 text-xs text-base-content/60 border-b border-base-300 shrink-0">
            {order.map((s, i) => (
                <span key={s} className="flex items-center gap-2">
                    <span className={i === idx ? 'text-base-content font-semibold' : ''}>
                        {i + 1}. {titleFor(s)}
                    </span>
                    {i < order.length - 1 && <span className="text-base-content/30">·</span>}
                </span>
            ))}
        </div>
    );
}

// -------------------------------------------------------------------
// Step 1: Welcome / sign-in
// -------------------------------------------------------------------

function WelcomeStep({
    imageId,
    onError,
}: {
    imageId: string;
    onError: (e: string | null) => void;
}) {
    const [busy, setBusy] = useState(false);
    const onContinue = async () => {
        setBusy(true);
        onError(null);
        // Persist wizard state so the post-redirect mount can resume at the
        // contracts step. Cleared on resume in the BuyWizard initializer.
        const state: PersistedState = { image_id: imageId, step: 'contracts' };
        sessionStorage.setItem(WIZARD_STATE_KEY, JSON.stringify(state));
        // AuthCallback reads `post-signin-return` to bring the browser back
        // to this listing with `?buy=resume`, which auto-reopens the wizard.
        sessionStorage.setItem('post-signin-return', `/${imageId}?buy=resume`);
        try {
            await magic.oauth2.loginWithRedirect({
                provider: 'google',
                redirectURI: `${window.location.origin}/auth/callback`,
            });
            // Page leaves here on success; the catch only fires on errors
            // before navigation (e.g. Magic config issues).
        } catch (e: any) {
            setBusy(false);
            sessionStorage.removeItem(WIZARD_STATE_KEY);
            sessionStorage.removeItem('post-signin-return');
            const raw = String(e?.message ?? e ?? '');
            const code = e?.code as number | undefined;
            const friendly =
                code === -32603 || raw.includes('RPC route not enabled') || raw.includes('provider not supported')
                    ? 'Google sign-in is not yet configured. Contact support.'
                    : raw || 'Sign-in failed. Try again.';
            onError(friendly);
        }
    };
    return (
        <div className="space-y-4">
            <p className="text-sm">
                Before you can buy this edition you'll need to sign in. We use
                your sign-in to bind your name to the on-chain ownership documents
                and to send your purchase receipt.
            </p>
            <p className="text-sm text-base-content/60">
                You'll review and electronically sign the ownership documents in
                the next step, then enter payment, then choose your monogram.
            </p>
            <button
                type="button"
                onClick={onContinue}
                disabled={busy}
                className="btn btn-neutral btn-block"
            >
                {busy ? 'Redirecting…' : 'Continue with Google'}
            </button>
            <p className="text-xs text-base-content/50 text-center">
                You'll briefly leave this page to sign in with Google,
                then come back here to continue.
            </p>
        </div>
    );
}

// -------------------------------------------------------------------
// Step 2: Contracts (MJA + License Acceptance)
// -------------------------------------------------------------------

function ContractsStep({
    imageId,
    onSigned,
    onError,
}: {
    imageId: string;
    onSigned: (r: EsignResult) => void;
    onError: (e: string | null) => void;
}) {
    const [mja, setMja] = useState<LegalDoc | null>(null);
    const [license, setLicense] = useState<LegalDoc | null>(null);
    const [needsMja, setNeedsMja] = useState(true);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [active, setActive] = useState<'mja' | 'license'>('mja');
    const [agreed, setAgreed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            api<{ has_mja: boolean }>('/v1/me/esign-status').catch(() => ({ has_mja: false })),
            api<LegalDoc>('/v1/legal/LICENSE_ACCEPTANCE'),
        ])
            .then(async ([status, l]) => {
                if (cancelled) return;
                setLicense(l);
                setNeedsMja(!status.has_mja);
                if (!status.has_mja) {
                    const m = await api<LegalDoc>('/v1/legal/MJA');
                    if (!cancelled) setMja(m);
                    if (!cancelled) setActive('mja');
                } else {
                    setActive('license');
                }
            })
            .catch(e => { if (!cancelled) onError(e?.message ?? 'Failed to load documents.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [onError]);

    const onSign = async () => {
        setSubmitting(true);
        onError(null);
        try {
            let mjaSigId: string | null = null;
            if (needsMja) {
                const r = await api<{ signature_id: string }>('/v1/signatures', {
                    method: 'POST',
                    body: JSON.stringify({ document_type: 'MJA' }),
                });
                mjaSigId = r.signature_id;
            }
            const r = await api<{ signature_id: string }>('/v1/signatures', {
                method: 'POST',
                body: JSON.stringify({ document_type: 'LICENSE_ACCEPTANCE', image_id: imageId }),
            });
            onSigned({ mja_signature_id: mjaSigId, license_signature_id: r.signature_id });
        } catch (e: any) {
            onError(e?.message ?? 'Sign failed.');
            setSubmitting(false);
        }
    };

    if (loading) return <span className="loading loading-spinner" />;

    const tabs = [
        needsMja ? { id: 'mja' as const, label: 'Master Joint Agreement', doc: mja } : null,
        { id: 'license' as const, label: 'License Acceptance', doc: license },
    ].filter(Boolean) as Array<{ id: 'mja' | 'license'; label: string; doc: LegalDoc | null }>;

    return (
        <div className="space-y-3">
            {tabs.length > 1 && (
                <div role="tablist" className="tabs tabs-bordered">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            onClick={() => setActive(t.id)}
                            className={`tab ${active === t.id ? 'tab-active' : ''}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            )}
            {(() => {
                const doc = tabs.find(t => t.id === active)?.doc;
                if (!doc) return null;
                return (
                    <div className="space-y-2">
                        <p className="text-xs text-base-content/50">
                            Version {doc.label} · hash <code className="font-mono text-[10px]">{doc.hash.slice(0, 16)}…</code>
                        </p>
                        <div className="bg-base-200 rounded-md max-h-72 overflow-y-auto p-3 whitespace-pre-wrap font-mono text-xs">
                            {doc.text}
                        </div>
                    </div>
                );
            })()}
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none pt-2">
                <input
                    type="checkbox"
                    checked={agreed}
                    onChange={e => setAgreed(e.target.checked)}
                    className="checkbox checkbox-sm"
                />
                <span>
                    I have read{' '}
                    {needsMja && <><strong>the Master Joint Agreement</strong> and{' '}</>}
                    <strong>the License Acceptance</strong> and agree to be legally bound.
                </span>
            </label>
            <button
                type="button"
                disabled={!agreed || submitting}
                onClick={onSign}
                className="btn btn-neutral btn-block"
            >
                {submitting ? 'Signing…' : 'Sign and continue to payment'}
            </button>
        </div>
    );
}

// -------------------------------------------------------------------
// Step 3: Payment (Stripe Embedded Checkout)
// -------------------------------------------------------------------

function PaymentStep({
    imageId,
    onCompleted,
    onError,
}: {
    imageId: string;
    onCompleted: () => void;
    onError: (e: string | null) => void;
}) {
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [purchaseId, setPurchaseId] = useState<string | null>(null);

    useEffect(() => {
        const raw = sessionStorage.getItem(ESIGN_RESULT_KEY);
        if (!raw) {
            onError('Lost the sign-document state. Please go back and try again.');
            return;
        }
        const sigs = JSON.parse(raw) as EsignResult;
        let cancelled = false;
        api<{ client_secret: string; purchase_id: string }>('/v1/purchases', {
            method: 'POST',
            body: JSON.stringify({
                image_id: imageId,
                mja_signature_id: sigs.mja_signature_id,
                license_signature_id: sigs.license_signature_id,
            }),
        })
            .then(d => { if (!cancelled) { setClientSecret(d.client_secret); setPurchaseId(d.purchase_id); } })
            .catch(e => { if (!cancelled) onError(e?.message ?? 'Failed to start checkout.'); });
        return () => { cancelled = true; };
    }, [imageId, onError]);

    // Remember purchase_id for the monogram step so we don't have to re-derive.
    useEffect(() => {
        if (purchaseId) sessionStorage.setItem('buy-wizard-purchase-id', purchaseId);
    }, [purchaseId]);

    if (!clientSecret) return <span className="loading loading-spinner" />;
    // Stripe Embedded Checkout is cross-origin iframe -- we can't restyle
    // its insides with CSS. A wrapper transform:scale visually shrinks the
    // entire checkout (including fonts and click targets). Adjust SCALE if
    // the rendering feels too small/large.
    const SCALE = 0.85;
    return (
        <div style={{
            transform: `scale(${SCALE})`,
            transformOrigin: 'top center',
            width: `${100 / SCALE}%`,
            marginLeft: `${-(100 / SCALE - 100) / 2}%`,
            // Compensate for the height the scale visually removes so the
            // wizard's overflow-y container doesn't gain extra empty space.
            marginBottom: `${-(1 - SCALE) * 600}px`,
        }}>
            <EmbeddedCheckoutProvider
                stripe={getStripeLoaded()}
                options={{
                    clientSecret,
                    onComplete: onCompleted,
                }}
            >
                <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
        </div>
    );
}

// -------------------------------------------------------------------
// Step 4: Monogram
// -------------------------------------------------------------------

function MonogramStep({
    onConfirmed,
    onError,
}: {
    onConfirmed: (dispatchError: string | null) => void;
    onError: (e: string | null) => void;
}) {
    const [value, setValue] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const trimmed = value.trim().toUpperCase();
    const valid = trimmed.length >= 1 && trimmed.length <= 3;
    const purchaseId = sessionStorage.getItem('buy-wizard-purchase-id');

    const onConfirm = () => {
        if (!purchaseId) {
            onError('Missing purchase id.');
            return;
        }
        setSubmitting(true);
        // Fire-and-forget dispatch. If it succeeds the polling sees the
        // mint settle; if it fails for any infrastructure reason (Arweave
        // out of credits, Crossmint outage, network blip), the server's
        // stale-paid sweeper retries every minute until it lands. The
        // buyer's job is done -- they marked the image and chose a
        // monogram; deed issuance is the platform's problem.
        void api(`/v1/purchases/${purchaseId}/start-build`, {
            method: 'POST',
            body: JSON.stringify({ monogram_text: trimmed }),
        }).catch(e => {
            // Logged for telemetry only -- not surfaced to the buyer.
            // The sweeper will pick it up.
            console.warn('[BuyWizard] start-build dispatch error (sweeper will retry)', e?.message);
        });
        onConfirmed(null);
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-base-content/70">
                Choose 1–3 letters. They appear on your Share Copy inline with
                "1 of 1".
            </p>
            <input
                type="text"
                maxLength={3}
                value={value}
                onChange={e => setValue(e.target.value.replace(/[^A-Za-z]/g, ''))}
                placeholder="A"
                className="input input-bordered w-full text-center text-xl tracking-widest"
                autoFocus
                disabled={submitting}
            />
            <button
                type="button"
                disabled={!valid || submitting}
                onClick={onConfirm}
                className="btn btn-neutral btn-block"
            >
                {submitting ? 'Marking…' : 'Mark my image'}
            </button>
        </div>
    );
}

// -------------------------------------------------------------------
// Step 5 (transient): Building
// -------------------------------------------------------------------

function BuildingPanel() {
    return (
        <div className="flex items-center gap-3 py-6">
            <span className="loading loading-spinner" />
            <span className="text-sm">Issuing your deed…</span>
        </div>
    );
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function readPersisted(): PersistedState | null {
    const raw = sessionStorage.getItem(WIZARD_STATE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as PersistedState; } catch { return null; }
}

// Inform callers whether the page just landed from an OAuth resume so they
// can open the BuyWizard automatically. Implemented as a tiny helper that
// matches a `?buy=resume` query param plus a present wizard state.
export function shouldResumeBuyWizard(searchParams: URLSearchParams, imageId: string): boolean {
    if (searchParams.get('buy') !== 'resume') return false;
    const persisted = readPersisted();
    return persisted?.image_id === imageId;
}
