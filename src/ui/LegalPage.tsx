// LegalPage.tsx
// Renders /privacy and /tos by fetching the markdown text from the same
// /v1/legal/:type endpoint used by the ESIGN modals. Single source of truth.
// Markdown is rendered as <pre>-wrapped text -- no parser dep at MVP. The
// content was written to read reasonably as plain text either way.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LegalDocType } from '../cert/legal';

interface LegalDoc {
    type: string;
    label: string;
    hash: string;
    text: string;
}

export default function LegalPage({ docType, title }: { docType: LegalDocType; title: string }) {
    const [doc, setDoc] = useState<LegalDoc | null>(null);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
        fetch(`/v1/legal/${docType}`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
            .then(setDoc)
            .catch(e => setErr(e?.message ?? 'Failed to load.'));
    }, [docType]);
    return (
        <main className="min-h-screen mx-auto max-w-3xl px-4 py-8 lg:py-12 space-y-6">
            <header className="flex items-center justify-between gap-3">
                <h1 className="text-2xl font-light tracking-tight">{title}</h1>
                <Link to="/" className="link link-hover text-sm">← Home</Link>
            </header>
            {err && <p className="text-sm text-error">{err}</p>}
            {doc && (
                <>
                    <p className="text-xs text-base-content/50">
                        Version {doc.label} · hash <code className="font-mono">{doc.hash.slice(0, 16)}…</code>
                    </p>
                    <article className="font-deed whitespace-pre-wrap text-sm leading-relaxed">
                        {doc.text}
                    </article>
                </>
            )}
        </main>
    );
}
