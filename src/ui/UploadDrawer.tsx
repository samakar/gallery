// UploadDrawer.tsx
// Right-side slide-in panel for multi-file upload.
// Design ref: /docs/ui_design.md §7 (/creator route).
//
// Each picked file runs validateClientSide (INV-09); on pass, POST /v1/images
// immediately persists the row and the parent's onUploaded callback prepends
// it to the grid behind the drawer (live feedback).

import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { validateClientSide, type ImageSpecResult } from '../cert/image_spec';
import { api, ApiError } from './api';

export interface UploadedImage {
    image_id: string;
    title: string;
    preview_url: string;
    status: string;
    visibility: string;
    listed_price_cents: number | null;
    created_at: string;
}

type CurrentState =
    | { kind: 'idle' }
    | { kind: 'validating' }
    | { kind: 'uploading' }
    | { kind: 'rejected'; code: string; message: string }
    | { kind: 'duplicate'; conflicting_image_id: string }
    | { kind: 'error'; message: string };

export default function UploadDrawer({
    open,
    onClose,
    onUploaded,
}: {
    open: boolean;
    onClose: () => void;
    onUploaded: (img: UploadedImage) => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [state, setState] = useState<CurrentState>({ kind: 'idle' });
    const [uploadedFilenames, setUploadedFilenames] = useState<string[]>([]);

    async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        // Mirror the server cap so we don't waste 50+ MB of upload bandwidth.
        const MAX_BYTES = 50 * 1024 * 1024;
        if (file.size > MAX_BYTES) {
            setState({
                kind: 'rejected',
                code: 'FILE_TOO_LARGE',
                message: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Images must be under 50 MB.`,
            });
            resetInput();
            return;
        }
        setState({ kind: 'validating' });

        let result: ImageSpecResult;
        try {
            result = await validateClientSide(file);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setState({ kind: 'error', message: `Validator threw: ${message}` });
            resetInput();
            return;
        }
        if (!result.ok) {
            setState({ kind: 'rejected', code: result.error_code, message: result.message });
            resetInput();
            return;
        }

        setState({ kind: 'uploading' });
        try {
            const fd = new FormData();
            fd.append('file', file);
            const created = await api<UploadedImage>('/v1/images', {
                method: 'POST',
                body: fd,
            });
            onUploaded(created);
            setUploadedFilenames(prev => [file.name, ...prev]);
            setState({ kind: 'idle' });
        } catch (err) {
            if (
                err instanceof ApiError &&
                err.body?.error === 'CREATOR_DUPLICATE' &&
                typeof err.body?.conflicting_image_id === 'string'
            ) {
                setState({
                    kind: 'duplicate',
                    conflicting_image_id: err.body.conflicting_image_id,
                });
            } else {
                const message = err instanceof Error ? err.message : String(err);
                setState({ kind: 'error', message: `Upload failed: ${message}` });
            }
        }
        resetInput();
    }

    function resetInput() {
        if (fileRef.current) fileRef.current.value = '';
    }

    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/40 transition-opacity z-40 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
                aria-hidden
            />
            {/* Panel */}
            <aside
                className={`fixed top-0 right-0 h-full w-full max-w-md bg-base-100 shadow-xl z-50 transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}
                aria-hidden={!open}
            >
                <div className="p-6 space-y-6 h-full overflow-y-auto">
                    <header className="flex items-center justify-between">
                        <h2 className="text-lg font-light">Upload images</h2>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                            Close
                        </button>
                    </header>
                    <p className="text-xs text-base-content/60">
                        JPEG only. Files appear in your grid as soon as they upload.
                    </p>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg"
                        className="file-input file-input-bordered w-full"
                        onChange={onPick}
                        disabled={state.kind === 'validating' || state.kind === 'uploading'}
                    />
                    <StatusView state={state} />
                    {uploadedFilenames.length > 0 && (
                        <section className="space-y-2 pt-4 border-t border-base-300">
                            <p className="text-xs text-base-content/60">
                                Uploaded this session:
                            </p>
                            <ul className="space-y-1 text-sm">
                                {uploadedFilenames.map((n, i) => (
                                    <li key={i} className="text-base-content/70 truncate">
                                        ✓ {n}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </div>
            </aside>
        </>
    );
}

function StatusView({ state }: { state: CurrentState }) {
    if (state.kind === 'idle') return null;
    if (state.kind === 'validating')
        return <p className="text-sm text-base-content/70">Checking image…</p>;
    if (state.kind === 'uploading')
        return <p className="text-sm text-base-content/70">Uploading…</p>;
    if (state.kind === 'rejected')
        return (
            <div className="alert alert-warning text-sm">
                <div className="flex flex-col gap-1">
                    <span>{state.message}</span>
                    <code className="font-mono text-xs text-base-content/60">{state.code}</code>
                </div>
            </div>
        );
    if (state.kind === 'duplicate')
        return (
            <div className="alert alert-warning text-sm">
                <span>
                    You already uploaded{' '}
                    <Link
                        to={`/${state.conflicting_image_id}`}
                        className="link link-hover font-semibold"
                    >
                        this image
                    </Link>
                    .
                </span>
            </div>
        );
    return <div className="alert alert-error text-sm">{state.message}</div>;
}
