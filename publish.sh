#!/bin/bash
# 使い方: bash publish.sh <pdfのフォルダ> （plan.json を作り、pdfs/<id>.pdf をそろえた後に実行）
# サイト一式を組み立て、main を履歴なしの1コミットで置き換える（掲載をやめたPDFを履歴に残さないため）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PDFS="$1"; OUT="$(mktemp -d)/site"
REPO="https://github.com/appkobo/op-x02fjrvnc7"
for id in $(python3 -c "import json;print(' '.join(e['id'] for e in json.load(open('$HERE/plan.json'))['publish']))"); do
  f="$PDFS/$id.pdf"; [ -s "$f" ] && [ "$(head -c 4 "$f")" = "%PDF" ] || { echo "PDFがない・壊れている: $id"; exit 1; }
done
python3 "$HERE/build.py" "$PDFS" "$OUT" "$HERE/plan.json"
n=$(ls "$OUT/pdf" | wc -l); want=$(python3 -c "import json;print(len(json.load(open('$HERE/plan.json'))['publish']))")
[ "$n" = "$want" ] && [ -s "$OUT/index.html" ] && [ -s "$OUT/catalog.js" ] || { echo "組み立て結果がおかしい"; exit 1; }
cd "$OUT" && git init -q -b main && git add -A
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "自動更新：確認リストに合わせて掲載を更新（$n枚）${COMMIT_TRAILER:+

$COMMIT_TRAILER}"
git remote add origin "$REPO" && git push --force origin main 2>&1 | tail -1
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$(git rev-parse HEAD)" ] && echo "PUBLISHED $n" || { echo "push失敗"; exit 1; }
