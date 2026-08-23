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
]);

export default eslintConfig;
