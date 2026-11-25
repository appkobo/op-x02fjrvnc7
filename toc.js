// PDF自身の目次（先頭数ページにあるページ内リンク）から、目次の行と行き先を取り出す。
// 使い方: node toc.js <pdf> → [[ページ番号, 見出し, ページ内の位置0〜1], ...] をJSONで出力
const fs = require("fs");
const path = require("path");
const _w = console.warn; console.warn = () => {}; console.log = ((l) => (...a) => (String(a[0]).startsWith("Warning") ? 0 : l(...a)))(console.log);
const pdfjs = require(path.join(__dirname, "node_modules/pdfjs-dist/legacy/build/pdf.js"));

(async () => {
  const data = new Uint8Array(fs.readFileSync(process.argv[2]));
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let pn = 1; pn <= Math.min(3, pdf.numPages); pn++) {
    const page = await pdf.getPage(pn);
    const annots = (await page.getAnnotations()).filter((a) => a.subtype === "Link" && a.dest);
    if (!annots.length) { if (pn > 1) break; else continue; }
    const items = (await page.getTextContent()).items.filter((i) => i.str && i.str.trim());
    for (const a of annots) {
      const [x1, y1, x2, y2] = [Math.min(a.rect[0], a.rect[2]), Math.min(a.rect[1], a.rect[3]), Math.max(a.rect[0], a.rect[2]), Math.max(a.rect[1], a.rect[3])];
      const inside = items.filter((i) => {
        const x = i.transform[4], y = i.transform[5] + (i.height || 0) * 0.3;
        return x >= x1 - 2 && x <= x2 + 2 && y >= y1 - 1 && y <= y2 + 1;
      }).sort((p, q) => (Math.abs(q.transform[5] - p.transform[5]) > 3 ? q.transform[5] - p.transform[5] : p.transform[4] - q.transform[4]));
      let title = "";
      inside.forEach((it, k) => {
        if (k) {
          const pv = inside[k - 1], sameLine = Math.abs(pv.transform[5] - it.transform[5]) <= 3;
          if (sameLine && it.transform[4] - (pv.transform[4] + (pv.width || 0)) > 1.5) title += " ";
        }
        title += it.str;
      });
      title = title.replace(/[\u2E80-\u2FDF]/g, (c) => c.normalize("NFKC")).replace(/\u2027/g, "・").replace(/\u2215/g, "/").replace(/[›»▸>]/g, "").replace(/\s+/g, " ").trim();
      if (!title) continue;
      const d = typeof a.dest === "string" ? await pdf.getDestination(a.dest) : a.dest;
      if (!d) continue;
      const idx = typeof d[0] === "object" ? await pdf.getPageIndex(d[0]) : d[0];
      const tp = await pdf.getPage(idx + 1);
      const h = tp.view[3] - tp.view[1];
      const kind = d[1] && d[1].name;
      const y = kind === "XYZ" ? d[3] : kind === "FitH" || kind === "FitBH" ? d[2] : null;
      const frac = y == null ? 0 : Math.max(0, Math.min(1, 1 - y / h));
      out.push([idx + 1, title, Math.round(frac * 1000) / 1000, pn, -y2]);
    }
  }
  out.sort((a, b) => a[3] - b[3] || a[4] - b[4]);
  console.log(JSON.stringify(out.map((r) => r.slice(0, 3))));
})().catch((e) => { console.error(e); console.log("[]"); });
