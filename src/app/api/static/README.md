# Static assets

Files in this directory are served by the Express API at `/static/*` via the
`express.static` middleware mounted in `server.ts`. Same path in production:
`https://epimage.com/static/<file>`.

Reserved filenames consumed by the platform:

| File | Consumer |
|---|---|
| `collection-cover.png` | `/collection.json` -> `image` field. Surfaces on Solana Explorer's Collection page. Recommended >= 512x512 PNG, branded, transparent or solid background. |
| `favicon.ico` / `favicon-*.png` | Browser tab icon. Wire from index.html when adding. |
| `apple-touch-icon.png` | iOS Safari home-screen icon. 180x180 PNG. |
| `og-default.png` | Fallback OG share-card when per-image generation is absent. 1200x630 PNG. |

Add new files freely; cache-control is 7 days at the route. For cache-busting,
callers append `?v=<rev>` to the URL (e.g. when collection-cover.png changes).
