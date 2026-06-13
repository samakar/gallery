import { prisma } from '../src/db';

async function main() {
    const d = await prisma.deed.findUnique({
        where: { image_id: 'tgq96' },
        select: {
            image_id: true,
            custody_state: true,
            legal_state: true,
            enc_final_unwrapped: true,
            variant_hashes: true,
        },
    });
    if (!d) {
        console.log('No deed for tgq96');
        return;
    }
    console.log('image_id           :', d.image_id);
    console.log('custody_state      :', d.custody_state);
    console.log('legal_state        :', d.legal_state);
    console.log('enc_final_unwrapped:', d.enc_final_unwrapped
        ? `${d.enc_final_unwrapped.length} chars (${d.enc_final_unwrapped.slice(0, 16)}…)`
        : 'null');
    if (d.variant_hashes) {
        const vh = JSON.parse(d.variant_hashes);
        const keys = Object.keys(vh).sort();
        console.log('variant_hashes keys:', keys.join(', '));
        for (const k of keys) console.log(`  ${k} : ${vh[k].sha256?.slice(0, 16)}… (anchored ${vh[k].anchored_at?.slice(0, 19)})`);
    }
}
main().finally(() => prisma.$disconnect());
