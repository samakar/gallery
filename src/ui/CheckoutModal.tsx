// CheckoutModal.tsx
// Stripe Embedded Checkout modal opened by the Buy button on a listing page.
// Flow per R71 §2.4 / payments.md §2.1:
//   1. Mount -> POST /v1/purchases { image_id } -> { client_secret, purchase_id }
//   2. Render EmbeddedCheckoutProvider with the client_secret -> Stripe iframe
//      handles card entry + 3DS inside our DaisyUI modal shell.
//   3. After payment, Stripe redirects (via session return_url) to
//      `/<image_id>?checkout=<session_id>`. The listing page reads the query
//      param to render the confirmation state. This component just renders
//      the iframe up to that handoff.
//
// MJA + License Acceptance click-wrap (R71 §2.4 step 3) is not yet wired here
// -- the server's initCheckout has a TODO to gate on signed events.

import { useEffect, useState } from 'react';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { api } from './api';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

// Cache the loadStripe promise so re-renders don't re-fetch the script.
let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeLoaded(): Promise<StripeJs | null> {
    if (!stripePromise) {
        if (!publishableKey) {
            console.warn('[checkout] VITE_STRIPE_PUBLISHABLE_KEY is not set');
            stripePromise = Promise.resolve(null);
        } else {
            stripePromise = loadStripe(publishableKey);
        }
    }
    return stripePromise;
}

export interface CheckoutModalProps {
    imageId: string;
    onClose: () => void;
}

export function CheckoutModal({ imageId, onClose }: CheckoutModalProps) {
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        api<{ client_secret: string; purchase_id: string }>('/v1/purchases', {
            method: 'POST',
            body: JSON.stringify({ image_id: imageId }),
        })
            .then(d => { if (!cancelled) setClientSecret(d.client_secret); })
            .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to start checkout.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [imageId]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-base-100 rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-base-300">
                    <h3 className="font-semibold">Checkout</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-sm btn-ghost"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>
                <div className="p-5">
                    {loading && <span className="loading loading-spinner" />}
                    {error && (
                        <div className="alert alert-error text-sm">
                            <span>{error}</span>
                        </div>
                    )}
                    {clientSecret && (
                        <EmbeddedCheckoutProvider
                            stripe={getStripeLoaded()}
                            options={{ clientSecret }}
                        >
                            <EmbeddedCheckout />
                        </EmbeddedCheckoutProvider>
                    )}
                </div>
            </div>
        </div>
    );
}
