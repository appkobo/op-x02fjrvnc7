#!/usr/bin/env python3
"""one-pagerビューア 組み立てスクリプト。
使い方: python3 build.py <PDFのあるフォルダ> <出力フォルダ> <plan.json>
PDFのフォルダには <id>.pdf を置く。載せるシートは plan.json の publish（plan.py が確認リストから作る）。
"""
import sys, os, re, json, shutil, hashlib, subprocess, unicodedata
from PIL import Image, ImageDraw

VERSION = "1.4"
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
PDFJS = os.path.join(HERE, "node_modules", "pdfjs-dist", "build")
CONF = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
NEWS = json.load(open(os.path.join(HERE, "news.json"), encoding="utf-8"))
CATS = CONF["cats"]
LINKS = CONF["links"]
FEEDBACK = CONF["feedback"]

HEAD = re.compile(r"^\s*(\d{1,2})[.．]\s*(\S.{1,60})$")


def page_texts(path):
    out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, check=True).stdout.decode("utf-8", "replace")
    pages = out.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def clean(t):
    t = unicodedata.normalize("NFKC", t)
    return re.sub(r"\s+", " ", t).strip()


def page_size(path):
    info = subprocess.run(["pdfinfo", path], capture_output=True, check=True).stdout.decode()
    m = re.search(r"Page size:\s+([\d.]+) x ([\d.]+)", info)
    return float(m.group(1)), float(m.group(2))


def icon(size, path, maskable=False):
    im = Image.new("RGB", (size, size), "#16202b")
    d = ImageDraw.Draw(im)
    pad = size * (0.26 if maskable else 0.2)
    w = size - 2 * pad
    x0, y0 = pad + w * 0.12, pad
    x1, y1 = pad + w * 0.88, pad + w
    d.rounded_rectangle([x0, y0, x1, y1], radius=size * 0.05, fill="#ffffff")
    d.rectangle([x0, y0 + w * 0.12, x1, y0 + w * 0.26], fill="#e8833a")
    lw = max(2, int(size * 0.028))
    for i, frac in enumerate([0.42, 0.56, 0.70, 0.84]):
        y = y0 + w * frac
        d.line([x0 + w * 0.1, y, x1 - w * (0.1 if i % 2 == 0 else 0.26), y], fill="#9aa7b4", width=lw)
    im.save(path)


def main():
    pdf_dir, out = sys.argv[1], sys.argv[2]
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, "pdf"))
    os.makedirs(os.path.join(out, "lib"))
    os.makedirs(os.path.join(out, "html"))
    hmap = json.load(open(os.path.join(HERE, "html.json"), encoding="utf-8")) if os.path.exists(os.path.join(HERE, "html.json")) else {}
    plan = json.load(open(sys.argv[3], encoding="utf-8"))
    sheets, index = [], {}
    order = [c["id"] for c in CATS]
    for e in sorted(plan["publish"], key=lambda e: (order.index(e["cat"]), e["order"])):
        sid, cat, name, sub, fn = e["id"], e["cat"], e["name"], e["sub"], e["title"]
        p = os.path.join(pdf_dir, sid + ".pdf")
        data = open(p, "rb").read()
        h = hashlib.sha1(data).hexdigest()[:8]
        shutil.copy(p, os.path.join(out, "pdf", sid + ".pdf"))
        pages = page_texts(p)
        w, hgt = page_size(p)
        r = subprocess.run(["node", os.path.join(HERE, "toc.js"), p], capture_output=True)
        try:
            toc = json.loads(r.stdout.decode("utf-8").strip().splitlines()[-1])
        except Exception:
            toc = []
        # HTML版：そのPDFと同じ版から作ったと記録してあるものだけ使う（PDFが新しくなったら使わない）
        hv = None
        hp = os.path.join(HERE, "html", sid + ".html")
        hm = hmap.get(sid)
        if hm and os.path.exists(hp) and hm.get("driveId") == e.get("driveId") and hm.get("modified") == e.get("modified"):
            hs = open(hp, encoding="utf-8").read()
            hs = re.sub(r'<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>', "", hs)      # 外部の書体は読み込まない（圏外でも待たされない）
            hs = hs.replace("<head>", '<head><meta name="robots" content="noindex, nofollow">', 1)
            if not re.search(r'(?:src|href)\s*=\s*["\'](?!#|data:)', hs):                      # 外部ファイル（画像など）を参照するものは使わない
                open(os.path.join(out, "html", sid + ".html"), "w", encoding="utf-8").write(hs)
                hv = hashlib.sha1(hs.encode("utf-8")).hexdigest()[:8]
        sheets.append({"id": sid, "cat": cat, "name": name, "sub": sub, "n": len(pages),
                       "w": w, "h": hgt, "v": h, "kb": round(len(data) / 1024), "toc": toc, "html": hv})
        index[sid] = [clean(t) for t in pages]
    import datetime, zoneinfo
    updated = datetime.datetime.now(zoneinfo.ZoneInfo("Asia/Tokyo")).strftime("%Y.%m.%d %H:%M")
    cat = {"version": VERSION, "updated": updated, "news": NEWS, "links": LINKS, "feedback": FEEDBACK, "cats": [c for c in CATS if any(x["cat"] == c["id"] for x in sheets)], "sheets": sheets}
    with open(os.path.join(out, "catalog.js"), "w", encoding="utf-8") as f:
        f.write("window.CATALOG=" + json.dumps(cat, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(os.path.join(out, "search.js"), "w", encoding="utf-8") as f:
        f.write("window.SEARCH=" + json.dumps(index, ensure_ascii=False, separators=(",", ":")) + ";\n")
    for fn in ["pdf.min.js", "pdf.worker.min.js"]:
        shutil.copy(os.path.join(PDFJS, fn), os.path.join(out, "lib", fn))
    for fn in ["index.html", "app.js", "style.css", "manifest.webmanifest", "robots.txt"]:
        shutil.copy(os.path.join(SRC, fn), os.path.join(out, fn))
    icon(192, os.path.join(out, "icon-192.png"))
    icon(512, os.path.join(out, "icon-512.png"))
    icon(512, os.path.join(out, "icon-maskable.png"), maskable=True)
    shell = ["./", "index.html", "app.js", "style.css", "catalog.js", "search.js", "lib/pdf.min.js",
             "lib/pdf.worker.min.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"]
    stamp = hashlib.sha1()
    for fn in shell[1:]:
        stamp.update(open(os.path.join(out, fn), "rb").read())
    sw = open(os.path.join(SRC, "sw.js"), encoding="utf-8").read()
    sw = sw.replace("__STAMP__", VERSION + "-" + stamp.hexdigest()[:8]).replace("__SHELL__", json.dumps(shell))
    open(os.path.join(out, "sw.js"), "w", encoding="utf-8").write(sw)
    open(os.path.join(out, ".nojekyll"), "w").close()
    for s in sheets:
        print(s["id"], s["n"], "p", s["kb"], "KB", "目次", len(s["toc"]))
    print("search.js", os.path.getsize(os.path.join(out, "search.js")) // 1024, "KB")


if __name__ == "__main__":
    main()
