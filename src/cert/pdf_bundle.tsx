// pdf_bundle.tsx
// PDF generators for the onboarding + COA email attachments per
// /docs/cert/pdf_bundle.md. Six functions, one file at MVP per CLAUDE.md
// "MVP code minimal and concise" memory. All built on @react-pdf/renderer.
//
// Inputs are typed-narrow per the spec's §1.1. Output is Buffer<PDF bytes>
// ready to attach to a Postmark envelope.

import React from 'react';
import {
    Document,
    Page,
    Text,
    View,
    Image,
    StyleSheet,
    renderToBuffer,
} from '@react-pdf/renderer';

// ---------------------------------------------------------------------------
// Styling -- one StyleSheet, reused across all six templates. Typography
// register per R67 §5: serif headings, sans body, mono for hashes / URIs / IDs.
// Font registration is deferred until bundled font files exist on disk; until
// then we rely on @react-pdf/renderer's bundled Helvetica/Courier defaults
// (which are baked into every PDF reader so they always render). Switching
// to EB Garamond / IBM Plex is a Font.register() call when we drop the .ttf
// files into src/cert/fonts/.
// ---------------------------------------------------------------------------
const s = StyleSheet.create({
    page: { padding: 60, fontFamily: 'Helvetica', fontSize: 10, color: '#222' },
    eyebrow: { fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#888' },
    title: { fontSize: 22, marginTop: 4, marginBottom: 24, fontFamily: 'Times-Roman' },
    section: { marginBottom: 14 },
    sectionTitle: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#666', marginBottom: 6 },
    row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 3 },
    label: { color: '#666', width: 130 },
    value: { flex: 1, textAlign: 'left' },
    mono: { fontFamily: 'Courier', fontSize: 9 },
    body: { fontSize: 10, lineHeight: 1.5 },
    footer: { position: 'absolute', bottom: 30, left: 60, right: 60, fontSize: 8, color: '#999', textAlign: 'center' },
    thumb: { width: 240, height: 'auto', marginBottom: 18, marginHorizontal: 'auto', borderWidth: 1, borderColor: '#ddd' },
    pre: { fontFamily: 'Courier', fontSize: 8, color: '#444' },
});

// Shared subcomponents -----------------------------------------------------

function DataRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <View style={s.row}>
            <Text style={s.label}>{label}</Text>
            <Text style={mono ? [s.value, s.mono] : s.value}>{value}</Text>
        </View>
    );
}

function DocumentHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
    return (
        <View>
            <Text style={s.eyebrow}>{eyebrow}</Text>
            <Text style={s.title}>{title}</Text>
        </View>
    );
}

function SignatureBlock({ signature_id, signed_by, signed_at, ip_address, document_version_hash }: {
    signature_id: string;
    signed_by: string;
    signed_at: string;
    ip_address: string;
    document_version_hash: string;
}) {
    return (
        <View style={s.section}>
            <Text style={s.sectionTitle}>Signature record</Text>
            <DataRow label="Signed by" value={signed_by} />
            <DataRow label="Signed at" value={formatDate(signed_at)} />
            <DataRow label="IP address" value={ip_address} mono />
            <DataRow label="Signing event id" value={signature_id} mono />
            <DataRow label="Document hash" value={document_version_hash} mono />
        </View>
    );
}

function Footer({ doc_id }: { doc_id: string }) {
    return (
        <Text style={s.footer} fixed>
            Epimage  |  {doc_id}  |  Retain this document for your records.
        </Text>
    );
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    } catch {
        return iso;
    }
}

function formatPrice(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

// Thumbnail fetch helper -- byte-embeds so the PDF is self-contained per R62 §3.5.
// On fetch failure, returns null and the consumer renders a placeholder line.
async function fetchThumbnailBuffer(url: string): Promise<Buffer | null> {
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[pdf_bundle] thumbnail fetch non-2xx:', resp.status, url);
            return null;
        }
        return Buffer.from(await resp.arrayBuffer());
    } catch (e: any) {
        console.warn('[pdf_bundle] thumbnail fetch error:', e?.message ?? e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// 1. Creator Master Agreement (CMA) PDF -- attached to onboarding_creator email
// ---------------------------------------------------------------------------
export interface CmaPdfProps {
    signature_id: string;
    signed_at: string;            // ISO
    document_version_label: string;
    document_version_hash: string;
    legal_name: string;
    legal_address: any;            // JSON; rendered as multi-line below
    entity_type: 'individual' | 'llc' | 'corp';
    ip_address: string;
    body: string;                  // rendered CMA text (the same text that was hashed)
}

export async function renderCmaPdf(p: CmaPdfProps): Promise<Buffer> {
    const addr = formatAddress(p.legal_address);
    const doc = (
        <Document>
            <Page size="LETTER" style={s.page}>
                <DocumentHeader eyebrow="Executed agreement" title="Creator Master Agreement" />
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Counterparty</Text>
                    <DataRow label="Legal name" value={p.legal_name} />
                    <DataRow label="Entity type" value={p.entity_type} />
                    <DataRow label="Address" value={addr} />
                </View>
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Agreement text</Text>
                    <Text style={s.body}>{p.body}</Text>
                </View>
                <SignatureBlock
                    signature_id={p.signature_id}
                    signed_by={p.legal_name}
                    signed_at={p.signed_at}
                    ip_address={p.ip_address}
                    document_version_hash={p.document_version_hash}
                />
                <Footer doc_id={p.document_version_label} />
            </Page>
        </Document>
    );
    return renderToBuffer(doc);
}

// ---------------------------------------------------------------------------
// 2. Buyer Master Agreement / MJA PDF -- attached to onboarding_buyer email
// ---------------------------------------------------------------------------
export interface BmaPdfProps {
    signature_id: string;
    signed_at: string;
    document_version_label: string;
    document_version_hash: string;
    legal_name: string;
    legal_address: any;
    ip_address: string;
    body: string;
    license_signing_event_id?: string;  // present when MJA bundle includes first License Acceptance
}

export async function renderBmaPdf(p: BmaPdfProps): Promise<Buffer> {
    const addr = formatAddress(p.legal_address);
    const doc = (
        <Document>
            <Page size="LETTER" style={s.page}>
                <DocumentHeader eyebrow="Executed agreement" title="Master Joint Agreement" />
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Counterparty</Text>
                    <DataRow label="Legal name" value={p.legal_name} />
                    <DataRow label="Address" value={addr} />
                </View>
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Agreement text</Text>
                    <Text style={s.body}>{p.body}</Text>
                </View>
                <SignatureBlock
                    signature_id={p.signature_id}
                    signed_by={p.legal_name}
                    signed_at={p.signed_at}
                    ip_address={p.ip_address}
                    document_version_hash={p.document_version_hash}
                />
                {p.license_signing_event_id && (
                    <View style={s.section}>
                        <Text style={s.sectionTitle}>Bundled License Acceptance</Text>
                        <DataRow label="Signing event id" value={p.license_signing_event_id} mono />
                    </View>
                )}
                <Footer doc_id={p.document_version_label} />
            </Page>
        </Document>
    );
    return renderToBuffer(doc);
}

// ---------------------------------------------------------------------------
// 3. Certificate of Authenticity -- byte-embedded thumbnail at top per R62 §3.5
// ---------------------------------------------------------------------------
export interface CoaPdfProps {
    image_id: string;
    title: string;
    creator_display_name: string;
    creator_youtube_handle: string;
    creation_date: string;
    edition: string;
    asset_id: string;
    solana_cluster: string;
    sha256: string;
    arweave_uri: string | null;
    isa_signature_id: string | null;
    deed_page_url: string;
    thumbnail_url: string;
    minted_at: string;
}

export async function renderCertificateOfAuthenticityPdf(p: CoaPdfProps): Promise<Buffer> {
    const thumb = await fetchThumbnailBuffer(p.thumbnail_url);
    const doc = (
        <Document>
            <Page size="LETTER" style={s.page}>
                <DocumentHeader eyebrow="Certificate" title="Certificate of Authenticity" />
                {thumb ? (
                    <Image src={thumb} style={s.thumb} />
                ) : (
                    <Text style={[s.body, { textAlign: 'center', color: '#999', marginVertical: 24 }]}>
                        Thumbnail unavailable -- see deed page for the image
                    </Text>
                )}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Work</Text>
                    <DataRow label="Title" value={p.title} />
                    <DataRow label="Creator" value={`${p.creator_display_name}  (${p.creator_youtube_handle})`} />
                    <DataRow label="Created" value={p.creation_date.slice(0, 10)} />
                    <DataRow label="Edition" value={p.edition} />
                    <DataRow label="Image id" value={p.image_id} mono />
                </View>
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Provenance</Text>
                    <DataRow label="Solana asset id" value={p.asset_id} mono />
                    <DataRow label="Cluster" value={p.solana_cluster} />
                    <DataRow label="SHA-256" value={p.sha256} mono />
                    {p.arweave_uri && <DataRow label="Arweave URI" value={p.arweave_uri} mono />}
                    <DataRow label="Deed page" value={p.deed_page_url} mono />
                    <DataRow label="Minted" value={formatDate(p.minted_at)} />
                </View>
                {p.isa_signature_id && (
                    <View style={s.section}>
                        <Text style={s.sectionTitle}>Creator's affirmation</Text>
                        <DataRow label="ISA signing event id" value={p.isa_signature_id} mono />
                    </View>
                )}
                <Footer doc_id={`COA-${p.image_id}`} />
            </Page>
        </Document>
    );
    return renderToBuffer(doc);
}

// ---------------------------------------------------------------------------
// 4. Title Document -- bill-of-sale equivalent
// ---------------------------------------------------------------------------
export interface TitlePdfProps {
    image_id: string;
    title: string;
    transaction_signature: string;
    timestamp: string;
    price_cents: number;
    royalty_pct: number;
    creator_legal_name: string;
    buyer_identifier: string;       // legal name if available, else email
    asset_id: string;
    solana_cluster: string;
    deed_page_url: string;
}

export async function renderTitleDocumentPdf(p: TitlePdfProps): Promise<Buffer> {
    const doc = (
        <Document>
            <Page size="LETTER" style={s.page}>
                <DocumentHeader eyebrow="Title document" title="Bill of Sale" />
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Transfer</Text>
                    <DataRow label="Work" value={p.title} />
                    <DataRow label="Image id" value={p.image_id} mono />
                    <DataRow label="From (Creator)" value={p.creator_legal_name} />
                    <DataRow label="To (Buyer)" value={p.buyer_identifier} />
                    <DataRow label="Price" value={formatPrice(p.price_cents)} />
                    <DataRow label="Creator royalty" value={`${p.royalty_pct}%`} />
                    <DataRow label="Closed" value={formatDate(p.timestamp)} />
                </View>
                <View style={s.section}>
                    <Text style={s.sectionTitle}>On-chain reference</Text>
                    <DataRow label="Transaction" value={p.transaction_signature} mono />
                    <DataRow label="Asset id" value={p.asset_id} mono />
                    <DataRow label="Cluster" value={p.solana_cluster} />
                    <DataRow label="Deed page" value={p.deed_page_url} mono />
                </View>
                <Footer doc_id={`TITLE-${p.image_id}`} />
            </Page>
        </Document>
    );
    return renderToBuffer(doc);
}

// ---------------------------------------------------------------------------
// 5. Purchase Receipt -- three-point evidentiary chain
// ---------------------------------------------------------------------------
export interface PurchaseReceiptPdfProps {
    image_id: string;
    title: string;
    cma_version_hash: string;
    bma_version_hash: string;
    license_signing_event_id: string | null;
    asset_id: string;
    transaction_signature: string;
    timestamp: string;
    price_cents: number;
    creator_net_cents: number;
    platform_net_cents: number;
}

export async function renderPurchaseReceiptPdf(p: PurchaseReceiptPdfProps): Promise<Buffer> {
    const doc = (
        <Document>
            <Page size="LETTER" style={s.page}>
                <DocumentHeader eyebrow="Receipt" title="Purchase Receipt" />
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Transaction</Text>
                    <DataRow label="Work" value={p.title} />
                    <DataRow label="Image id" value={p.image_id} mono />
                    <DataRow label="Closed" value={formatDate(p.timestamp)} />
                    <DataRow label="Gross price" value={formatPrice(p.price_cents)} />
                    <DataRow label="Creator net (90%)" value={formatPrice(p.creator_net_cents)} />
                    <DataRow label="Platform net (10%)" value={formatPrice(p.platform_net_cents)} />
                </View>
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Evidentiary chain</Text>
                    <DataRow label="CMA version hash" value={p.cma_version_hash} mono />
                    <DataRow label="MJA version hash" value={p.bma_version_hash} mono />
                    {p.license_signing_event_id && (
                        <DataRow label="License event id" value={p.license_signing_event_id} mono />
                    )}
                    <DataRow label="Transaction" value={p.transaction_signature} mono />
                    <DataRow label="Asset id" value={p.asset_id} mono />
                </View>
                <Footer doc_id={`RECEIPT-${p.image_id}`} />
            </Page>
        </Document>
    );
    return renderToBuffer(doc);
}

// ---------------------------------------------------------------------------
// 6. License Acceptance Record -- click-wrap evidence
// ---------------------------------------------------------------------------
export interface LicensePdfProps {
    signature_id: string;
    document_version_label: string;
    document_version_hash: string;
    clicked_at: string;
    ip_address: string;
    session_token_hash: string;
    license_params: Record<string, any>;
    buyer_identifier: string;
    image_id: string;
    title: string;
}

export async function renderLicenseAcceptanceRecordPdf(p: LicensePdfProps): Promise<Buffer> {
    const params = Object.entries(p.license_params)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('\n');
    const doc = (
        <Document>
            <Page size="LETTER" style={s.page}>
                <DocumentHeader eyebrow="License" title="License Acceptance Record" />
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Subject</Text>
                    <DataRow label="Work" value={p.title} />
                    <DataRow label="Image id" value={p.image_id} mono />
                    <DataRow label="Accepted by" value={p.buyer_identifier} />
                </View>
                <View style={s.section}>
                    <Text style={s.sectionTitle}>License parameters</Text>
                    <Text style={s.pre}>{params}</Text>
                </View>
                <SignatureBlock
                    signature_id={p.signature_id}
                    signed_by={p.buyer_identifier}
                    signed_at={p.clicked_at}
                    ip_address={p.ip_address}
                    document_version_hash={p.document_version_hash}
                />
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Click-event metadata</Text>
                    <DataRow label="Session token hash" value={p.session_token_hash} mono />
                </View>
                <Footer doc_id={p.document_version_label} />
            </Page>
        </Document>
    );
    return renderToBuffer(doc);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatAddress(addr: any): string {
    if (!addr) return '';
    if (typeof addr === 'string') {
        try { addr = JSON.parse(addr); } catch { return addr; }
    }
    const parts = [
        addr.street,
        [addr.city, addr.state_or_region, addr.postal_code].filter(Boolean).join(', '),
        addr.country,
    ].filter(Boolean);
    return parts.join('\n');
}
