/* one-pagerビューア 本体 */
(function () {
  "use strict";
  var C = window.CATALOG, SHEETS = C.sheets, BY = {};
  SHEETS.forEach(function (s) { BY[s.id] = s; });
  var PDF_CACHE = "op-pdf-v1";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>';

  /* ---------- 端末内の記録（お気に入り・最近・読んでいた位置） ---------- */
  var st = { fav: [], recent: [], pos: {}, fs: 0, usePdf: {}, posH: {} };
  try { var raw = JSON.parse(localStorage.getItem("op1") || "{}"); st.fav = raw.fav || []; st.recent = raw.recent || []; st.pos = raw.pos || {}; st.fs = [0, 1, 2].indexOf(raw.fs) >= 0 ? raw.fs : 0; st.usePdf = raw.usePdf || {}; st.posH = raw.posH || {}; } catch (e) {}
  st.fav = st.fav.filter(function (i) { return BY[i]; });
  st.recent = st.recent.filter(function (i) { return BY[i]; });
  function save() { try { localStorage.setItem("op1", JSON.stringify(st)); } catch (e) {} }

  var toastT;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- PDFの取得と端末への保存 ---------- */
  var saved = {};
  function pdfUrl(s) { return "pdf/" + s.id + ".pdf?v=" + s.v; }
  function htmlUrl(s) { return "html/" + s.id + ".html?v=" + s.html; }
  function hasCaches() { return typeof caches !== "undefined"; }
  function refreshSaved() {
    if (!hasCaches()) return Promise.resolve();
    return caches.open(PDF_CACHE).then(function (c) { return c.keys(); }).then(function (keys) {
      var sp = {}, sh = {};
      keys.forEach(function (r) {
        var u = new URL(r.url), m = u.pathname.match(/\/pdf\/([^/]+)\.pdf$/), h = u.pathname.match(/\/html\/([^/]+)\.html$/);
        if (m && BY[m[1]] && u.searchParams.get("v") === BY[m[1]].v) sp[m[1]] = true;
        else if (m && !BY[m[1]]) caches.open(PDF_CACHE).then(function (c) { c.delete(r); });   // 収録から外したシートは端末からも消す
        if (h && BY[h[1]] && BY[h[1]].html && u.searchParams.get("v") === BY[h[1]].html) sh[h[1]] = true;
        else if (h) caches.open(PDF_CACHE).then(function (c) { c.delete(r); });                 // 古いHTML版も消す
      });
      saved = {};
      SHEETS.forEach(function (s) { if (sp[s.id] && (!s.html || sh[s.id])) saved[s.id] = true; });
    }).catch(function () {});
  }
  function fetchPdf(s) {
    var url = pdfUrl(s);
    var net = function (cache) {
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        if (cache) {
          cache.put(url, res.clone()).then(function () {
            saved[s.id] = true;
            return cache.keys().then(function (keys) {      // 同じシートの古い版を消す
              keys.forEach(function (r) {
                var u = new URL(r.url);
                if (u.pathname.endsWith("/pdf/" + s.id + ".pdf") && u.searchParams.get("v") !== s.v) cache.delete(r);
              });
            });
          }).catch(function () {});
        }
        return res.arrayBuffer();
      });
    };
    if (!hasCaches()) return net(null);
    return caches.open(PDF_CACHE).then(function (c) {
      return c.match(url).then(function (hit) { return hit ? hit.arrayBuffer() : net(c); });
    }, function () { return net(null); });
  }

  /* ---------- 一覧 ---------- */
  var chip = "all", query = "";
  function kata(s) { return s.replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 96); }); }
  function norm(s) { return kata(s.normalize("NFKC").toLowerCase()); }
  var NS = null;
  function searchIndex() {
    if (!NS) { NS = {}; SHEETS.forEach(function (s) { NS[s.id] = (window.SEARCH[s.id] || []).map(norm); }); }
    return NS;
  }
  function cardHtml(s) {
    var on = st.fav.indexOf(s.id) >= 0;
    return '<div class="card" role="button" tabindex="0" data-open="' + s.id + '"><span class="t"><span class="n">' + esc(s.name) +
      '</span><span class="s">' + (s.sub ? esc(s.sub) + "・" : "") + s.n + "ページ" + (saved[s.id] ? '<i class="off">保存済</i>' : "") +
      '</span></span><button class="st' + (on ? " on" : "") + '" data-star="' + s.id + '" aria-label="お気に入り' + (on ? "から外す" : "に入れる") + '">' + STAR + "</button></div>";
  }
  var EXT = '<svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8M11 7H6v11h11v-5"/></svg>';
  function newsRow(n) { return '<div class="nw"><span class="d">' + esc(n.d) + "</span><span>" + esc(n.t) + "</span></div>"; }
  function group(title, list) {
    return list.length ? '<div class="grp">' + esc(title) + '</div><div class="cards">' + list.map(cardHtml).join("") + "</div>" : "";
  }
  function mark(text, terms) {
    var n = norm(text), spans = [];
    terms.forEach(function (t) { var i = -1; while ((i = n.indexOf(t, i + 1)) >= 0) spans.push([i, i + t.length]); });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var out = "", p = 0;
    spans.forEach(function (sp) { if (sp[0] < p) return; out += esc(text.slice(p, sp[0])) + "<mark>" + esc(text.slice(sp[0], sp[1])) + "</mark>"; p = sp[1]; });
    return out + esc(text.slice(p));
  }
  function renderHome() {
    var h = "";
    $("chips").innerHTML = [{ id: "all", name: "すべて" }].concat(C.cats).map(function (c) {
      return '<button class="chip' + (chip === c.id ? " on" : "") + '" data-chip="' + c.id + '">' + esc(c.name) + "</button>";
    }).join("");
    $("qClear").hidden = !query;
    var terms = norm(query).split(/\s+/).filter(Boolean);
    if (terms.length) {
      var titleHits = SHEETS.filter(function (s) { var n = norm(s.name + " " + s.sub); return terms.every(function (t) { return n.indexOf(t) >= 0; }); });
      h += group("シート", titleHits);
      var idx = searchIndex(), hits = [], total = 0;
      SHEETS.forEach(function (s) {
        idx[s.id].forEach(function (pt, pi) {
          if (!terms.every(function (t) { return pt.indexOf(t) >= 0; })) return;
          total++;
          if (hits.length >= 60) return;
          var src = window.SEARCH[s.id][pi], at = pt.indexOf(terms[0]);
          var a = Math.max(0, at - 22), b = Math.min(src.length, at + terms[0].length + 44);
          hits.push('<button class="hit" data-open="' + s.id + '" data-page="' + (pi + 1) + '"><b>' + esc(s.name) + "<i>" + (pi + 1) + " / " + s.n + "ページ</i></b><span>" +
            (a > 0 ? "…" : "") + mark(src.slice(a, b), terms) + (b < src.length ? "…" : "") + "</span></button>");
        });
      });
      if (hits.length) h += '<div class="grp">本文（' + total + "ページ" + (total > 60 ? "、うち60件を表示" : "") + "）</div>" + hits.join("");
      if (!h) h = '<div class="empty">「' + esc(query) + "」は見つからなかった。<br>ひらがなでもカタカナでも探せる。</div>";
    } else if (chip === "all") {
      h += '<p class="upd">最終更新：' + esc(C.updated) + "</p>";
      if (C.news && C.news.length) {
        h += '<div class="grp">News</div><div class="news">' + C.news.slice(0, 2).map(newsRow).join("") +
          (C.news.length > 2 ? '<button class="more" data-act="news">これまでのNewsを見る</button>' : "") + "</div>";
      }
      h += group("お気に入り", st.fav.map(function (i) { return BY[i]; }));
      h += group("最近見たもの", st.recent.filter(function (i) { return st.fav.indexOf(i) < 0; }).slice(0, 4).map(function (i) { return BY[i]; }));
      C.cats.forEach(function (c) { h += group(c.name, SHEETS.filter(function (s) { return s.cat === c.id; })); });
      if (C.links && C.links.length) {
        h += '<div class="grp">関連ツール</div><div class="cards">' + C.links.map(function (l) {
          return '<a class="card" href="' + esc(l.url) + '" target="_blank" rel="noopener"><span class="t"><span class="n">' + esc(l.name) + '</span><span class="s wrap">' + esc(l.sub) + '</span></span><span class="st">' + EXT + "</span></a>";
        }).join("") + "</div>";
      }
      if (C.feedback) h += '<button class="big ghost fb" data-act="feedback">ご意見・お問い合わせ</button>';
    } else {
      var c = C.cats.filter(function (x) { return x.id === chip; })[0];
      h += group(c.name, SHEETS.filter(function (s) { return s.cat === chip; }));
    }
    $("list").innerHTML = h;
  }
  function toggleFav(id) {
    var i = st.fav.indexOf(id);
    if (i >= 0) st.fav.splice(i, 1); else st.fav.push(id);
    save();
  }
  $("list").addEventListener("click", function (e) {
    var star = e.target.closest("[data-star]");
    if (star) { toggleFav(star.dataset.star); renderHome(); return; }
    var act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "news") { openPanel("<h2>News</h2><div class=\"news\">" + C.news.map(newsRow).join("") + "</div>"); return; }
    if (act && act.dataset.act === "feedback") { openFeedback(null); return; }
    var o = e.target.closest("[data-open]");
    if (o) openSheet(o.dataset.open, o.dataset.page ? +o.dataset.page : null, true, o.dataset.page ? query.split(/\s+/)[0] : "");
  });
  $("list").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.classList.contains("card")) openSheet(e.target.dataset.open, null, true);
  });
  $("chips").addEventListener("click", function (e) {
    var b = e.target.closest("[data-chip]"); if (!b) return;
    chip = b.dataset.chip; query = ""; $("q").value = ""; renderHome(); $("homeMain").scrollTop = 0;
  });
  var qT;
  $("q").addEventListener("input", function () {
    clearTimeout(qT); var v = this.value;
    qT = setTimeout(function () { query = v.trim(); renderHome(); $("homeMain").scrollTop = 0; }, 120);
  });
  $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") this.blur(); });
  $("qClear").addEventListener("click", function () { query = ""; $("q").value = ""; renderHome(); });

  /* ---------- 表示 ---------- */
  var scroller = $("scroller"), pagesEl = $("pages");
  var cur = null;            // 開いているシートの状態
  var zoom = 1, ZMIN = 1, ZMAX = 3;
  /* 文字サイズ：0 標準／1 大／2 特大。一覧や説明の文字と、シートを開いたときの大きさに効く */
  var FS_UI = [1, 1.15, 1.3], FS_SHEET = [1, 1.25, 1.5], FS_NAME = ["標準", "大", "特大"];
  function sheetScale() { return FS_SHEET[st.fs] || 1; }
  function startZoom() { return scroller.clientWidth >= 640 ? 1 : sheetScale(); }   // 広い画面は並べる枚数を減らして大きくする。狭い画面は拡大して開く
  function applyFs() { document.documentElement.style.setProperty("--fz", FS_UI[st.fs] || 1); }
  function fsHtml() {
    return '<div class="seg" role="group" aria-label="文字サイズ">' + FS_NAME.map(function (n, i) {
      return '<button data-fs="' + i + '"' + (st.fs === i ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '><span style="font-size:' + (14 + i * 3) + 'px">あ</span>' + n + "</button>";
    }).join("") + "</div>";
  }
  function setFs(i) {
    st.fs = i; save(); applyFs();
    Array.prototype.forEach.call(document.querySelectorAll("[data-fs]"), function (b) { var on = +b.dataset.fs === i; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    if (cur && cur.html) { try { hframe.contentDocument.documentElement.style.zoom = fsHtmlZoom(); if (cur.pad) cur.pad(); } catch (e) {} }
    if (cur && cur.pgs.length) { var p = cur.page; zoom = startZoom(); layout(); updateZoomLabel(); scroller.scrollLeft = 0; scrollToPage(p - 1, 0, false); cur.gen++; pump(); }
  }
  var DPR = Math.min(window.devicePixelRatio || 1, 3);
  var ONE_MAX = 10e6, ALL_MAX = 36e6;   // 1ページ・全体で持つ画素数の上限

  function showView(name) {
    $("home").hidden = name !== "home";
    $("viewer").hidden = name !== "viewer";
  }
  function setLoading(msg, err) {
    var l = $("loading");
    if (!msg) { l.hidden = true; return; }
    l.hidden = false; l.classList.toggle("err", !!err); $("loadMsg").innerHTML = msg;
  }
  function updateStar() {
    var on = cur && st.fav.indexOf(cur.s.id) >= 0;
    $("btnStar").classList.toggle("on", !!on);
  }

  /* HTML版（文字の大きさに合わせて折り返す）。そのシートにHTML版があり、PDF表示を選んでいないときに使う */
  var hframe = $("hframe");
  function useHtml(s) { return !!s.html && !st.usePdf[s.id]; }
  function fsHtmlZoom() { return [1, 1.2, 1.4][st.fs] || 1; }
  function setMode(s) {
    var b = $("btnMode"), h = useHtml(s);
    b.hidden = !s.html; b.textContent = h ? "PDF" : "HTML";
    b.setAttribute("aria-label", h ? "PDFで表示する" : "HTML版で表示する");
    $("viewer").classList.toggle("hm", h); hframe.hidden = !h;
  }
  function openHtml(s, page, push, term) {
    var id = s.id, my = cur = { s: s, html: true, pdf: null, pgs: [], vis: {}, gen: 0, page: 1, busy: false, links: {} };
    showView("viewer"); setMode(s);
    $("vName").textContent = s.name; $("vSub").textContent = s.sub; updateStar();
    if (push) history.pushState({ s: id }, "", "#" + id);
    st.recent = [id].concat(st.recent.filter(function (i) { return i !== id; })).slice(0, 8); save();
    setLoading("読み込み中");
    fetch(htmlUrl(s)).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }).then(function () {
      if (cur !== my) return;
      hframe.onload = function () {
        if (cur !== my) return;
        var d, w;
        try { d = hframe.contentDocument; w = hframe.contentWindow; } catch (e) { return; }
        if (!d || !d.body || d.location.href === "about:blank") return;
        setLoading(null);
        d.documentElement.style.zoom = fsHtmlZoom();
        var pad = function () { var t = d.querySelector(".wtools"); if (t) d.documentElement.style.scrollPaddingTop = (t.offsetHeight + 8) + "px"; };   // 上に固定された検索欄に見出しが隠れないようにする
        pad(); my.pad = pad;
        var h1 = d.querySelector(".wtop h1"); if (h1) h1.textContent = s.name + (s.sub ? "　" + s.sub : "");
        Array.prototype.forEach.call(d.querySelectorAll('a[href^="http"]'), function (a) { a.target = "_blank"; a.rel = "noopener noreferrer"; });
        d.addEventListener("click", function (e) {      // ページ内の移動で「戻る」の履歴を増やさない
          var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
          e.preventDefault();
          var t = d.getElementById(a.getAttribute("href").slice(1)); if (t) t.scrollIntoView();
        });
        var q = d.getElementById("q");
        if (term && q) { q.value = term; q.dispatchEvent(new Event("input", { bubbles: true })); }
        else if (st.posH[id]) w.scrollTo(0, st.posH[id]);
      };
      hframe.contentWindow.location.replace(new URL(htmlUrl(s), location.href).href);   // 履歴を増やさずに読み込む
    }).catch(function (err) {
      if (cur !== my) return;
      console.warn(err);
      setLoading("読み込めなかった。<br>通信できる場所で一度開くと、次からは圏外でも見られる。<br><button class=\"big\" id=\"retry\" style=\"width:auto;padding:0 22px;margin:14px auto 0\">もう一度</button>", true);
      $("retry").onclick = function () { openSheet(id, page, false, term); };
    });
  }
  $("btnMode").addEventListener("click", function () {
    if (!cur) return;
    var s = cur.s;
    if (useHtml(s)) st.usePdf[s.id] = 1; else delete st.usePdf[s.id];
    save(); openSheet(s.id, null, false);
  });
  function openSheet(id, page, push, term) {
    var s = BY[id]; if (!s) return;
    closeSheetDoc();
    if (useHtml(s)) { openHtml(s, page, push, term); return; }
    setMode(s);
    var my = cur = { s: s, pdf: null, pgs: [], vis: {}, gen: 0, page: 1, busy: false, links: {} };
    showView("viewer");
    zoom = startZoom();
    $("vName").textContent = s.name; $("vSub").textContent = s.sub;
    updateStar(); updateZoomLabel();
    if (push) history.pushState({ s: id }, "", "#" + id);
    st.recent = [id].concat(st.recent.filter(function (i) { return i !== id; })).slice(0, 8); save();

    pagesEl.innerHTML = "";
    for (var i = 0; i < s.n; i++) {
      var d = document.createElement("div");
      d.className = "pg"; d.dataset.i = i; d.style.aspectRatio = s.w + " / " + s.h;
      pagesEl.appendChild(d); my.pgs.push({ el: d, canvas: null, w: 0 });
    }
    layout();
    var start = page || st.pos[id] || 1;
    scroller.scrollLeft = 0; scrollToPage(Math.min(start, s.n) - 1, 0, false);
    updatePageNo();
    setLoading("読み込み中");

    fetchPdf(s).then(function (buf) {
      if (cur !== my) return;
      return window.pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise.then(function (pdf) {
        if (cur !== my) { pdf.destroy(); return; }
        my.pdf = pdf; setLoading(null);
        my.io = new IntersectionObserver(function (ents) {
          ents.forEach(function (en) { if (en.isIntersecting) my.vis[en.target.dataset.i] = 1; else delete my.vis[en.target.dataset.i]; });
          pump();
        }, { root: scroller, rootMargin: "60% 0px" });
        my.pgs.forEach(function (p) { my.io.observe(p.el); });
        if (page) flash(page - 1);
      });
    }).catch(function (err) {
      if (cur !== my) return;
      console.warn(err); pagesEl.innerHTML = ""; my.pgs = [];
      setLoading("読み込めなかった。<br>通信できる場所で一度開くと、次からは圏外でも見られる。<br><button class=\"big\" id=\"retry\" style=\"width:auto;padding:0 22px;margin:14px auto 0\">もう一度</button>", true);
      $("retry").onclick = function () { openSheet(id, page, false); };
    });
  }
  function closeSheetDoc() {
    if (!cur) return;
    if (cur.html) {
      try { var y = Math.round(hframe.contentWindow.scrollY || 0); if (y > 0) st.posH[cur.s.id] = y; else delete st.posH[cur.s.id]; save(); } catch (e) {}
      hframe.onload = null; try { hframe.contentWindow.location.replace("about:blank"); } catch (e) {}
    }
    if (cur.io) cur.io.disconnect();
    if (cur.task) { try { cur.task.cancel(); } catch (e) {} }
    if (cur.pdf) cur.pdf.destroy();
    cur.pgs.forEach(function (p) { if (p.canvas) { p.canvas.width = p.canvas.height = 0; } });
    cur = null; pagesEl.innerHTML = "";
  }
  function goHome() {
    closeSheetDoc(); setLoading(null); $("viewer").classList.remove("hm"); hframe.hidden = true; showView("home");
    refreshSaved().then(renderHome); renderHome();
  }

  function cols() { var w = scroller.clientWidth / sheetScale(); return w >= 1000 ? 3 : w >= 640 ? 2 : 1; }
  function layout() {
    var n = cols(), base = Math.min(scroller.clientWidth, n * 470 * sheetScale());
    pagesEl.style.gridTemplateColumns = "repeat(" + n + ",1fr)";
    pagesEl.style.width = Math.round(base * zoom) + "px";
  }
  function scrollToPage(i, frac, smooth) {
    if (!cur || !cur.pgs.length) return;
    var el = cur.pgs[Math.max(0, Math.min(cur.s.n - 1, i))].el;
    var top = el.offsetTop + (frac || 0) * el.offsetHeight - 8;
    var left = zoom > 1.02 ? scroller.scrollLeft : 0;
    if (cols() > 1 && zoom > 1.02) left = Math.max(0, el.offsetLeft - 8);
    scroller.scrollTo({ top: Math.max(0, top), left: left, behavior: smooth ? "smooth" : "auto" });
  }
  function flash(i) {
    var el = cur && cur.pgs[i] && cur.pgs[i].el; if (!el) return;
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }
  function currentPage() {
    if (!cur || !cur.pgs.length) return 1;
    var y = scroller.scrollTop + scroller.clientHeight * 0.3, x = scroller.scrollLeft + scroller.clientWidth * 0.3, best = 0;
    for (var i = 0; i < cur.pgs.length; i++) {
      var el = cur.pgs[i].el;
      if (el.offsetTop <= y && (el.offsetLeft <= x || cols() === 1)) best = i;
      if (el.offsetTop > y) break;
    }
    return best + 1;
  }
  function currentPos() {   // いま画面の上端にあるページ番号＋ページ内の位置（1ページ目の真ん中なら1.5）
    var p = currentPage(), el = cur.pgs[p - 1].el;
    return p + Math.max(0, Math.min(0.999, (scroller.scrollTop + 10 - el.offsetTop) / el.offsetHeight));
  }
  function updatePageNo() {
    if (!cur || !cur.pgs.length) return;
    var p = currentPage();
    $("pageNo").textContent = p + " / " + cur.s.n;
    if (p !== cur.page) {
      cur.page = p; st.pos[cur.s.id] = p; save();
      try { history.replaceState(history.state, "", "#" + cur.s.id + (p > 1 ? "/" + p : "")); } catch (e) {}
    }
  }
  var scT;
  scroller.addEventListener("scroll", function () {
    if (scT) return;
    scT = requestAnimationFrame(function () { scT = 0; updatePageNo(); });
  }, { passive: true });

  /* 描画：見えている所から順に1ページずつ。倍率が変わったら描き直す */
  function targetW(my, p) {
    var cssW = p.el.clientWidth, w = Math.round(cssW * DPR), h = w * my.s.h / my.s.w;
    if (w * h > ONE_MAX) w = Math.floor(Math.sqrt(ONE_MAX * my.s.w / my.s.h));
    return w;
  }
  function pump() {
    var my = cur; if (!my || !my.pdf || my.busy) return;
    var mid = scroller.scrollTop + scroller.clientHeight / 2, pick = -1, bestD = Infinity;
    Object.keys(my.vis).forEach(function (k) {
      var p = my.pgs[k]; if (!p || Math.abs(p.w - targetW(my, p)) <= 2) return;
      var d = Math.abs(p.el.offsetTop + p.el.offsetHeight / 2 - mid);
      if (d < bestD) { bestD = d; pick = +k; }
    });
    if (pick < 0) { evict(); return; }
    my.busy = true;
    var gen = my.gen, p = my.pgs[pick], w = targetW(my, p);
    my.pdf.getPage(pick + 1).then(function (page) {
      if (cur !== my) return;
      var vp = page.getViewport({ scale: w / page.view[2] === Infinity ? 1 : w / (page.view[2] - page.view[0]) });
      var cv = document.createElement("canvas");
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      my.task = page.render({ canvasContext: cv.getContext("2d", { alpha: false }), viewport: vp });
      var linkJob = my.links[pick] ? null : addLinks(my, pick, page);
      return my.task.promise.then(function () {
        if (cur !== my) return;
        if (p.canvas) { p.canvas.width = p.canvas.height = 0; p.canvas.remove(); }
        p.canvas = cv; p.w = gen === my.gen ? w : -1; p.px = cv.width * cv.height;
        p.el.insertBefore(cv, p.el.firstChild);
        return linkJob;
      });
    }).catch(function (e) { if (cur !== my) return; if (e && e.name !== "RenderingCancelledException") console.error(e); p.w = targetW(my, p); })
      .then(function () { if (cur === my) { my.busy = false; my.task = null; pump(); } });
  }
  function evict() {
    var my = cur, total = 0, far = [];
    if (!my) return;
    var mid = scroller.scrollTop + scroller.clientHeight / 2;
    my.pgs.forEach(function (p, i) {
      if (!p.canvas) return;
      total += p.px;
      if (!my.vis[i]) far.push([Math.abs(p.el.offsetTop - mid), p]);
    });
    far.sort(function (a, b) { return b[0] - a[0]; });
    while (total > ALL_MAX && far.length) {
      var p = far.shift()[1]; total -= p.px;
      p.canvas.width = p.canvas.height = 0; p.canvas.remove(); p.canvas = null; p.w = 0;
    }
  }

  /* PDFの中のリンク（目次のタップ移動・外部リンク） */
  function addLinks(my, i, page) {
    my.links[i] = true;
    return page.getAnnotations().then(function (as) {
      if (cur !== my) return;
      var v = page.view, W = v[2] - v[0], H = v[3] - v[1], host = my.pgs[i].el;
      as.forEach(function (a) {
        if (a.subtype !== "Link" || !a.rect || (!a.url && !a.dest)) return;
        var el = document.createElement("a"), r = a.rect;
        el.style.left = (Math.min(r[0], r[2]) - v[0]) / W * 100 + "%";
        el.style.top = (1 - (Math.max(r[1], r[3]) - v[1]) / H) * 100 + "%";
        el.style.width = Math.abs(r[2] - r[0]) / W * 100 + "%";
        el.style.height = Math.abs(r[3] - r[1]) / H * 100 + "%";
        if (a.url) { el.href = a.url; el.target = "_blank"; el.rel = "noopener noreferrer"; }
        else { el.href = "#"; el.addEventListener("click", function (e) { e.preventDefault(); goDest(my, a.dest); }); }
        host.appendChild(el);
      });
    }).catch(function () {});
  }
  function goDest(my, dest) {
    Promise.resolve(typeof dest === "string" ? my.pdf.getDestination(dest) : dest).then(function (d) {
      if (!d || cur !== my) return;
      return Promise.resolve(typeof d[0] === "object" ? my.pdf.getPageIndex(d[0]) : d[0]).then(function (idx) {
        if (cur !== my) return;
        var kind = d[1] && d[1].name, y = kind === "XYZ" ? d[3] : (kind === "FitH" || kind === "FitBH") ? d[2] : null;
        var frac = (y == null || !isFinite(y)) ? 0 : Math.max(0, Math.min(1, 1 - y / my.s.h));
        scrollToPage(idx, frac, false); flash(idx);
      });
    }).catch(function () {});
  }

  /* 拡大縮小 */
  var zT;
  function updateZoomLabel() { $("btnZoom").textContent = Math.round(zoom * 100) + "%"; }
  function setZoom(z, cx, cy) {
    if (!cur) return;
    z = Math.max(ZMIN, Math.min(ZMAX, z));
    if (Math.abs(z - zoom) < 0.001) return;
    var r = scroller.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; } else { cx -= r.left; cy -= r.top; }
    var W0 = pagesEl.offsetWidth, H0 = pagesEl.offsetHeight;
    var offX = pagesEl.offsetLeft, fx = (scroller.scrollLeft + cx - offX) / W0, fy = (scroller.scrollTop + cy) / H0;
    zoom = z; layout();
    var W1 = pagesEl.offsetWidth, H1 = pagesEl.offsetHeight;
    scroller.scrollLeft = fx * W1 + pagesEl.offsetLeft - cx;
    scroller.scrollTop = fy * H1 - cy;
    updateZoomLabel();
    clearTimeout(zT);
    zT = setTimeout(function () { if (cur) { cur.gen++; if (cur.task && cur.busy) { /* 今の1枚は描き切ってから描き直す */ } pump(); } }, 160);
  }
  $("btnIn").addEventListener("click", function () { setZoom(zoom < 1.5 ? 1.5 : zoom < 2 ? 2 : zoom + 0.5); });
  $("btnOut").addEventListener("click", function () { setZoom(zoom > 2 ? zoom - 0.5 : zoom > 1.5 ? 1.5 : 1); });
  $("btnZoom").addEventListener("click", function () { setZoom(Math.abs(zoom - startZoom()) < 0.03 ? 1 : startZoom()); });

  var pinch = null, lastTap = null;
  function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  scroller.addEventListener("touchstart", function (e) {
    if (e.touches.length === 2) { pinch = { d: dist(e.touches), z: zoom }; lastTap = null; }
  }, { passive: true });
  scroller.addEventListener("touchmove", function (e) {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    setZoom(pinch.z * dist(e.touches) / pinch.d, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
  }, { passive: false });
  scroller.addEventListener("touchend", function (e) {
    if (pinch) { if (e.touches.length < 2) pinch = null; return; }
    if (e.changedTouches.length !== 1 || e.touches.length) return;
    var t = e.changedTouches[0], now = Date.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 32) {
      e.preventDefault(); lastTap = null;
      setZoom(zoom > startZoom() + 0.05 ? startZoom() : 2, t.clientX, t.clientY);
    } else lastTap = { t: now, x: t.clientX, y: t.clientY };
  }, { passive: false });
  scroller.addEventListener("touchmove", function () { lastTap = null; }, { passive: true });
  scroller.addEventListener("dblclick", function (e) { setZoom(zoom > startZoom() + 0.05 ? startZoom() : 2, e.clientX, e.clientY); });
  scroller.addEventListener("wheel", function (e) {
    if (!e.ctrlKey) return; e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
  }, { passive: false });
  var rsT;
  window.addEventListener("resize", function () {
    clearTimeout(rsT);
    rsT = setTimeout(function () { if (!cur) return; var p = cur.page; layout(); scrollToPage(p - 1, 0, false); cur.gen++; pump(); }, 150);
  });

  document.addEventListener("keydown", function (e) {
    if (!cur || !$("sheet").hidden) return;
    if (e.key === "PageDown" || e.key === "ArrowRight") { e.preventDefault(); scrollToPage(currentPage(), 0, false); }
    if (e.key === "PageUp" || e.key === "ArrowLeft") { e.preventDefault(); scrollToPage(currentPage() - 2, 0, false); }
  });
  $("btnBack").addEventListener("click", function () { if (history.state && history.state.s) history.back(); else goHome(); });
  $("btnStar").addEventListener("click", function () {
    if (!cur) return; toggleFav(cur.s.id); updateStar();
    toast(st.fav.indexOf(cur.s.id) >= 0 ? "お気に入りに入れた" : "お気に入りから外した");
  });

  /* ---------- 下から出るパネル（目次・このアプリについて） ---------- */
  function openPanel(html) {
    $("sheetBody").innerHTML = html; $("sheetBody").scrollTop = 0;
    $("shade").hidden = false; $("sheet").hidden = false;
    var s = history.state || {};
    if (!s.panel) history.pushState({ s: s.s, panel: true }, "");
  }
  function hidePanel() { $("shade").hidden = true; $("sheet").hidden = true; }
  function closePanel() { if (history.state && history.state.panel) history.back(); else hidePanel(); }
  $("shade").addEventListener("click", closePanel);

  $("btnToc").addEventListener("click", function () {
    if (!cur) return;
    var s = cur.s, p = currentPage(), rows = [[1, "表紙・目次", 0]].concat(s.toc);
    if (!s.toc.length) { rows = []; for (var i = 1; i <= s.n; i++) rows.push([i, (window.SEARCH[s.id][i - 1] || "").slice(0, 26) || i + "ページ", 0]); }
    var here = currentPos(), curIdx = 0; rows.forEach(function (r, i) { if (r[0] + r[2] <= here + 0.02) curIdx = i; });
    openPanel("<h2>" + esc(s.name) + " の目次</h2>" + rows.map(function (r, i) {
      return '<button class="row' + (i === curIdx ? " cur" : "") + '" data-go="' + r[0] + '" data-f="' + r[2] + '"><span class="p">p.' + r[0] + "</span><span>" + esc(r[1]) + "</span></button>";
    }).join(""));
    var c = $("sheetBody").querySelector(".cur"); if (c) c.scrollIntoView({ block: "center" });
  });
  $("btnFs").addEventListener("click", function () {
    openPanel("<h2>文字サイズ</h2>" + fsHtml() + "<p>一覧や説明の文字と、シートの文字の大きさが変わる。HTML版があるシートは画面の幅で折り返す。PDFのシートは拡大して開くので、幅に収まらないときは横にも動かして読む。</p>");
  });
  $("btnFs2").addEventListener("click", function () { $("btnFs").click(); });
  $("sheetBody").addEventListener("click", function (e) {
    var fsb = e.target.closest("[data-fs]");
    if (fsb) { setFs(+fsb.dataset.fs); return; }
    var g = e.target.closest("[data-go]");
    if (g) { var pg = +g.dataset.go, fr = +g.dataset.f || 0; closePanel(); setTimeout(function () { scrollToPage(pg - 1, fr, false); flash(pg - 1); }, 60); return; }
    if (e.target.id === "saveAll") saveAll(e.target);
    if (e.target.id === "fbSend") sendFeedback(e.target);
    if (e.target.id === "fbOpen") { hidePanel(); openFeedback(cur ? cur.s.id : null); }
    if (e.target.id === "reload") {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); }).catch(function () {}).then(function () { location.reload(); });
      else location.reload();
    }
  });
  function infoHtml() {
    var n = SHEETS.filter(function (s) { return saved[s.id]; }).length;
    var mb = Math.round(SHEETS.reduce(function (a, s) { return a + s.kb; }, 0) / 1024);
    return "<h2>このアプリについて</h2>" +
      "<p>作成したone-pager" + SHEETS.length + "枚を、スマホで読みやすい大きさで開く。検索は病名・薬剤名のほか本文も探せる。</p>" +
      "<h3>圏外で使う</h3><p>一度開いたシートは端末に保存され、次からは通信なしで開ける。先に全部保存しておくこともできる。<br>端末に保存済み：<b id=\"savedN\">" + n + " / " + SHEETS.length + "</b></p>" +
      (hasCaches() ? '<button class="big" id="saveAll"' + (n === SHEETS.length ? " disabled" : "") + ">" + (n === SHEETS.length ? "すべて保存済み" : "すべて端末に保存（約" + mb + "MB）") + "</button>" : "<p>このブラウザでは端末への保存が使えない。</p>") +
      "<h3>ホーム画面に置く</h3><p>ブラウザのメニューから「ホーム画面に追加」を選ぶと、アプリのように起動できる。</p>" +
      "<h3>文字サイズ</h3>" + fsHtml() +
      "<h3>操作</h3><p>拡大はピンチ、ダブルタップ、右下の＋−。倍率の数字を押すと元に戻る。文字サイズは右上の「あ」からも変えられる。HTML版があるシートは、文字を大きくしても画面の幅で折り返す。右上の「PDF」「HTML」で表示を切り替えられる。目次の行をタップするとその項目へ移動する。前回読んでいたページから再開する。</p>" +
      "<h3>注意</h3><p>個人で作成した学習用のまとめで、内容の正確さを保証するものではない。診療に使うときは、各シートに記載の原典・最新のガイドライン・添付文書を確認すること。患者情報は入力・保存しない。</p>" +
      (C.feedback ? '<h3>ご意見・お問い合わせ</h3><p>内容の誤りや使いにくい点があれば知らせてください。</p><button class="big ghost" id="fbOpen">ご意見・お問い合わせを書く</button>' : "") +
      '<button class="big ghost" id="reload">最新版を確認して読み込み直す</button>' +
      '<p style="color:var(--mut);font-size:12px;margin-top:12px">最終更新 ' + esc(C.updated) + "　版 " + esc(C.version) + "</p>";
  }
  function openFeedback(preId) {
    var opts = ['<option value="アプリ全体">アプリ全体（特定のページではない）</option>'].concat(SHEETS.map(function (s) {
      return '<option value="' + esc(s.name) + '"' + (preId === s.id ? " selected" : "") + ">" + esc(s.name) + "</option>";
    }));
    openPanel("<h2>ご意見・お問い合わせ</h2>" +
      '<label class="fl">どのページ<select id="fbPage">' + opts.join("") + "</select></label>" +
      '<label class="fl">問題点<textarea id="fbText" rows="6" maxlength="2000" placeholder="例：3ページ目の表の用量が添付文書と違う"></textarea></label>' +
      '<p class="fnote">患者さんの氏名・ID・病歴など、個人が分かる情報は書かないでください。返信が必要な場合は連絡先も書いてください。</p>' +
      '<button class="big" id="fbSend">送信</button>');
  }
  function sendFeedback(btn) {
    var text = $("fbText").value.trim(), page = $("fbPage").value, f = C.feedback;
    if (!text) { toast("問題点を書いてください"); return; }
    btn.disabled = true; btn.textContent = "送信中";
    var body = new URLSearchParams(); body.append(f.page, page); body.append(f.text, text + "\n\n（版 " + C.version + "／" + C.updated + "）");
    fetch(f.action, { method: "POST", mode: "no-cors", body: body }).then(function () {
      $("sheetBody").innerHTML = "<h2>送信しました</h2><p>ありがとうございます。内容を確認します。</p>";
    }, function () {
      btn.disabled = false; btn.textContent = "送信"; toast("送信できなかった。通信できる場所でもう一度");
    });
  }
  $("btnInfo").addEventListener("click", function () { refreshSaved().then(function () { openPanel(infoHtml()); }); });
  function saveAll(btn) {
    btn.disabled = true;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    var todo = SHEETS.filter(function (s) { return !saved[s.id]; }), fail = 0, i = 0;
    (function next() {
      if (i >= todo.length) {
        refreshSaved().then(function () {
          var n = SHEETS.filter(function (s) { return saved[s.id]; }).length;
          if ($("savedN")) $("savedN").textContent = n + " / " + SHEETS.length;
          btn.textContent = fail ? fail + "枚を保存できなかった。もう一度" : "すべて保存済み";
          btn.disabled = !fail; renderHome();
        });
        return;
      }
      btn.textContent = "保存中 " + (i + 1) + " / " + todo.length;
      var s = todo[i++];
      caches.open(PDF_CACHE).then(function (c) {
        return fetch(pdfUrl(s)).then(function (res) { if (!res.ok) throw new Error("HTTP"); return c.put(pdfUrl(s), res); }).then(function () {
          if (!s.html) return;
          return fetch(htmlUrl(s)).then(function (res) { if (!res.ok) throw new Error("HTTP"); return c.put(htmlUrl(s), res); });
        });
      }).then(function () { saved[s.id] = true; }, function () { fail++; }).then(next);
    })();
  }

  /* ---------- 画面の行き来（端末の「戻る」に対応） ---------- */
  window.addEventListener("popstate", function (e) {
    var s = e.state || {};
    if (!s.panel) hidePanel();
    if (s.s) { if (!cur || cur.s.id !== s.s) openSheet(s.s, null, false); }
    else if (cur || !$("viewer").hidden) goHome();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (!$("sheet").hidden) closePanel(); else if (cur) $("btnBack").click(); }
    if (e.key === "/" && !cur && document.activeElement !== $("q")) { e.preventDefault(); $("q").focus(); }
  });

  /* ---------- 起動 ---------- */
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  /* 新しい版が出ていたら、一覧を見ているときに1回だけ自動で読み込み直す */
  function checkFresh() {
    if (cur || !$("sheet").hidden || !navigator.onLine) return;
    fetch("catalog.js?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
      var u = (t.match(/"updated":"([^"]*)"/) || [])[1], done = null;
      if (!u || u === C.updated || cur) return;
      try { done = sessionStorage.getItem("opFresh"); sessionStorage.setItem("opFresh", u); } catch (e) { return; }
      if (done === u) return;     // 同じ版で2回は読み込み直さない
      var go = function () { location.reload(); };
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); }).catch(function () {}).then(go);
      else go();
    }).catch(function () {});
  }
  setTimeout(checkFresh, 1200);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) checkFresh(); });
  applyFs();
  var m = location.hash.match(/^#([a-z0-9-]+)(?:\/(\d+))?$/);
  history.replaceState({}, "", location.pathname + location.search);
  renderHome();
  refreshSaved().then(function () { if (!cur) renderHome(); });
  if (m && BY[m[1]]) openSheet(m[1], m[2] ? +m[2] : null, true);
})();
