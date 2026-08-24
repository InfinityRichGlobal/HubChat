#!/usr/bin/env bash
# ============================================================================
#  เปิดอุโมงค์แบบชื่อคงที่ — ใช้แทน `cloudflared tunnel --url http://localhost:3000`
#
#  รันด้วย :  npm run tunnel
#
#  ต่างจากของเดิมยังไง :
#    ของเดิมได้ที่อยู่สุ่มใหม่ทุกครั้ง (xxx.trycloudflare.com) ต้องไปแก้ที่ Meta ทุกรอบ
#    ตัวนี้ใช้ที่อยู่เดิมตลอด ตั้งที่ Meta ครั้งเดียวจบ
# ============================================================================
set -euo pipefail

CONFIG="tunnel/config.yml"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "❌ ยังไม่ได้ติดตั้ง cloudflared"
  echo
  echo "ติดตั้งด้วย :  brew install cloudflared"
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "❌ ยังไม่มีไฟล์ $CONFIG"
  echo
  echo "ทำตามขั้นตอนใน docs/TUNNEL.md ก่อน (ทำครั้งเดียวจบ)"
  echo "ย่อ ๆ คือ :"
  echo "  1) cloudflared tunnel login"
  echo "  2) cloudflared tunnel create hubchat"
  echo "  3) cp tunnel/config.example.yml tunnel/config.yml  แล้วแก้ 3 บรรทัด"
  echo "  4) cloudflared tunnel route dns hubchat <ชื่อโดเมนของคุณ>"
  exit 1
fi

# ⚠️ ตรวจว่าแก้ค่าตัวอย่างแล้วจริง ๆ ไม่งั้นจะได้ error ที่อ่านไม่รู้เรื่องจาก cloudflared
if grep -q "PUT-YOUR-TUNNEL-ID-HERE" "$CONFIG"; then
  echo "❌ $CONFIG ยังเป็นค่าตัวอย่างอยู่ — ต้องใส่ tunnel id ของจริงก่อน"
  exit 1
fi

HOSTNAME_LINE=$(grep -m1 'hostname:' "$CONFIG" | sed 's/.*hostname:[[:space:]]*//')

echo "🌐 เปิดอุโมงค์ที่ https://${HOSTNAME_LINE}"
echo "   Callback URL สำหรับ Meta :"
echo "   https://${HOSTNAME_LINE}/api/webhooks/meta"
echo
echo "   (ที่อยู่นี้จะไม่เปลี่ยนอีกแล้ว แม้ปิดเครื่องหรือรีสตาร์ต)"
echo

exec cloudflared tunnel --config "$CONFIG" run
