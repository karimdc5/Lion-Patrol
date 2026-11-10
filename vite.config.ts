import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import splash from './src/splash-links.json' with { type: 'json' };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/Lion-Patrol/';
  const splashLinks = splash
    .map((s) => `<link rel="apple-touch-startup-image" href="${base}splash/${s.file}" media="(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)">`)
    .join('\n    ');
  return {
    base,
    define: {
      __E2E__: JSON.stringify(mode === 'e2e'),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      target: ['safari15', 'chrome100'],
      manifest: true,
      sourcemap: false,
      cssCodeSplit: true,
      modulePreload: { polyfill: false },
    },
    plugins: [
      preact(),
      {
        name: 'lp-csp',
        apply: 'build',
        transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${[
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https://djkinciawtoqlxkpiesq.supabase.co https://*.basemaps.cartocdn.com https://tile.openstreetmap.org",
          "media-src 'self' blob: https://djkinciawtoqlxkpiesq.supabase.co",
          "connect-src 'self' https://djkinciawtoqlxkpiesq.supabase.co wss://djkinciawtoqlxkpiesq.supabase.co https://api.emailjs.com",
          "worker-src 'self' blob:",
          "manifest-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ')}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`),
      },
      {
        name: 'lp-splash-links',
        transformIndexHtml: (html) => html.replace('<!--SPLASH-->', splashLinks),
      },
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          name: 'Lion Patrol — Lion Security Services',
          short_name: 'Lion Patrol',
          description: 'Guard tours, daily activity and incident reporting for Lion Security Services.',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0A0F1C',
          theme_color: '#0A0F1C',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,woff2}', 'icons/*.png', 'brand/*.png'],
          globIgnores: ['legacy/**', 'splash/**', '404.html'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
        devOptions: { enabled: false },
      }),
    ],
    server: { port: 5173 },
    preview: { port: 4173 },
  };
});
