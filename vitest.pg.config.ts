import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * ชุดทดสอบที่ต้องใช้ PostgreSQL จริง
 * แยกไฟล์ตั้งค่าออกมาเพราะรันช้ากว่าและต้องมีฐานข้อมูลในเครื่อง
 * รัน : npm run test:pg
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/test/empty.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/pg/**/*.pg.test.ts'],
    // ต้องรันทีละไฟล์ เพราะใช้ฐานข้อมูลและพอร์ตร่วมกัน
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
