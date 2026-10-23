/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Used by `npm run preview` (VAULT_PREVIEW=1). Kept here so Next leaves them
  // as real server modules instead of trying to bundle them.
  serverExternalPackages: ['@prisma/adapter-pg', 'pg', '@electric-sql/pglite', 'pglite-server'],
  async headers() {
    return [
      // Browsers should always re-check the service worker for updates.
      { source: '/sw.js', headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ] },
    ];
  },
};
export default nextConfig;
