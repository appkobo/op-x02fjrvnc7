#!/usr/bin/env python3
"""確認リストとDriveの状態から、何を公開するかを決める。
  python3 plan.py rows.json drive.json            → plan.json を書き、変更の有無を表示
  python3 plan.py --news plan.json                → 組み立ての前に news.json へ1行足す
  python3 plan.py --state plan.json               → 公開が成功したあと state.json を更新
rows.json : 確認リストの行の配列。各行は [テーマ, エビデンス確認, ハルシネーション確認, A4版, スマホ版, iPad版, PDFは最新か]（見出し行は含めても含めなくてもよい）
drive.json: Driveの検索結果の files の配列（id, title, parentId, modifiedTime を使う）
掲載の基準: エビデンス確認＝済、ハルシネーション確認＝済、PDFは最新か＝最新 の3つがそろい、スマホ版PDFがDriveにあること。
"""
import sys, os, re, json, hashlib, datetime, zoneinfo
HERE = os.path.dirname(os.path.abspath(__file__))
J = lambda n: os.path.join(HERE, n)
load = lambda p: json.load(open(p, encoding="utf-8"))
def dump(o, p): json.dump(o, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def pick(entry, files, folder):
    c = [f for f in files if f.get("title", "").endswith("スマホ版.pdf") and not f.get("trashed")
         and all(m in f["title"] for m in entry["match"]) and not any(x in f["title"] for x in entry.get("exclude", []))]
    inf = [f for f in c if f.get("parentId") == folder]
    c = inf or c          # 「スマホ版」フォルダにあるものを優先。なければ他の場所
    return max(c, key=lambda f: f.get("modifiedTime", "")) if c else None

def make(rows_p, drive_p):
    conf, state = load(J("config.json")), load(J("state.json"))
    rows = [r for r in load(rows_p) if r and r[0] and r[0] != "テーマ"]
    files = load(drive_p)
    if len(rows) < 10 or len(files) < 5:   # 読み取りに失敗したまま進むと全部消してしまうので止める
        print("changed: STOP（確認リストかDriveの読み取りが少なすぎる。rows=%d files=%d）" % (len(rows), len(files))); sys.exit(2)
    by_theme = {s["theme"]: (i, s) for i, s in enumerate(conf["sheets"])}
    pub, blocked, unknown = [], [], []
    for r in rows:
        r = list(r) + [None] * 7
        theme, ok = r[0].strip(), (r[1] == "済" and r[2] == "済" and r[6] == "最新")
        if not ok:
            continue
        short = re.sub(r"（[^（）]*）$", "", theme)   # 末尾のかっこ書き（出典名など）を外した名前でも探す
        if theme in by_theme:
            i, s = by_theme[theme]
        elif short in by_theme:
            i, s = by_theme[short]
        else:   # 設定にないテーマは「その他」に入れる
            i, s = 900, {"id": "x" + hashlib.sha1(theme.encode()).hexdigest()[:6], "cat": "etc", "name": short, "sub": "", "theme": theme, "match": [short]}
            unknown.append(theme)
        f = pick(s, files, conf["driveSmartphoneFolder"])
        if not f:
            blocked.append(theme); continue
        old = state["published"].get(s["id"])
        act = "add" if not old else ("keep" if old.get("driveId") == f["id"] and old.get("modified") == f.get("modifiedTime") else "update")
        pub.append({"id": s["id"], "cat": s["cat"], "name": s["name"], "sub": s["sub"], "order": i, "title": f["title"],
                    "driveId": f["id"], "modified": f.get("modifiedTime"), "action": act})
    ids = {e["id"] for e in pub}
    names = {s["id"]: s["name"] for s in conf["sheets"]}
    remove = [{"id": k, "name": v.get("name") or names.get(k, k)} for k, v in state["published"].items() if k not in ids]
    plan = {"publish": pub, "remove": remove, "blocked": blocked, "unknown": unknown,
            "changed": bool(remove) or any(e["action"] != "keep" for e in pub)}
    if len(remove) > 3 or (state["published"] and not pub):   # 一度に大きく減るのは読み違いの疑い。人に確認する
        dump(plan, J("plan.json"))
        print("changed: STOP（一度に %d 枚の掲載をやめる計画になった。自動では進めない）" % len(remove)); sys.exit(2)
    dump(plan, J("plan.json"))
    print("changed:", plan["changed"])
    for e in pub:
        if e["action"] != "keep": print(" ", e["action"], e["id"], e["name"], "←", e["title"], e["driveId"])
    for e in remove: print("  remove", e["id"], e["name"])
    if blocked: print("  基準は満たすがスマホ版PDFが見つからない:", "、".join(blocked))
    if unknown: print("  設定にないテーマ（その他に入れた）:", "、".join(unknown))

def news(plan_p):
    plan, news = load(plan_p), load(J("news.json"))
    d = datetime.datetime.now(zoneinfo.ZoneInfo("Asia/Tokyo")).strftime("%Y.%m.%d")
    add = [e["name"] for e in plan["publish"] if e["action"] == "add"]
    upd = [e["name"] for e in plan["publish"] if e["action"] == "update"]
    rem = [e["name"] for e in plan["remove"]]
    new = []
    if add: new.append({"d": d, "t": "「" + "」「".join(add) + "」を追加しました"})
    if upd: new.append({"d": d, "t": "「" + "」「".join(upd) + "」を更新しました"})
    if rem: new.append({"d": d, "t": "「" + "」「".join(rem) + "」は内容を確認中のため、掲載を一時止めています"})
    dump(new + news, J("news.json"))
    print("news +", len(new))

def state(plan_p):
    plan = load(plan_p)
    dump({"published": {e["id"]: {"driveId": e["driveId"], "modified": e["modified"], "name": e["name"]} for e in plan["publish"]}}, J("state.json"))
    print("state:", len(plan["publish"]), "枚")

if __name__ == "__main__":
    if sys.argv[1] == "--news": news(sys.argv[2])        # 組み立ての前：Newsを足す
    elif sys.argv[1] == "--state": state(sys.argv[2])    # 公開が成功した後：公開中の記録を更新
    else: make(sys.argv[1], sys.argv[2])
