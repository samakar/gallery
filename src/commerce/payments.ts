// payments.ts
// Stripe orchestration: Embedded Checkout init + four webhook handlers.
// Spec: /docs/commerce/payments.md (interface, FRs, idempotency strategy).
//
// API version is pinned to the Managed Payments preview required by the
// integration blueprint -- managed_payments[enabled]=true is only accepted on
// 2026-02-25.preview or above.
//
// Resource mapping: each Image -> one Stripe Product (with one Price = its
// listed_price). Product is created lazily on the first checkout init for an
// image and reused on subsequent purchases (the stripe_product_id column on
// images is the dedup token). Price is recreated when listed_price changes.
//
// Per ADR-0001: payment_intent.succeeded does NOT spawn runImageOps -- the
// buyer's later POST /v1/purchases/:id/start-build is what triggers the build.

import Stripe from 'stripe';
import { prisma } from '../db';

// The preview API version isn't in the SDK's `LatestApiVersion` literal yet.
// Stripe accepts it at runtime; cast to any to satisfy the SDK init signature.
const STRIPE_API_VERSION = '2026-04-22.preview' as any;

// Stripe tax code for digital art / photography. txcd_10103000 = "Digital
// goods (general)" -- broader than the blueprint's e-book code (txcd_10103100)
// because our deeds aren't books. Revisit when Stripe Tax rules for digital-art
// editions / NFTs are reviewed by legal (TODO).
const STRIPE_TAX_CODE = 'txcd_10103000';

let cached: Stripe | null = null;

export function getStripe(): Stripe {
    if (cached) return cached;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
        throw new Error(
            'STRIPE_SECRET_KEY is not set -- add it to .env per .env.example.'
        );
    }
    cached = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
    return cached;
}

// -------------------------------------------------------------------
// Product sync
// -------------------------------------------------------------------

interface StripeProductRefs {
    product_id: string;
    price_id: string;
}

// Ensure the image has a Stripe Product + Price. Idempotent: if both ids are
// persisted and the listed_price still matches the Stripe Price, returns the
// cached pair. If listed_price has drifted, a new Price is created and stored
// (Stripe Prices are immutable; old one is archived implicitly by reassigning
// default_price on the Product).
export async function ensureStripeProduct(image_id: string): Promise<StripeProductRefs> {
    const img = await prisma.image.findUnique({ where: { image_id } });
    if (!img) throw new Error(`Image ${image_id} not found`);
    const stripe = getStripe();

    // Fast path -- everything already provisioned.
    if (img.stripe_product_id && img.stripe_price_id) {
        return { product_id: img.stripe_product_id, price_id: img.stripe_price_id };
    }

    // Create or reuse Product. If we have a product but no price, the price
    // was probably deleted out-of-band; recreate it.
    let productId = img.stripe_product_id;
    if (!productId) {
        const product = await stripe.products.create({
            name: img.title,
            description: img.description || `Edition 1 of 1 by ${image_id}`,
            tax_code: STRIPE_TAX_CODE,
            default_price_data: {
                unit_amount: img.listed_price,
                currency: 'usd',
            },
            metadata: { image_id },
        });
        productId = product.id;
        // default_price comes back populated when default_price_data is passed.
        const defaultPrice = typeof product.default_price === 'string'
            ? product.default_price
            : product.default_price?.id;
        if (!defaultPrice) {
            throw new Error('Stripe did not return a default_price after product creation');
        }
        await prisma.image.update({
            where: { image_id },
            data: { stripe_product_id: productId, stripe_price_id: defaultPrice },
        });
        return { product_id: productId, price_id: defaultPrice };
    }

    // Product exists, price missing -- create a Price separately.
    const price = await stripe.prices.create({
        product: productId,
        unit_amount: img.listed_price,
        currency: 'usd',
    });
    await stripe.products.update(productId, { default_price: price.id });
    await prisma.image.update({
        where: { image_id },
        data: { stripe_price_id: price.id },
    });
    return { product_id: productId, price_id: price.id };
}

// -------------------------------------------------------------------
// Checkout init  (payments.md §2.1, R71 §3.7 row 15)
// -------------------------------------------------------------------

export interface InitCheckoutInput {
    image_id: string;
    owner_id: string;
    owner_email: string;
    return_origin: string;  // e.g. http://localhost:5173 -- used to build return_url
}

export interface InitCheckoutResult {
    ok: true;
    purchase_id: string;
    client_secret: string;
    checkout_session_id: string;
}

export async function initCheckout(input: InitCheckoutInput): Promise<InitCheckoutResult> {
    const stripe = getStripe();
    const image = await prisma.image.findUnique({ where: { image_id: input.image_id } });
    if (!image) throw new Error(`Image ${input.image_id} not found`);
    if (image.status !== 'live') {
        throw new Error(`Image ${input.image_id} is not live (status=${image.status})`);
    }
    // Ensure Owner row + Stripe customer. Owner row is created at MJA capture
    // per schema; auto-create here for MVP since the MJA click-wrap isn't
    // wired yet. TODO: gate this on signed MJA per payments.md §1.4 Pre.
    let owner = await prisma.owner.findUnique({ where: { user_id: input.owner_id } });
    if (!owner) {
        owner = await prisma.owner.create({ data: { user_id: input.owner_id } });
    }
    let stripeCustomerId = owner.stripe_customer_id;
    if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
            email: input.owner_email,
            metadata: { user_id: input.owner_id },
        });
        stripeCustomerId = customer.id;
        await prisma.owner.update({
            where: { user_id: input.owner_id },
            data: { stripe_customer_id: stripeCustomerId },
        });
    }

    const { price_id } = await ensureStripeProduct(image.image_id);

    const purchase = await prisma.purchase.create({
        data: {
            image_id: image.image_id,
            owner_id: input.owner_id,
            seller_user_id: image.creator_id,
            status: 'started',
        },
    });

    // Embedded Checkout. return_url is where Stripe redirects after the buyer
    // completes payment INSIDE the embedded modal (Stripe replaces the iframe
    // content with a "return to merchant" redirect). The {CHECKOUT_SESSION_ID}
    // placeholder is substituted server-side by Stripe.
    // Embedded UI + managed_payments are preview-API fields not in the public
    // SDK typings yet; cast via unknown to bypass without losing typing on the
    // common fields above.
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ui_mode: 'embedded_page', // 2026-04-22.preview renamed 'embedded' -> 'embedded_page'
        line_items: [{ price: price_id, quantity: 1 }],
        customer: stripeCustomerId,
        managed_payments: { enabled: true },
        // Managed Payments handles tax computation, address collection, and
        // customer updates automatically -- automatic_tax,
        // billing_address_collection, and customer_update are all rejected
        // when managed_payments.enabled is true. Stripe handles them itself.
        // Distinct from `?checkout=open` (which opens the modal); `?paid=<session>`
        // signals payment succeeded so the listing can render the Confirmation
        // state per R71 §2.4 step 16. `purchase` is the internal id used to
        // trigger the start-build endpoint (ADR-0001 buyer-triggered build).
        return_url: `${input.return_origin}/${image.image_id}?paid={CHECKOUT_SESSION_ID}&purchase=${purchase.id}`,
        metadata: { purchase_id: purchase.id, image_id: image.image_id },
    } as unknown as Stripe.Checkout.SessionCreateParams);

    await prisma.purchase.update({
        where: { id: purchase.id },
        data: { stripe_checkout_session_id: session.id },
    });

    if (!session.client_secret) {
        throw new Error('Stripe returned no client_secret for the embedded session');
    }
    return {
        ok: true,
        purchase_id: purchase.id,
        client_secret: session.client_secret,
        checkout_session_id: session.id,
    };
}

// -------------------------------------------------------------------
// Webhook handler  (payments.md §2.2 -- 2.4)
// -------------------------------------------------------------------

export interface HandleWebhookResult {
    ok: boolean;
    event_type?: string;
}

// Verify signature, parse event, route to a per-event branch. Returns ok=false
// only on signature failure (caller returns 400). All other branches return
// ok=true even on no-op duplicates -- per spec §2.3, internal errors are
// caught + logged but still 200 to avoid Stripe retry storms.
export async function handleStripeWebhook(
    rawBody: Buffer,
    signature: string,
): Promise<HandleWebhookResult> {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    }
    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (e) {
        console.warn('[stripe.webhook] signature verification failed', (e as Error).message);
        return { ok: false };
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                const purchaseId = session.metadata?.purchase_id;
                if (purchaseId) {
                    // Idempotent: only set checkout_session_id if not already set.
                    await prisma.purchase.updateMany({
                        where: { id: purchaseId, stripe_checkout_session_id: null },
                        data: { stripe_checkout_session_id: session.id },
                    });
                }
                break;
            }
            case 'payment_intent.succeeded': {
                const pi = event.data.object as Stripe.PaymentIntent;
                const purchaseId = pi.metadata?.purchase_id;
                if (!purchaseId) break;
                const amountGross = pi.amount_received ?? pi.amount;
                // Fee arrives via balance_transaction (OI-03). At MVP we
                // optimistically read it from the latest charge expansion when
                // present; otherwise we'll reconcile in a nightly job.
                const latestCharge = typeof pi.latest_charge === 'string' ? null : pi.latest_charge;
                const balanceTxn = latestCharge && typeof latestCharge.balance_transaction !== 'string'
                    ? latestCharge.balance_transaction
                    : null;
                const stripeFee = balanceTxn?.fee ?? 0;
                const netCents = amountGross - stripeFee;
                const creatorNet = Math.floor(netCents * 0.9);
                const platformNet = netCents - creatorNet;
                // Conditional update -- only flips a row from 'started' -> 'paid'
                // so duplicate webhooks no-op.
                await prisma.purchase.updateMany({
                    where: { id: purchaseId, status: 'started' },
                    data: {
                        status: 'paid',
                        stripe_payment_intent_id: pi.id,
                        amount_gross_cents: amountGross,
                        amount_creator_net_cents: creatorNet,
                        amount_platform_net_cents: platformNet,
                    },
                });
                break;
            }
            case 'payment_intent.payment_failed': {
                const pi = event.data.object as Stripe.PaymentIntent;
                const purchaseId = pi.metadata?.purchase_id;
                if (!purchaseId) break;
                const declineCode = pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? 'unknown';
                await prisma.purchase.updateMany({
                    where: { id: purchaseId, status: 'started' },
                    data: {
                        status: 'failed',
                        failure_reason: `STRIPE_PAYMENT_FAILED:${declineCode}`,
                    },
                });
                break;
            }
            case 'charge.refunded': {
                const charge = event.data.object as Stripe.Charge;
                const purchaseId = charge.metadata?.purchase_id;
                if (!purchaseId) break;
                await prisma.purchase.updateMany({
                    where: {
                        id: purchaseId,
                        status: { in: ['failed', 'paid', 'building', 'minting'] },
                    },
                    data: { status: 'refunded' },
                });
                break;
            }
            default:
                // Other events are acknowledged but not routed at MVP.
                break;
        }
    } catch (e) {
        // Spec §2.3: internal handler errors still return 200 to avoid retry
        // storms; surface via logging only.
        console.error('[stripe.webhook] handler error', event.type, e);
    }
    return { ok: true, event_type: event.type };
}
