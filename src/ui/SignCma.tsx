// SignCma.tsx
// Creator Master Agreement (CMA) signing surface per identity.md §2.7 and
// creator_onboarding_wsd.md step 6. Runs AFTER YouTube verify and BEFORE
// any creator-gated route (the profile page + dashboard both require the
// creators row that this surface creates).
//
// Form fields: legal_name, legal_address (street/city/state/postal/country),
// entity_type, display_name. CMA text is fetched from /v1/legal/CMA and
// rendered scrollably; the "I agree and sign" button POSTs everything to
// /v1/creator/sign-cma which creates the signatures row + creators row in
// one transaction.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api';

// Google Maps JS API + Places (New) loader. Uses Google's official inline
// bootstrap snippet (https://developers.google.com/maps/documentation/javascript/load-maps-js-api
// "Dynamic Library Import"). The bootstrap sets up a stub
// `google.maps.importLibrary` function synchronously; the FIRST call to
// importLibrary triggers the actual <script> injection with the requested
// library set, and the real implementation replaces the stub once Maps loads.
//
// Loading the script directly via a plain <script src="...?libraries=places">
// does NOT expose importLibrary -- the bootstrap snippet is the only path
// to the new Places APIs (AutocompleteSuggestion, etc.) for new customers.
function bootstrapMapsLoader(apiKey: string): void {
    if ((window as any).google?.maps?.importLibrary) return; // already bootstrapped
    ((g: any) => {
        let h: any, a: any, k: any;
        const p = 'The Google Maps JavaScript API';
        const c = 'google';
        const l = 'importLibrary';
        const q = '__ib__';
        const m = document;
        let b: any = window;
        b = b[c] || (b[c] = {});
        const d = b.maps || (b.maps = {});
        const r = new Set<string>();
        const e = new URLSearchParams();
        const u: any = () => h || (h = new Promise(async (f: any, n: any) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            await (a = m.createElement('script'));
            e.set('libraries', [...r].join(','));
            for (k in g) e.set(k.replace(/[A-Z]/g, (t: string) => '_' + t[0].toLowerCase()), g[k]);
            e.set('callback', c + '.maps.' + q);
            a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
            d[q] = f;
            a.onerror = () => (h = n(new Error(p + ' could not load.')));
            a.nonce = m.querySelector('script[nonce]')?.getAttribute('nonce') || '';
            m.head.append(a);
        }));
        if (d[l]) {
            console.warn(p + ' only loads once. Ignoring:', g);
        } else {
            d[l] = (f: any, ...n: any[]) => r.add(f) && u().then(() => d[l](f, ...n));
        }
    })({ key: apiKey, v: 'weekly' });
}

// Map Place (New) addressComponents array into our flat shape. street is
// "<number> <route>". city falls through locality -> postal_town ->
// sublocality so non-US addresses still populate something sensible.
// State / country use shortText (e.g. "CA", "US"). New API uses longText /
// shortText (vs legacy long_name / short_name).
function parsePlaceComponents(components: Array<{ longText: string; shortText: string; types: string[] }>) {
    const find = (type: string, prop: 'longText' | 'shortText' = 'longText') =>
        components.find(c => c.types?.includes(type))?.[prop];
    const streetNumber = find('street_number');
    const route = find('route');
    return {
        street: [streetNumber, route].filter(Boolean).join(' ') || '',
        city: find('locality') ?? find('postal_town') ?? find('sublocality') ?? '',
        state: find('administrative_area_level_1', 'shortText') ?? '',
        postal_code: find('postal_code') ?? '',
        country: find('country', 'longText') ?? '',
    };
}

type EntityType = 'individual' | 'llc' | 'corp';

interface OnboardingStatus {
    youtube_verified: boolean;
    allowlisted: boolean;
    cma_signed: boolean;
    next_step: 'youtube-verify' | 'sign-cma' | 'complete';
}

interface CmaDoc {
    type: string;
    label: string;
    hash: string;
    body: string;
}

export default function SignCmaPage() {
    const navigate = useNavigate();
    const [status, setStatus] = useState<OnboardingStatus | null>(null);
    const [cma, setCma] = useState<CmaDoc | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Form state -- legally-binding identity only. display_name is a profile
    // field captured separately on /creator/profile after sign-cma.
    const [legalName, setLegalName] = useState('');
    const [street, setStreet] = useState('');
    const [city, setCity] = useState('');
    const [stateRegion, setStateRegion] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [country, setCountry] = useState('United States');
    const [entityType, setEntityType] = useState<EntityType>('individual');

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Places (New) AutocompleteSuggestion: programmatic API + our own dropdown
    // UI below the Street input. Lets us bind the autocomplete to our existing
    // React-controlled <input> (PlaceAutocompleteElement renders its own input,
    // which doesn't fit the requested UX of "type in Street, see suggestions
    // below Street, pick one"). Silent fallback to browser autofill if the
    // API key is unset / Maps JS unreachable.
    const [placesReady, setPlacesReady] = useState<boolean>(false);
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [showDropdown, setShowDropdown] = useState<boolean>(false);
    // Session token batches keystrokes + the final selection into ONE Places
    // billing event (~$0.017) rather than N. Reset to null after each pick.
    const sessionTokenRef = useRef<any>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const apiKey = (import.meta as any).env?.VITE_GOOGLE_PLACES_API_KEY as string | undefined;
        if (!apiKey) {
            console.warn('[Places] VITE_GOOGLE_PLACES_API_KEY not set -- falling back to browser autofill. Restart Vite after adding the key to .env.');
            return;
        }
        let cancelled = false;
        // Bootstrap is sync -- just sets up the importLibrary stub. The actual
        // <script> tag is created on the first importLibrary call below.
        try {
            bootstrapMapsLoader(apiKey);
        } catch (err) {
            console.error('[Places] bootstrap failed:', err);
            return;
        }
        const google = (window as any).google;
        if (!google?.maps?.importLibrary) {
            console.warn('[Places] bootstrap ran but google.maps.importLibrary still undefined. Cannot proceed.');
            return;
        }
        google.maps.importLibrary('places')
            .then(() => {
                if (cancelled) return;
                if (!google.maps.places?.AutocompleteSuggestion) {
                    console.warn('[Places] importLibrary("places") succeeded but AutocompleteSuggestion missing. Likely cause: Places API (New) not enabled in Google Cloud Console, or the key is restricted away from it.');
                    return;
                }
                setPlacesReady(true);
                console.info('[Places] AutocompleteSuggestion API ready');
            })
            .catch((err: any) => {
                console.error('[Places] importLibrary("places") failed:', err);
            });
        return () => {
            cancelled = true;
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    function fetchSuggestions(input: string) {
        if (!placesReady || !input.trim()) {
            setSuggestions([]);
            setShowDropdown(false);
            return;
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            const google = (window as any).google;
            if (!sessionTokenRef.current) {
                sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
            }
            try {
                const { suggestions: results } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                    input,
                    includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
                    sessionToken: sessionTokenRef.current,
                });
                setSuggestions(results ?? []);
                setShowDropdown((results ?? []).length > 0);
            } catch (err) {
                console.error('[Places] fetchAutocompleteSuggestions failed:', err);
                setSuggestions([]);
                setShowDropdown(false);
            }
        }, 200);
    }

    async function selectSuggestion(suggestion: any) {
        const google = (window as any).google;
        try {
            const place = suggestion.placePrediction.toPlace();
            await place.fetchFields({
                fields: ['addressComponents', 'formattedAddress'],
            });
            // Reset session token -- selection ends the session; next keystrokes
            // start a new (billed) session.
            sessionTokenRef.current = null;

            const components = place.addressComponents;
            if (!components || !Array.isArray(components)) {
                console.warn('[Places] fetchFields succeeded but addressComponents missing');
                return;
            }
            const parsed = parsePlaceComponents(components);
            setStreet(parsed.street);
            setCity(parsed.city);
            setStateRegion(parsed.state);
            setPostalCode(parsed.postal_code);
            if (parsed.country) setCountry(parsed.country);
            setShowDropdown(false);
            setSuggestions([]);
        } catch (err) {
            console.error('[Places] selecting place failed:', err);
        }
    }

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            api<OnboardingStatus>('/v1/creator/onboarding-status'),
            api<CmaDoc>('/v1/legal/CMA'),
        ])
            .then(([s, c]) => {
                if (cancelled) return;
                setStatus(s);
                setCma(c);
                // Routing decisions based on current state.
                if (s.next_step === 'youtube-verify') {
                    navigate('/creator/youtube/connect', { replace: true });
                } else if (s.next_step === 'complete') {
                    navigate('/creator/profile', { replace: true });
                }
            })
            .catch(e => {
                if (cancelled) return;
                setLoadError(e?.body?.error ?? e?.message ?? 'Failed to load.');
            });
        return () => { cancelled = true; };
    }, [navigate]);

    const canSubmit =
        !!status &&
        status.next_step === 'sign-cma' &&
        legalName.trim().length > 0 &&
        street.trim().length > 0 &&
        city.trim().length > 0 &&
        postalCode.trim().length > 0 &&
        country.trim().length > 0 &&
        !submitting;

    async function handleSubmit() {
        if (!canSubmit) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await api('/v1/creator/sign-cma', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    legal_name: legalName.trim(),
                    entity_type: entityType,
                    legal_address: {
                        street: street.trim(),
                        city: city.trim(),
                        state_or_region: stateRegion.trim(),
                        postal_code: postalCode.trim(),
                        country: country.trim(),
                    },
                }),
            });
            navigate('/creator/profile', { replace: true });
        } catch (e: any) {
            const body = e?.body ?? {};
            setSubmitError(body.message ?? body.error ?? e?.message ?? 'Sign-CMA failed.');
            setSubmitting(false);
        }
    }

    if (loadError) {
        return (
            <main className="min-h-screen flex items-center justify-center px-4">
                <div className="card bg-error/10 border border-error/30 max-w-md">
                    <div className="card-body">
                        <h2 className="card-title text-error">Could not load CMA</h2>
                        <p className="text-sm">{loadError}</p>
                    </div>
                </div>
            </main>
        );
    }
    if (!status || !cma) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner" />
            </main>
        );
    }

    return (
        <main className="min-h-screen mx-auto max-w-3xl px-4 py-10 space-y-6">
            <header className="space-y-1">
                <p className="text-xs uppercase tracking-widest text-base-content/50">Creator onboarding</p>
                <h1 className="text-2xl font-light tracking-tight">Sign the Creator Master Agreement</h1>
                <p className="text-sm text-base-content/70">
                    The CMA binds you as a creator on Epimage. Your YouTube channel is verified;
                    the next step is signing the agreement so we can create your creator profile.
                </p>
            </header>

            <section className="card bg-base-200">
                <div className="card-body space-y-3">
                    <p className="text-xs text-base-content/60">
                        Legal name, entity, and address are used in the contract only --
                        not surfaced publicly. You'll set your public display name on the
                        profile page after signing.
                    </p>
                    <label className="form-control">
                        <span className="label-text text-sm">Legal name</span>
                        <input
                            type="text"
                            value={legalName}
                            onChange={e => setLegalName(e.target.value)}
                            className="input input-bordered input-sm"
                            placeholder="e.g. Jane Q. Roe"
                        />
                    </label>
                    <label className="form-control">
                        <span className="label-text text-sm">Entity type</span>
                        <select
                            value={entityType}
                            onChange={e => setEntityType(e.target.value as EntityType)}
                            className="select select-bordered select-sm"
                        >
                            <option value="individual">Individual</option>
                            <option value="llc">LLC</option>
                            <option value="corp">Corporation</option>
                        </select>
                    </label>
                </div>
            </section>

            <section className="card bg-base-200">
                <div className="card-body space-y-3">
                    <p className="text-xs text-base-content/60">
                        Service of process address. {placesReady
                            ? 'Start typing the street and pick a suggestion to autofill the rest.'
                            : 'Saved addresses from your browser (if any) will be suggested as you type.'}
                    </p>
                    <form autoComplete="on">
                        <label className="form-control relative">
                            <span className="label-text text-sm">Street</span>
                            <input
                                type="text"
                                value={street}
                                onChange={e => {
                                    setStreet(e.target.value);
                                    fetchSuggestions(e.target.value);
                                }}
                                onFocus={() => {
                                    if (suggestions.length > 0) setShowDropdown(true);
                                }}
                                onBlur={() => {
                                    // Delay so click-on-suggestion (mousedown) fires
                                    // BEFORE we hide the dropdown.
                                    setTimeout(() => setShowDropdown(false), 150);
                                }}
                                className="input input-bordered input-sm"
                                name="address-line1"
                                autoComplete="address-line1"
                            />
                            {showDropdown && suggestions.length > 0 && (
                                <ul className="absolute top-full left-0 right-0 z-10 bg-base-100 border border-base-300 rounded shadow-lg mt-1 max-h-60 overflow-y-auto">
                                    {suggestions.map((s, i) => {
                                        const pred = s.placePrediction;
                                        const main = pred?.mainText?.toString?.() ?? pred?.text?.toString?.() ?? '';
                                        const secondary = pred?.secondaryText?.toString?.() ?? '';
                                        return (
                                            <li
                                                key={i}
                                                onMouseDown={ev => {
                                                    ev.preventDefault();
                                                    selectSuggestion(s);
                                                }}
                                                className="px-3 py-2 text-sm hover:bg-base-200 cursor-pointer border-b border-base-200 last:border-b-0"
                                            >
                                                <div className="font-medium">{main}</div>
                                                {secondary && (
                                                    <div className="text-xs text-base-content/60">{secondary}</div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </label>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                            <label className="form-control">
                                <span className="label-text text-sm">City</span>
                                <input
                                    type="text"
                                    value={city}
                                    onChange={e => setCity(e.target.value)}
                                    className="input input-bordered input-sm"
                                    name="city"
                                    autoComplete="address-level2"
                                />
                            </label>
                            <label className="form-control">
                                <span className="label-text text-sm">State / region</span>
                                <input
                                    type="text"
                                    value={stateRegion}
                                    onChange={e => setStateRegion(e.target.value)}
                                    className="input input-bordered input-sm"
                                    name="state"
                                    autoComplete="address-level1"
                                />
                            </label>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                            <label className="form-control">
                                <span className="label-text text-sm">Postal code</span>
                                <input
                                    type="text"
                                    value={postalCode}
                                    onChange={e => setPostalCode(e.target.value)}
                                    className="input input-bordered input-sm"
                                    name="postal-code"
                                    autoComplete="postal-code"
                                />
                            </label>
                            <label className="form-control">
                                <span className="label-text text-sm">Country</span>
                                <input
                                    type="text"
                                    value={country}
                                    onChange={e => setCountry(e.target.value)}
                                    className="input input-bordered input-sm"
                                    name="country"
                                    autoComplete="country-name"
                                />
                            </label>
                        </div>
                    </form>
                </div>
            </section>

            <section className="pt-4 border-t border-base-300 space-y-2">
                <p className="text-xs uppercase tracking-widest text-base-content/50">
                    Creator Master Agreement &middot; {cma.label}
                </p>
                <div className="max-h-72 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-base-content/70">
                    {cma.body}
                </div>
                <p className="text-[10px] text-base-content/40">Doc hash: <span className="font-mono">{cma.hash.slice(0, 16)}…</span></p>
            </section>

            {submitError && (
                <div className="alert alert-error text-sm">{submitError}</div>
            )}

            <div className="flex items-center justify-end gap-3">
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="btn btn-primary"
                >
                    {submitting ? 'Signing…' : 'I agree and sign the CMA'}
                </button>
            </div>
        </main>
    );
}
