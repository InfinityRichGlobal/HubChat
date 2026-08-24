import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  /* ---------------------------------------------------------------------
   * กฎเฉพาะของโปรเจกต์นี้ — กันไม่ให้ใครข้าม Message Policy Engine
   * (มีชุดทดสอบใน src/server/__tests__/architecture.test.ts คุมอีกชั้น
   *  แต่ eslint จะเตือนตั้งแต่ตอนพิมพ์ ไม่ต้องรอรันเทสต์)
   * ------------------------------------------------------------------- */
  {
    // ครอบ src ทั้งหมด แล้วยกเว้นเฉพาะโฟลเดอร์ที่มีสิทธิ์แตะของพวกนี้จริง ๆ
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/server/transports/**",
      "src/server/messaging/**",
      "src/server/meta/**",
      // ทางเข้าของข้อมูล (webhook) ต้องอ่านโปรไฟล์ลูกค้าจาก Meta ได้
      // แต่ห้ามส่งข้อความ — มีกฎเฉพาะของมันอยู่ในบล็อกถัดไป
      "src/server/ingest/**",
      // หน้าตั้งค่าเพจต้องยิงถาม Meta ว่า token ใช้ได้ไหม (อ่านอย่างเดียว)
      "src/server/pages/**",
      "src/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/server/transports/standard",
                "@/server/transports/human-agent",
                "@/server/transports/utility",
                "@/server/transports/marketing",
                "@/server/transports/base",
              ],
              message:
                "ห้ามเรียก transport adapter ตรง ๆ — การส่งข้อความทุกกรณีต้องผ่าน sendMessage() ใน @/server/messaging/send-message",
            },
            {
              group: ["@/server/meta/client", "@/server/meta/*"],
              message:
                "ห้ามเรียก Meta API ตรง ๆ — การส่งข้อความทุกกรณีต้องผ่าน sendMessage() ใน @/server/messaging/send-message",
            },
            {
              group: ["@/server/transports/registry"],
              importNames: ["getAdapter", "allAdapters"],
              message:
                "ห้ามหยิบ adapter มาใช้เอง — ต้องผ่าน sendMessage() (transportChannelSupport() อ่านอย่างเดียวใช้ได้)",
            },
          ],
        },
      ],
    },
  },

  /* ---------------------------------------------------------------------
   * กฎเฉพาะของ "ทางเข้าข้อมูล" (src/server/ingest)
   * ------------------------------------------------------------------- *
   * โฟลเดอร์นี้ได้รับยกเว้นให้แตะ @/server/meta ได้ เพราะต้องดึงชื่อลูกค้า
   * แต่การยกเว้นต้องแคบที่สุด — เปิดให้อ่านโปรไฟล์ ไม่ได้เปิดให้ส่งข้อความ
   *
   * ถ้าวันหนึ่งรอบคีย์เวิร์ดต้องตอบอัตโนมัติจากตรงนี้
   * ต้องเรียกผ่าน sendMessage() เท่านั้น (ตัวนั้นไม่ได้ห้ามไว้)
   * ------------------------------------------------------------------- */
  {
    files: ["src/server/ingest/**/*.ts", "src/server/pages/**/*.ts"],
    ignores: ["src/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/meta/client"],
              importNames: ["sendToMeta"],
              message:
                "ทางเข้าข้อมูลห้ามส่งข้อความ — ถ้าต้องตอบกลับ ต้องผ่าน sendMessage() เพื่อให้ Policy Engine ตัดสินก่อนเสมอ",
            },
            {
              group: [
                "@/server/transports/standard",
                "@/server/transports/human-agent",
                "@/server/transports/utility",
                "@/server/transports/marketing",
                "@/server/transports/base",
                "@/server/transports/registry",
              ],
              message:
                "ทางเข้าข้อมูลห้ามเรียก transport adapter — การส่งข้อความทุกกรณีต้องผ่าน sendMessage()",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
