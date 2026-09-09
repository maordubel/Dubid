#!/usr/bin/env bash
# מפיל כל שרת ישן, מרים אחד, **מוודא שמה שהוא מגיש הוא מה שנבנה** — ורק אז מצלם.
#
# למה השורה הזאת קיימת: שרת ישן שנשאר מאזין על אותה יציאה מגיש HTML שמצביע על מקטעי JS
# שכבר לא קיימים. הדפדפן מקבל 400, הקוד לא רץ בכלל, והצילום מראה את המסך הקודם — כלומר
# תוצאה שנראית אמיתית ואינה אמיתית. פעמיים בערב אחד רדפתי אחרי באג שלא היה קיים בגללה.
#
#   scripts/life/serve-and-shoot-2026-09-09.sh <port> <out> <script.mjs> [args...]
set -euo pipefail
port="$1"; out="$2"; film="$3"; shift 3

pkill -9 -f "next start -p ${port}" 2>/dev/null || true
fuser -k -9 "${port}/tcp" 2>/dev/null || true
sleep 2

npx next start -p "${port}" > /tmp/srv-${port}.log 2>&1 &
for _ in $(seq 1 40); do sleep 1; curl -sf -o /dev/null "http://localhost:${port}/city" && break; done

disk="$(ls .next/static/chunks/app/city/ | head -1)"
served="$(curl -s "http://localhost:${port}/city" | grep -o 'city/page-[a-f0-9]*\.js' | head -1 | sed 's|city/||')"
if [ "$disk" != "$served" ]; then
  echo "STALE: disk=${disk} served=${served}" >&2
  exit 3
fi
echo "fresh: ${served}"

rm -rf "${out}"
node "${film}" "$@" "${out}"
