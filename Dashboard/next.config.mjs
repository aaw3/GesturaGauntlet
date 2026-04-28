/** @type {import('next').NextConfig} */
const backendUrl =
  process.env.GESTURA_BACKEND_URL ||
  process.env.NEXT_PUBLIC_GESTURA_BACKEND_URL ||
  'http://localhost:3001'

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${backendUrl}/socket.io/:path*`,
      },
    ]
  },
}

export default nextConfig
