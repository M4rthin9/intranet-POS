import type { NextConfig } from 'next';
import { contentSecurityPolicy } from './src/lib/security-headers';
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  allowedDevOrigins: process.env.APP_ORIGIN ? [new URL(process.env.APP_ORIGIN).hostname] : [],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy(process.env.NODE_ENV === 'development'),
          },
        ],
      },
    ];
  },
};
export default config;
