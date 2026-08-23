import { defineConfig } from 'vitest/config';
import path from 'node:path';

/** ตั้งค่าชุดทดสอบ — ให้ใช้ alias @/ เหมือนในโปรเจกต์ */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 'server-only' เป็นตัวกันไม่ให้ import ผิดฝั่งตอน build
      // ในชุดทดสอบไม่มี bundler จึงชี้ไปที่ไฟล์เปล่า
      'server-only': path.resolve(__dirname, './src/test/empty.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
