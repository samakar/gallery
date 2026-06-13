// EsignModal.tsx
// Bundled ESIGN click-wrap before checkout per R71 §2.4 step 3.
// Shows MJA (first purchase) + License Acceptance (every purchase) in tabs
// for review. Single Confirm captures both signatures, returns their ids.
// The Buy button caller chains directly into Stripe Embedded Checkout on
// success.

import { useEffect, useState } from 'react';
import { api } from './api';

interface LegalDoc {
    type: string;
    label: string;
    hash: string;
    text: string;
}

export interface EsignResult {
    mja_signature_id: string | null;     // null if buyer already has one on file
    license_signature_id: string;
}

export function EsignModal({
    imageId,
    needsMja,
    onConfirm,
    onCancel,
}: {
    imageId: string;
    needsMja: boolean;
    onConfirm: (result: EsignResult) => void;
    onCancel: () => void;
}) {
    const [mja, setMja] = useState<LegalDoc | null>(null);
    const [license, setLicense] = useState<LegalDoc | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'mja' | 'license'>(needsMja ? 'mja' : 'license');
    const [agreed, setAgreed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            needsMja ? api<LegalDoc>('/v1/legal/MJA') : Promise.resolve(null),
            api<LegalDoc>('/v1/legal/SAL'),
        ])
            .then(([m, l]) => {
                if (cancelled) return;
                setMja(m);
                setLicense(l);
            })
            .catch(e => { if (!cancelled) setErr(e?.message ?? 'Failed to load documents.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [needsMja]);

    const onSubmit = async () => {
        setSubmitting(true);
        setErr(null);
        try {
            let mjaSigId: string | null = null;
            if (needsMja) {
                const r = await api<{ signature_id: string }>('/v1/signatures', {
                    method: 'POST',
                    body: JSON.stringify({ document_type: 'MJA' }),
                });
                mjaSigId = r.signature_id;
            }
            const licenseRes = await api<{ signature_id: string }>('/v1/signatures', {
                method: 'POST',
                body: JSON.stringify({ document_type: 'SAL', image_id: imageId }),
            });
            onConfirm({ mja_signature_id: mjaSigId, license_signature_id: licenseRes.signature_id });
        } catch (e: any) {
            setErr(e?.message ?? 'Sign failed.');
            setSubmitting(false);
        }
    };

    const docs = [
        needsMja ? { id: 'mja' as const, label: 'Master Joint Agreement', doc: mja } : null,
        { id: 'license' as const, label: 'License Acceptance', doc: license },
    ].filter(Boolean) as Array<{ id: 'mja' | 'license'; label: string; doc: LegalDoc | null }>;

    return (
        <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={onCancel}
        >
            <div
                className="bg-base-100 rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <header className="px-5 py-3 border-b border-base-300 flex items-center justify-between">
                    <h3 className="font-semibold">Sign to continue</h3>
                    <button type="button" onClick={onCancel} aria-label="Close" className="btn btn-sm btn-ghost">
                        ✕
                    </button>
                </header>
                {docs.length > 1 && (
                    <div role="tablist" className="tabs tabs-bordered px-5 pt-2 shrink-0">
                        {docs.map(t => (
                            <button
                                key={t.id}
                                type="button"
                                role="tab"
                                onClick={() => setActiveTab(t.id)}
                                className={`tab ${activeTab === t.id ? 'tab-active' : ''}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                    {loading && <span className="loading loading-spinner" />}
                    {!loading && (() => {
                        const active = docs.find(t => t.id === activeTab)?.doc;
                        if (!active) return null;
                        return (
                            <div className="space-y-2">
                                <p className="text-xs text-base-content/50">
                                    Version {active.label} · hash <code className="font-mono text-[10px]">{active.hash.slice(0, 16)}…</code>
                                </p>
                                <article className="prose prose-sm max-w-none whitespace-pre-wrap font-mono text-xs">
                                    {active.text}
                                </article>
                            </div>
                        );
                    })()}
                </div>
                <footer className="px-5 py-3 border-t border-base-300 space-y-3 shrink-0">
                    {err && <p className="text-xs text-error">{err}</p>}
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={agreed}
                            onChange={e => setAgreed(e.target.checked)}
                            className="checkbox checkbox-sm"
                        />
                        <span>
                            I have read{' '}
                            {needsMja && (
                                <>
                                    <strong>the Master Joint Agreement</strong> and{' '}
                                </>
                            )}
                            <strong>the per-image License Acceptance</strong> and agree to be legally bound.
                        </span>
                    </label>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={!agreed || submitting || loading}
                            onClick={onSubmit}
                            className="btn btn-neutral btn-sm"
                        >
                            {submitting ? 'Signing…' : 'Sign and continue to payment'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
}
