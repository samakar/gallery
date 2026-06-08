// RecoveryKey.tsx
// Static instructions page reached from welcome + COA emails. Plain-language
// framing for buyers who don't know web3: "your image lives in a permanent
// archive as a zip file; if Epimage ever goes down, you need a recovery key
// to open it." Button opens Magic's hosted portal in a new tab so the user
// can fetch the key with their email.

import { Link } from 'react-router-dom';

const MAGIC_PORTAL_URL = import.meta.env.VITE_MAGIC_PORTAL_URL as string | undefined;

export default function RecoveryKey() {
    const portalConfigured = !!MAGIC_PORTAL_URL;

    return (
        <main className="min-h-screen mx-auto max-w-2xl px-4 py-8 lg:py-12 space-y-8">
            <header className="flex items-center justify-between gap-3">
                <h1 className="text-2xl font-light tracking-tight">Your recovery key</h1>
                <Link to="/" className="link link-hover text-sm">← Home</Link>
            </header>

            <section className="space-y-4 text-sm leading-relaxed">
                <p>
                    Your image is stored in a permanent independent archive as a zipped file.
                    As long as Epimage is online, you can view and download it here without doing anything.
                </p>
                <p>
                    If Epimage ever goes down, you will need a <strong>recovery key</strong> to open the zip file
                    from the archive. We recommend you download and save it now -- once, somewhere safe -- to
                    ensure your permanent access.
                </p>
            </section>

            <section className="space-y-3">
                <h2 className="text-base font-semibold">How to download it</h2>
                <ol className="list-decimal list-inside space-y-2 text-sm leading-relaxed">
                    <li>Press the button below. A new tab will open.</li>
                    <li>Sign in with the same email you used here on Epimage.</li>
                    <li>Follow the steps to reveal your key, and save it somewhere safe -- a password manager, or printed and kept with your important documents.</li>
                </ol>
            </section>

            <section className="space-y-3">
                {portalConfigured ? (
                    <a
                        href={MAGIC_PORTAL_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary btn-block"
                    >
                        Download my recovery key
                    </a>
                ) : (
                    <div className="space-y-2">
                        <button type="button" disabled className="btn btn-block">
                            Download my recovery key
                        </button>
                        <p className="text-xs text-error">
                            <code className="font-mono">VITE_MAGIC_PORTAL_URL</code> is not configured.
                            Add it to <code className="font-mono">.env</code> and restart the dev server.
                        </p>
                    </div>
                )}
            </section>
        </main>
    );
}
