// print_size.ts
// Translates image pixel dimensions into a print size at 300 DPI and the
// largest standard picture frame that fits the print in either orientation.
//
// Frame catalog sourced from FrameUSA's standard sizes page (2026-06-01):
// https://frameusa.com/pages/picture-frame-sizes
// Sizes are listed as [width, height] pairs in inches; we treat the frame
// as direction-agnostic (both orientations are tested).
//
// "Fits" means the frame's smaller dimension is <= the print's smaller
// dimension AND the frame's larger dimension is <= the print's larger
// dimension. So a 10x6.7" print fits a 6x8" frame (in 8W x 6H orientation)
// but not an 8x10" frame.
//
// "Largest" means maximum frame area among fitting candidates -- ties broken
// by closer aspect-ratio match to the print.

export const STANDARD_FRAME_SIZES: ReadonlyArray<readonly [number, number]> = [
    [4, 6], [4, 7], [4, 12],
    [5, 5], [5, 7],
    [7, 7],
    [8, 8], [8, 10], [8, 12],
    [8.5, 11],
    [9, 12],
    [10, 13], [10, 20],
    [11, 14], [11, 17],
    [12, 12], [12, 16], [12, 18], [12, 36],
    [13, 19],
    [14, 18],
    [16, 20],
    [18, 24],
    [20, 24], [20, 28], [20, 30],
    [22, 28],
    [24, 30], [24, 36],
    [27, 39], [27, 40], [27, 41],
];

export interface PrintAndFrame {
    print_width_in: number;
    print_height_in: number;
    print_label: string;     // e.g. `10" × 7"`
    frame_label: string | null; // e.g. `6" × 8"` or null when no standard frame fits
}

const DPI = 300;

function fmtInches(n: number): string {
    // One decimal when the value isn't whole; trims the .0 otherwise.
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtSize(w: number, h: number): string {
    return `${fmtInches(w)}"×${fmtInches(h)}"`;
}

// Compute the largest standard frame whose dimensions are <= the print's
// dimensions, in either orientation. Tie-break by smaller absolute
// difference between frame and print aspect ratios so the picked frame
// crops the least.
export function computePrintAndFrame(width_px: number, height_px: number): PrintAndFrame {
    const print_w = width_px / DPI;
    const print_h = height_px / DPI;
    // Always test against the print with its larger side first (orientation-
    // agnostic comparison).
    const [pLong, pShort] = print_w >= print_h ? [print_w, print_h] : [print_h, print_w];
    const printAspect = pLong / pShort;

    let best: { w: number; h: number; area: number; aspectDelta: number } | null = null;
    for (const [a, b] of STANDARD_FRAME_SIZES) {
        const [fLong, fShort] = a >= b ? [a, b] : [b, a];
        if (fLong > pLong || fShort > pShort) continue;
        const area = fLong * fShort;
        const frameAspect = fLong / fShort;
        const aspectDelta = Math.abs(frameAspect - printAspect);
        if (
            !best ||
            area > best.area ||
            (area === best.area && aspectDelta < best.aspectDelta)
        ) {
            best = { w: fLong, h: fShort, area, aspectDelta };
        }
    }

    return {
        print_width_in: print_w,
        print_height_in: print_h,
        print_label: fmtSize(print_w, print_h),
        frame_label: best ? fmtSize(best.w, best.h) : null,
    };
}
