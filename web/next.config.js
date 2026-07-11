/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // The browser calls PostgREST directly. There is no Next.js API route in
    // this project on purpose — that's the whole point. PostgREST sends
    // permissive CORS headers by default, so the browser can talk to it.
    POSTGREST_URL: process.env.POSTGREST_URL || 'http://localhost:3000',
  },
};

module.exports = nextConfig;
