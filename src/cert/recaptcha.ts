// recaptcha.ts
// reCAPTCHA Enterprise server-side verification for the image-report flow.
// Calls projects.assessments.create on recaptchaenterprise.googleapis.com with
// an API key (RECAPTCHA_API_KEY; defaults to reusing VITE_GOOGLE_PLACES_API_KEY
// if a dedicated key isn't set). No external SDK -- one fetch.
//
// The returned riskAnalysis.score is in [0.0, 1.0]:
//   1.0 = very likely a real human
//   0.0 = very likely a bot
// Default threshold: 0.5 (Google's recommendation for "ambiguous" actions like
// form submissions). Tunable via RECAPTCHA_MIN_SCORE.

export const RECAPTCHA_MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE ?? '0.5');
export const RECAPTCHA_EXPECTED_ACTION = 'submit_report';

export type RecaptchaVerifyResult =
    | { ok: true; score: number; action: string }
    | {
        ok: false;
        error_code:
            | 'RECAPTCHA_NOT_CONFIGURED'
            | 'RECAPTCHA_HTTP_ERROR'
            | 'RECAPTCHA_TOKEN_INVALID'
            | 'RECAPTCHA_ACTION_MISMATCH'
            | 'RECAPTCHA_LOW_SCORE';
        message: string;
        score?: number;
        action?: string;
    };

interface AssessmentResponse {
    tokenProperties?: {
        valid?: boolean;
        invalidReason?: string;
        action?: string;
        hostname?: string;
        createTime?: string;
    };
    riskAnalysis?: {
        score?: number;
        reasons?: string[];
    };
    error?: { code: number; message: string; status?: string };
}

export async function verifyRecaptchaToken(
    token: string,
    siteKey: string,
): Promise<RecaptchaVerifyResult> {
    const apiKey = process.env.RECAPTCHA_API_KEY ?? process.env.VITE_GOOGLE_PLACES_API_KEY;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (!apiKey || !projectId) {
        return {
            ok: false,
            error_code: 'RECAPTCHA_NOT_CONFIGURED',
            message: 'RECAPTCHA_API_KEY and GOOGLE_CLOUD_PROJECT_ID must be set',
        };
    }

    const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`;
    let data: AssessmentResponse;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: {
                    token,
                    siteKey,
                    expectedAction: RECAPTCHA_EXPECTED_ACTION,
                },
            }),
        });
        if (!resp.ok) {
            const text = await resp.text();
            return {
                ok: false,
                error_code: 'RECAPTCHA_HTTP_ERROR',
                message: `Assessment ${resp.status}: ${text.slice(0, 200)}`,
            };
        }
        data = (await resp.json()) as AssessmentResponse;
    } catch (e: any) {
        return {
            ok: false,
            error_code: 'RECAPTCHA_HTTP_ERROR',
            message: `Assessment network error: ${e?.message ?? e}`,
        };
    }

    if (!data.tokenProperties?.valid) {
        return {
            ok: false,
            error_code: 'RECAPTCHA_TOKEN_INVALID',
            message: data.tokenProperties?.invalidReason ?? 'token invalid',
        };
    }
    const action = data.tokenProperties.action ?? '';
    if (action !== RECAPTCHA_EXPECTED_ACTION) {
        return {
            ok: false,
            error_code: 'RECAPTCHA_ACTION_MISMATCH',
            message: `expected '${RECAPTCHA_EXPECTED_ACTION}', got '${action}'`,
            action,
        };
    }
    const score = data.riskAnalysis?.score ?? 0;
    if (score < RECAPTCHA_MIN_SCORE) {
        return {
            ok: false,
            error_code: 'RECAPTCHA_LOW_SCORE',
            message: `score ${score.toFixed(2)} below threshold ${RECAPTCHA_MIN_SCORE}`,
            score,
            action,
        };
    }
    return { ok: true, score, action };
}
