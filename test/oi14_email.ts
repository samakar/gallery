// Drive an actual sendOnboardingCreatorEmail through the real template so
// the OI-14 recovery-key paragraph + sanitized PDF attachment filename
// can be eyeballed in an inbox. Sends to EMAIL_FROM_ADDRESS by default.
//
// Usage: npx tsx scripts/_oi14_email.ts [recipient@example.com]

import { sendOnboardingCreatorEmail } from '../src/cert/email';

async function main() {
    const to = process.argv[2] || process.env.EMAIL_FROM_ADDRESS;
    if (!to) {
        console.error('Set EMAIL_FROM_ADDRESS in .env or pass a recipient.');
        process.exit(1);
    }
    console.log(`Sending real onboarding_creator email to: ${to}`);
    console.log(`Postmark stream: ${process.env.POSTMARK_TRANSACTIONAL_STREAM ?? 'outbound (default)'}`);
    const result = await sendOnboardingCreatorEmail({
        to,
        creator_display_name: 'Amir (OI-14 smoke)',
        cma: {
            signature_id: 'oi14-smoke-not-real',
            signed_at: new Date().toISOString(),
            document_version_label: 'CMA-v1.0',
            document_version_hash: 'a'.repeat(64),
            legal_name: 'Test Creator',
            legal_address: {
                street: '123 Test St',
                city: 'San Francisco',
                state_or_region: 'CA',
                postal_code: '94105',
                country: 'United States',
            },
            entity_type: 'individual',
            ip_address: '127.0.0.1',
            body: 'This is a TEST CMA used only for the OI-14 in-flight smoke. Not a real signature.',
        },
        idempotency_key: `oi14-smoke-${Date.now()}`,
    });
    console.log('Result:', JSON.stringify(result, null, 2));
}

main();
