/** @type {import('next').NextConfig} */
const nextConfig = {
  // The backend URL is server-only and deliberately not prefixed NEXT_PUBLIC_.
  // The browser never calls Cloud Run directly; it calls this app's route
  // handlers, which hold BACKEND_API_KEY server-side. Nothing here may become
  // a client-side environment variable.
  reactStrictMode: true,

  // Fail the production build on a type error rather than shipping one.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
