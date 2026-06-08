import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { request as httpRequest } from 'node:http';

// `/v1/*` and `/i/*` are proxied via Vite's built-in proxy. `/archive/*`
// uses a custom plugin instead -- the built-in proxy refused to engage for
// it under Vite 7 even with identical syntax to the working /v1 rule, and
// the regex form (^/archive/.*) has the same trailing-slash bug as #19713.
// The plugin mounts a connect middleware BEFORE the SPA fallback and forwards
// raw bytes to the Express API on :3000.
function archiveProxyPlugin(): Plugin {
  return {
    name: 'epimage-archive-proxy',
    configureServer(server) {
      // Register WITHOUT a path prefix so connect doesn't strip /archive
      // from req.url. We then gate on req.url inside the handler.
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/archive/')) return next();
        const upstream = httpRequest(
          {
            host: 'localhost',
            port: 3000,
            method: req.method,
            path: req.url,
            headers: req.headers,
          },
          (up) => {
            res.statusCode = up.statusCode ?? 502;
            for (const [k, v] of Object.entries(up.headers)) {
              if (v !== undefined) res.setHeader(k, v as string | string[]);
            }
            up.pipe(res);
          },
        );
        upstream.on('error', (err) => {
          res.statusCode = 502;
          res.end(`archive proxy error: ${err.message}`);
        });
        req.pipe(upstream);
      });
    },
  };
}

// Dev-only -- prod serves UI + API behind the same origin.
export default defineConfig({
  plugins: [react(), tailwindcss(), archiveProxyPlugin()],
  server: {
    proxy: {
      '/v1': 'http://localhost:3000',
      // /i/<image_id> resolves the canonical short URL exposed in <img src>
      // -- backend 302s to the right Cloudinary variant. Same shape in prod
      // (epimage.com/i/<id>) so "Copy image address" produces a stable URL.
      '/i': 'http://localhost:3000',
    },
  },
});
