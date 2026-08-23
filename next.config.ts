import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // argon2 เป็น native module — บอก Next ว่าอย่าพยายาม bundle
  serverExternalPackages: ['@node-rs/argon2'],

  // ส่วนหัวความปลอดภัยพื้นฐาน
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },              // กันเว็บอื่นเอาไปฝัง iframe
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
