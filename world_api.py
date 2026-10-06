"""用户网页（/create）后端：照片 + 一句想法 + 风格 → 一卷音乐长卷（world.json）。

接口（JSON）：
  GET  /api/styles                       风格卡（prototype/assets/styles/styles.json）
  POST /api/worlds                       {idea, style, nameplate, photos:[{data, caption, w, h}]} → 新世界
  GET  /api/worlds/<id>                  world.json + 每站重画的进度
  PUT  /api/worlds/<id>                  保存 world.json（排布、音乐、纪念品都由网页改好后整份存回）
  POST /api/worlds/<id>/analyze          Claude 看每张照片：站名、可以立体化的主体和它的框（没装 anthropic 就跳过）
  POST /api/worlds/<id>/paint/<i>        Tripo generate_image：把第 i 张照片按所选风格重画成长卷的一站
  POST /api/worlds/<id>/publish          标记为完成，返回相框地址

世界保存在 prototype/worlds/<id>/（不进仓库）。站内元素生成 3D 走布景工作台的流水线（studio_api.py，槽位 w_<id>_<元素>）。
"""
import base64
import json
import os
import pathlib
import re
import secrets
import threading
import time
import urllib.parse
import urllib.request

import musicbox_api
import studio_api

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE / "prototype"
WORLDS = ROOT / "worlds"
STYLES = ROOT / "assets" / "styles" / "styles.json"
WORLD_ID = re.compile(r"^[a-z0-9]{6,32}$|^sample-[a-z0-9-]{1,32}$")
MAX_BODY = 60 * 1024 * 1024
MAX_PHOTOS = 5
STATION = (1200, 1920)

PAINT_PROMPT = (
    "Redraw this photo as one panel of a long horizontal illustrated scroll. Style: {style}. "
    "Keep the place, the people and the key objects recognizable{idea}. "
    "Tall 10:16 panel, main subject in the center third, ground line around 80% of the height, open sky in the top quarter, "
    "the left and right edges are calm continuous scenery so this panel can join its neighbours. "
    "Large clear shapes, no tiny text, no border, no frame, no watermark, no signature.")

_lock = threading.Lock()
_paint = {}  # (id, i) → {stage, progress, error}


def styles():
    return json.loads(STYLES.read_text())


def _style(sid):
    return next((s for s in styles() if s["id"] == sid), styles()[0])


def _dir(wid):
    if not WORLD_ID.match(wid or ""):
        raise FileNotFoundError(wid)
    return WORLDS / wid


def read(wid):
    f = _dir(wid) / "world.json"
    w = json.loads(f.read_text())
    w["id"] = wid
    w["paint"] = {str(i): _paint[(wid, i)] for (k, i) in list(_paint) if k == wid}
    return w


def write(wid, w):
    w = {k: v for k, v in w.items() if k not in ("id", "paint")}
    d = _dir(wid)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "world.json.tmp"
    tmp.write_text(json.dumps(w, ensure_ascii=False, indent=1))
    tmp.replace(d / "world.json")


def _cover(w, h):
    """照片铺满一站（1200×1920），返回卡片的 x, y, w, h"""
    k = max(STATION[0] / w, STATION[1] / h)
    cw, ch = w * k, h * k
    return round((STATION[0] - cw) / 2), round((STATION[1] - ch) / 2), round(cw), round(ch)


def create(payload):
    photos = (payload.get("photos") or [])[:MAX_PHOTOS]
    if not photos:
        raise ValueError("至少上传一张照片")
    st = _style(payload.get("style"))
    wid = secrets.token_hex(5)
    d = _dir(wid)
    d.mkdir(parents=True)
    stations = []
    for i, p in enumerate(photos):
        m = re.match(r"data:image/(\w+);base64,(.+)", p.get("data") or "", re.S)
        if not m:
            raise ValueError(f"第 {i + 1} 张照片格式不对")
        ext = "jpg" if m.group(1) in ("jpeg", "jpg") else m.group(1)
        (d / f"photo-{i}.{ext}").write_bytes(base64.b64decode(m.group(2)))
        x, y, w, h = _cover(p.get("w") or 1200, p.get("h") or 1920)
        stations.append({
            "title": (p.get("caption") or "").strip()[:20] or f"第 {i + 1} 站",
            "photo": f"photo-{i}.{ext}", "photoSize": [p.get("w"), p.get("h")],
            "layers": [
                {"id": "sky", "kind": "gradient", "top": st["sky"][0], "bottom": st["sky"][1], "depth": -8},
                {"id": "art", "kind": "card", "src": f"photo-{i}.{ext}", "x": x, "y": y, "w": w, "h": h, "depth": -1.5},
            ],
        })
    world = {
        "version": 1, "status": "draft", "created": time.time(),
        "title": (payload.get("idea") or "").strip()[:60], "idea": (payload.get("idea") or "").strip()[:300],
        "nameplate": (payload.get("nameplate") or "For You").strip()[:24],
        "style": st["id"], "wall": st["wall"], "frame": st.get("frame"), "frameDepth": 2.6,
        "secondsPerStation": 18, "stations": stations,
        "souvenir": {"model": None, "text": "", "bg": st["wall"]},
        "music": {"id": st.get("music", "waltz")},
    }
    write(wid, world)
    return read(wid)


def analyze(wid):
    """Claude 看每张照片，给出站名和一个可以立体化的主体（只填空着的字段）"""
    if not musicbox_api.status()["recognition"]:
        return {"ok": False, "reason": "服务器没有配置照片识别（Claude），请手动填写"}
    w = read(wid)
    d = _dir(wid)
    for st in w["stations"]:
        f = d / st["photo"]
        data = f"data:image/{'jpeg' if f.suffix == '.jpg' else f.suffix[1:]};base64," + base64.b64encode(f.read_bytes()).decode()
        try:
            r = musicbox_api.analyze(data)
        except Exception as err:  # noqa: BLE001  识别失败不影响其它站
            st["analysis"] = {"error": str(err)[:120]}
            continue
        st["analysis"] = r
        if st["title"].startswith("第 ") and r.get("place"):
            st["title"] = r["place"][:20]
    write(wid, w)
    return {"ok": True, "world": read(wid)}


def _paint_one(wid, i):
    key = (wid, i)
    try:
        w = read(wid)
        st = w["stations"][i]
        sty = _style(w["style"])
        d = _dir(wid)
        photo = (d / st["photo"]).read_bytes()
        ext = st["photo"].rsplit(".", 1)[1]
        _paint[key] = {"stage": "上传照片", "progress": None}
        token = studio_api._tripo("POST", "/upload", files=(st["photo"], photo, f"image/{'jpeg' if ext == 'jpg' else ext}"))["data"]["image_token"]
        idea = f", in the spirit of: {w['idea']}" if w.get("idea") else ""
        prompt = PAINT_PROMPT.format(style=sty["prompt"], idea=idea)[:1024]
        _paint[key] = {"stage": "按风格重画", "progress": 0}
        task = studio_api._tripo("POST", "/task", {"type": "generate_image", "prompt": prompt, "model_version": studio_api.IMAGE_MODEL,
                                                   "file": {"type": ext, "file_token": token}})["data"]["task_id"]
        deadline = time.time() + 10 * 60
        while time.time() < deadline:
            time.sleep(3)
            info = studio_api._tripo("GET", f"/task/{task}").get("data", {})
            if info.get("status") == "success":
                break
            if info.get("status") in ("failed", "cancelled", "banned", "expired", "unknown"):
                raise RuntimeError(f"Tripo 重画 {info.get('status')}")
            _paint[key] = {"stage": "按风格重画", "progress": info.get("progress")}
        else:
            raise TimeoutError("重画超过 10 分钟")
        url = studio_api._urls(info.get("output", {}))[0][1]
        with urllib.request.urlopen(url, timeout=300) as res:
            data = res.read()
        ext2 = "png" if data[:4] == b"\x89PNG" else "webp" if data[8:12] == b"WEBP" else "jpg"
        name = f"art-{i}-{int(time.time())}.{ext2}"
        (d / name).write_bytes(data)
        with _lock:  # 和网页的保存可能同时发生：重新读一遍再改
            w = read(wid)
            st = w["stations"][i]
            st.setdefault("versions", []).append(name)
            art = next((L for L in st["layers"] if L.get("id") == "art"), None)
            if art:
                art["src"] = name
                art["fit"] = "cover"  # 新图的尺寸由渲染器按贴图铺满一站
                art.pop("w", None); art.pop("h", None); art["x"] = 0; art["y"] = 0
            write(wid, w)
        _paint[key] = {"stage": "完成", "progress": 100, "done": True}
    except Exception as err:  # noqa: BLE001
        _paint[key] = {"stage": "失败", "error": str(err)[:300], "done": True}


def handle(handler, method):
    url = urllib.parse.urlparse(handler.path)
    p = url.path
    if not (p == "/api/styles" or p.startswith("/api/worlds")):
        return False
    try:
        if p == "/api/styles":
            return musicbox_api._send(handler, 200, styles())
        body = None
        if method in ("POST", "PUT"):
            n = int(handler.headers.get("Content-Length", 0))
            if n > MAX_BODY:
                return musicbox_api._send(handler, 413, {"error": "照片太大了，请少选几张或换小一点的照片"})
            body = json.loads(handler.rfile.read(n) or b"{}")
        parts = p.strip("/").split("/")  # api, worlds, <id>, ...
        if method == "POST" and len(parts) == 2:
            return musicbox_api._send(handler, 200, create(body))
        wid = parts[2] if len(parts) > 2 else ""
        if len(parts) == 3 and method == "GET":
            return musicbox_api._send(handler, 200, read(wid))
        if len(parts) == 3 and method == "PUT":
            with _lock:
                write(wid, body)
            return musicbox_api._send(handler, 200, {"ok": True, "saved": time.time()})
        if len(parts) == 4 and parts[3] == "analyze" and method == "POST":
            return musicbox_api._send(handler, 200, analyze(wid))
        if len(parts) == 5 and parts[3] == "paint" and method == "POST":
            if not os.environ.get("TRIPO_API_KEY"):
                return musicbox_api._send(handler, 400, {"error": "服务器没有配置 TRIPO_API_KEY"})
            i = int(parts[4])
            if (_paint.get((wid, i)) or {}).get("done") is False:
                return musicbox_api._send(handler, 409, {"error": "这一站正在重画"})
            read(wid)["stations"][i]  # 不存在会抛错
            _paint[(wid, i)] = {"stage": "排队中", "done": False}
            threading.Thread(target=_paint_one, args=(wid, i), daemon=True).start()
            return musicbox_api._send(handler, 202, {"ok": True})
        if len(parts) == 4 and parts[3] == "publish" and method == "POST":
            with _lock:
                w = read(wid)
                w["status"] = "ready"
                w["published"] = time.time()
                write(wid, w)
            return musicbox_api._send(handler, 200, {"ok": True, "device": f"/device?world={wid}", "id": wid})
        return musicbox_api._send(handler, 404, {"error": "没有这个接口"})
    except FileNotFoundError:
        return musicbox_api._send(handler, 404, {"error": "找不到这个世界"})
    except (ValueError, KeyError, IndexError, json.JSONDecodeError) as err:
        return musicbox_api._send(handler, 400, {"error": str(err)})
