// scripts/test_postmark_send.ts
// One-off test: sends a plain email + a CMA-style PDF attachment to amir@epimage.com
// to validate the Postmark integration end-to-end without going through a workflow.
//
// Run:   tsx scripts/test_postmark_send.ts
//
// What it does:
//   1. Hits Postmark's REST API directly with the env-configured token + FROM address
//   2. Generates a sample CMA PDF via the same pdf_bundle module the prod path uses
//   3. Logs the MessageID on success, or the error code + message on failure
//
// What it does NOT do:
//   - Touch the database
//   - Persist anything
//   - Hit any of the variant-typed senders in src/cert/email.ts (deliberately bypasses
//     them so the test isolates the network + auth layer)

import 'dotenv/config';
import { renderCmaPdf } from '../src/cert/pdf_bundle';

const POSTMARK_ENDPOINT = 'https://api.postmarkapp.com/email';
const TEST_RECIPIENT = process.argv[2] ?? 'amir@epimage.com';

async function main() {
    const token = process.env.POSTMARK_SERVER_TOKEN;
    const from = process.env.EMAIL_FROM_ADDRESS;
    if (!token || !from) {
        console.error('Missing env. Need POSTMARK_SERVER_TOKEN and EMAIL_FROM_ADDRESS.');
        process.exit(1);
    }

    console.log('Postmark test send');
    console.log('  From:     ', from);
    console.log('  To:       ', TEST_RECIPIENT);
    console.log('  Token:    ', token.slice(0, 8) + '…');
    console.log();

    console.log('1) Rendering test CMA PDF...');
    const t0 = Date.now();
    const pdf = await renderCmaPdf({
        signature_id: 'test-signature-id-not-real',
        signed_at: new Date().toISOString(),
        document_version_label: 'CMA-test-1.0',
        document_version_hash: 'a'.repeat(64),
        legal_name: 'Test Creator',
        legal_address: { street: '123 Test St', city: 'San Francisco', state_or_region: 'CA', postal_code: '94105', country: 'United States' },
        entity_type: 'individual',
        ip_address: '127.0.0.1',
        body: 'This is a TEST CMA used only for verifying Postmark integration. The signature event is not real and this document does not bind any party.',
    });
    console.log(`   PDF rendered in ${Date.now() - t0}ms, ${(pdf.byteLength / 1024).toFixed(1)}kb`);
    console.log();

    console.log('2) Sending via Postmark API...');
    const body = {
        From: from,
        To: TEST_RECIPIENT,
        Subject: 'Epimage Postmark integration test',
        HtmlBody:
            '<!DOCTYPE html><html><body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">' +
            '<h1 style="font-weight: 300;">Postmark integration test</h1>' +
            '<p>If you see this email and the attached PDF opens cleanly, the integration works.</p>' +
            `<p><strong>Sent at:</strong> ${new Date().toISOString()}</p>` +
            '<p style="font-size: 12px; color: #888;">This is an automated test triggered by <code>scripts/test_postmark_send.ts</code>.</p>' +
            '</body></html>',
        TextBody:
            'Postmark integration test.\n' +
            `Sent at: ${new Date().toISOString()}\n\n` +
            'If you see this email and the attached PDF opens, the integration works.',
        MessageStream: 'outbound',
        Attachments: [
            {
                Name: 'test-cma.pdf',
                Content: pdf.toString('base64'),
                ContentType: 'application/pdf',
            },
        ],
    };

    const t1 = Date.now();
    const resp = await fetch(POSTMARK_ENDPOINT, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': token,
        },
        body: JSON.stringify(body),
    });
    const elapsed = Date.now() - t1;
    const text = await resp.text();

    console.log(`   HTTP ${resp.status} ${resp.statusText}  (${elapsed}ms)`);

    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }

    if (resp.ok) {
        console.log('   ✓ Success');
        console.log('   MessageID:   ', data.MessageID);
        console.log('   SubmittedAt: ', data.SubmittedAt);
        console.log('   To:          ', data.To);
        console.log();
        console.log('Check your inbox + Postmark Dashboard → Activity tab.');
        return;
    }

    console.log('   ✗ Failed');
    console.log('   Response: ', typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
    console.log();
    console.log('Common causes:');
    console.log('  - 401: token is Account-level (not Server) or revoked');
    console.log('  - 422: From address not a verified Sender Signature');
    console.log('  - 405: account in test mode and recipient is not a verified sender');
    process.exit(2);
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(3);
});
