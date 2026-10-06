"""布景工作台后端（/studio.html）：上传 2D 图 → Tripo 生成 3D → Blender 处理 → 放进穆夏版的槽位。

接口：
  GET  /api/studio/slots                 每个槽位：名字、属于哪扇窗、现在有没有模型、最近一次任务的进度
  POST /api/studio/generate?slot=<id>    请求体 = 图片原始字节（png / jpg / webp）→ Tripo image-to-model → 处理 → 放进槽位
  POST /api/studio/upload?slot=<id>      请求体 = GLB 原始字节（已经在 Tripo 网页上生成好的）→ 直接处理 → 放进槽位

处理用的是 tools/ 里的两个 Blender 脚本：人物用 jupiter_relief.py（切浮雕），布景小件用 jupiter_prop.py（重建 + 减面）。
需要：环境变量 TRIPO_API_KEY（只上传 GLB 时不需要）；Blender（默认 /Applications/Blender.app，可用 BLENDER 环境变量改）。
上传的原图和 Tripo 原始模型存在 prototype/assets/sources/<槽位>/，处理结果覆盖 prototype/assets/models/<槽位>.glb。
"""
import json
import os
import re
import pathlib
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import musicbox_api

HERE = pathlib.Path(__file__).resolve().parent
MODELS = HERE / "prototype" / "assets" / "models"
SOURCES = HERE / "prototype" / "assets" / "sources"
TOOLS = HERE / "tools"
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")
MAX_UPLOAD = 300 * 1024 * 1024
LAYER_DOCS = HERE / "prototype" / "assets" / "layers"   # 精修工作台：每扇窗的原图排版 + 元素拆分
WINDOWS = ["dawn", "noon", "dusk", "night"]
ELEMENT_ID = re.compile(r"^el_(dawn|noon|dusk|night)_[a-z0-9_-]{1,40}$")

# 槽位：和 prototype/src/mucha.js 的 MUCHA_SLOTS 对应。args 是给处理脚本的参数
SLOTS = {
    "mucha_lady_dawn":    {"name": "晨之女", "window": 0, "kind": "relief", "args": ["--faces", "8000"]},
    "mucha_lady_noon":    {"name": "昼之女", "window": 1, "kind": "relief", "args": ["--faces", "8000", "--zmax", "0.95"]},
    "mucha_lady_dusk":    {"name": "暮之女", "window": 2, "kind": "relief", "args": ["--faces", "8000", "--zmax", "0.95"]},
    "mucha_lady_night":   {"name": "夜之女", "window": 3, "kind": "relief", "args": ["--faces", "8000", "--zmax", "0.95"]},
    "mucha_tree":         {"name": "背景树", "window": None, "kind": "prop", "args": ["--faces", "800", "--voxel", "0.007"]},
    "mucha_flower_lily":  {"name": "窗台百合", "window": None, "kind": "prop", "args": ["--faces", "400", "--voxel", "0.006"]},
    "mucha_flower_daisy": {"name": "窗台雏菊", "window": None, "kind": "prop", "args": ["--faces", "500", "--voxel", "0.004"]},
    "mucha_ornament":     {"name": "窗角花饰", "window": None, "kind": "prop", "args": ["--faces", "700", "--voxel", "0.005"]},
    "mucha_butterfly":    {"name": "蝴蝶", "window": None, "kind": "prop", "args": ["--faces", "600", "--voxel", "0.004"]},
}
STAGES = ["上传", "Tripo 生成", "下载", "处理", "完成"]
# 工作台用 Tripo v2 开放接口（制作端 musicbox_api.py 用的是 v3 地址，两者的 key 不通用）
TRIPO_BASE = os.environ.get("TRIPO_API_BASE", "https://api.tripo3d.ai/v2/openapi")


def _tripo(method, path, body=None, files=None):
    headers = {"Authorization": f"Bearer {os.environ['TRIPO_API_KEY']}"}
    data = None
    if files:
        boundary = "----studio" + secrets.token_hex(8)
        name, content, mime = files
        data = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
                f"Content-Type: {mime}\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(TRIPO_BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            out = json.loads(res.read())
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"Tripo {err.code}: {err.read()[:200].decode(errors='ignore')}") from None
    if out.get("code") not in (0, None):
        raise RuntimeError(f"Tripo: {out.get('message', out)}")
    return out


def balance():
    try:
        return _tripo("GET", "/user/balance")["data"]
    except Exception as err:  # noqa: BLE001  余额只是显示用
        return {"error": str(err)[:120]}

_jobs = {}            # 槽位 → 最近一次任务
_lock = threading.Lock()
_blender = threading.Semaphore(1)  # Blender 一次只跑一个，免得电脑卡死


def _set(slot, **fields):
    with _lock:
        _jobs.setdefault(slot, {}).update(fields, updated=time.time())


def _element_slot(sid, name=None):
    """精修元素的槽位：el_<窗>_<元素 id>，按布景小件处理（体素重建 + 减面）"""
    if sid not in SLOTS:
        SLOTS[sid] = {"name": name or sid, "window": WINDOWS.index(sid.split("_")[1]), "kind": "prop", "element": True,
                      "args": ["--faces", "1500", "--voxel", "0.005"]}
    elif name:
        SLOTS[sid]["name"] = name
    return SLOTS[sid]


def slots():
    # 以前生成过的精修元素（服务器重启后从文件里找回来）
    for f in list(MODELS.glob("el_*.glb")) + ([d for d in SOURCES.glob("el_*") if d.is_dir()] if SOURCES.exists() else []):
        if ELEMENT_ID.match(f.stem if f.suffix else f.name):
            _element_slot(f.stem if f.suffix else f.name)
    out = []
    for sid, s in SLOTS.items():
        f = MODELS / f"{sid}.glb"
        src = sorted((SOURCES / sid).glob("source.*")) if (SOURCES / sid).exists() else []
        out.append({
            "id": sid, "name": s["name"], "window": s["window"], "kind": s["kind"], "element": s.get("element", False),
            "model": f.exists(), "modelTime": f.stat().st_mtime if f.exists() else None,
            "modelKB": round(f.stat().st_size / 1024) if f.exists() else None,
            "source": f"assets/sources/{sid}/{src[-1].name}" if src else None,
            "raw": f"assets/sources/{sid}/tripo.glb" if (SOURCES / sid / "tripo.glb").exists() else None,
            "rawMB": round((SOURCES / sid / "tripo.glb").stat().st_size / 1e6, 1) if (SOURCES / sid / "tripo.glb").exists() else None,
            "job": {k: v for k, v in (_jobs.get(sid) or {}).items() if not k.startswith("_")} or None,
        })
    return {"slots": out, "tripo": bool(os.environ.get("TRIPO_API_KEY")), "blender": pathlib.Path(BLENDER).exists()}


_balance = {"t": 0, "v": None}


def cached_balance():
    if os.environ.get("TRIPO_API_KEY") and time.time() - _balance["t"] > 60:
        _balance.update(t=time.time(), v=balance())
    return _balance["v"]


def _process(slot, raw_glb):
    s = SLOTS[slot]
    _set(slot, stage="处理", progress=None, message="Blender 处理中（约 10–30 秒）")
    script = TOOLS / ("jupiter_relief.py" if s["kind"] == "relief" else "jupiter_prop.py")
    tmp = SOURCES / slot / "processed.glb"
    with _blender:
        res = subprocess.run([BLENDER, "-b", "--python", str(script), "--", str(raw_glb), str(tmp), *s["args"]],
                             capture_output=True, text=True, timeout=900)
    if res.returncode != 0 or not tmp.exists():
        tail = (res.stderr or res.stdout)[-400:]
        raise RuntimeError(f"Blender 处理失败：{tail}")
    MODELS.mkdir(parents=True, exist_ok=True)
    tmp.replace(MODELS / f"{slot}.glb")
    log = [l for l in res.stdout.splitlines() if l.startswith(("[relief]", "[prop]"))]
    _set(slot, stage="完成", progress=100, message=log[-1] if log else "完成", done=True)


def _run_generate(slot, image, ext):
    try:
        d = SOURCES / slot
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("source.*"):
            old.unlink()
        (d / f"source.{ext}").write_bytes(image)
        _set(slot, stage="上传", progress=None, message="上传原图到 Tripo")
        token = _tripo("POST", "/upload", files=(f"source.{ext}", image, f"image/{'jpeg' if ext == 'jpg' else ext}"))["data"]["image_token"]
        task = _tripo("POST", "/task", {"type": "image_to_model", "texture": True, "pbr": False,
                                         "file": {"type": ext, "file_token": token}})
        task_id = task["data"]["task_id"]
        _set(slot, stage="Tripo 生成", progress=0, message=f"任务 {task_id}", taskId=task_id)
        deadline = time.time() + 15 * 60
        while time.time() < deadline:
            time.sleep(4)
            info = _tripo("GET", f"/task/{task_id}").get("data", {})
            state = info.get("status")
            if state == "success":
                break
            if state in ("failed", "cancelled", "banned", "expired"):
                raise RuntimeError(f"Tripo 任务 {state}")
            _set(slot, progress=info.get("progress"))
        else:
            raise TimeoutError("Tripo 生成超过 15 分钟")
        _set(slot, stage="下载", progress=None, message="下载 Tripo 模型")
        out = info.get("output", {})
        url = out.get("pbr_model") or out.get("model") or out.get("base_model") or out.get("model_url")
        if isinstance(url, dict):
            url = url.get("url")
        with urllib.request.urlopen(url, timeout=300) as res:
            raw = res.read()
        (d / "tripo.glb").write_bytes(raw)
        _process(slot, d / "tripo.glb")
    except Exception as err:  # 任何一步失败都把原因显示在工作台上
        _set(slot, stage="失败", message=str(err)[:300], done=True, failed=True)


# —— 2D → 3D 流水线：先把元素重画成「给 3D 看的图」，再生成模型 ————————————————
# 人物：重画成正面 A-pose 参考图 →（确认）→ 四视图 →（确认）→ multiview_to_model
# 物件：重画成单独、完整、白底的参考图 →（确认）→ image_to_model
# 两个确认点是质检关卡：手指粘连、侧脸、被遮挡的参考图在这里重做，不白花建模额度。
IMAGE_MODEL = os.environ.get("TRIPO_IMAGE_MODEL", "gemini_3_pro_image_preview")
STYLE = "Art Nouveau, Alphonse Mucha lithograph illustration style, soft muted colors, clean ink outlines"
PROMPT_CHARACTER = (
    "Recreate the character from the reference image as a clean 3D-modeling reference image. "
    "Keep the same identity, face, hairstyle, outfit design and colors, " + STYLE + ". "
    "Full body from head to feet, centered, front view, neutral relaxed A-pose, arms slightly away from the body, "
    "both hands fully visible with five clearly separated fingers, face looking straight at the camera, "
    "symmetric facial features, hair and fabric kept away from face and hands, no overlapping limbs. "
    "Orthographic camera, plain pure white background, soft even lighting, no shadows, no text, no frame, "
    "no props, no scenery. Subject fills about 80% of the image height.")
PROMPT_OBJECT = (
    "Recreate only the {name} from the reference image as a standalone 3D-modeling reference image. "
    "Keep its shape, colors and design, " + STYLE + ". Complete any hidden or cropped parts so the whole object "
    "is visible. {hint}Front view, orthographic, centered, nothing overlapping it, plain pure white background, "
    "soft even lighting, no shadows, no text, no other objects, no scenery. Object fills about 80% of the image.")
COST_HINT = {"character": "参考图约 10 + 四视图 10 + 建模", "object": "参考图约 10 + 建模"}


def _urls(obj):
    """从 Tripo 返回的 output 里找出所有图片 / 模型地址（字段名各接口不同）"""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and v.startswith("http"):
                out.append((k, v))
            else:
                out += [(f"{k}.{kk}" if kk else k, vv) for kk, vv in _urls(v)]
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out += [(f"{i}.{kk}" if kk else str(i), vv) for kk, vv in _urls(v)]
    return out


def _wait(slot, task_id, label, minutes=15):
    deadline = time.time() + minutes * 60
    while time.time() < deadline:
        time.sleep(3)
        info = _tripo("GET", f"/task/{task_id}").get("data", {})
        state = info.get("status")
        if state == "success":
            return info
        if state in ("failed", "cancelled", "banned", "expired", "unknown"):
            raise RuntimeError(f"Tripo {label} {state}")
        _set(slot, progress=info.get("progress"))
    raise TimeoutError(f"Tripo {label}超过 {minutes} 分钟")


def _save(slot, url, name):
    d = SOURCES / slot / "pipeline"
    d.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as res:
        data = res.read()
    ext = ".glb" if data[:4] == b"glTF" else ".png" if data[:4] == b"\x89PNG" else ".webp" if data[8:12] == b"WEBP" else ".jpg"
    f = d / (name + ext)
    f.write_bytes(data)
    return f"assets/sources/{slot}/pipeline/{f.name}"


def _gate(slot, step):
    """停下来等确认：返回 'ok' / 'redo' / 'cancel'"""
    ev = threading.Event()
    _set(slot, waiting=step, stage="等你确认" + {'reference': '参考图', 'views': '四视图'}[step], progress=None)
    with _lock:
        _jobs[slot]["_ev"] = ev
        _jobs[slot]["_answer"] = None
    ev.wait(60 * 60)
    with _lock:
        ans = _jobs[slot].get("_answer") or "cancel"
        _jobs[slot]["waiting"] = None
    return ans


def _run_pipeline(slot, image, ext, kind, name, hint, auto):
    try:
        bal0 = (balance() or {}).get("balance")
        d = SOURCES / slot
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("source.*"):
            old.unlink()
        (d / f"source.{ext}").write_bytes(image)
        art = {"source": f"assets/sources/{slot}/source.{ext}"}
        _set(slot, stage="上传", message="上传原图", artifacts=art, kind=kind)
        token = _tripo("POST", "/upload", files=(f"source.{ext}", image, f"image/{'jpeg' if ext == 'jpg' else ext}"))["data"]["image_token"]
        prompt = PROMPT_CHARACTER if kind == "character" else PROMPT_OBJECT.format(name=name or "object", hint=(hint.strip() + " ") if hint else "")

        # ① 重画参考图（可重做）
        while True:
            _set(slot, stage="重画参考图", progress=0, message=f"{IMAGE_MODEL}")
            body = {"type": "generate_image", "prompt": prompt[:1024], "model_version": IMAGE_MODEL,
                    "file": {"type": ext, "file_token": token}}
            if kind == "character":
                body["template"] = "character_completion"
            ref_task = _tripo("POST", "/task", body)["data"]["task_id"]
            info = _wait(slot, ref_task, "参考图")
            ref_url = _urls(info.get("output", {}))[0][1]
            art["reference"] = _save(slot, ref_url, "reference")
            _set(slot, artifacts=art, message="参考图好了")
            ans = "ok" if auto else _gate(slot, "reference")
            if ans == "redo":
                continue
            if ans != "ok":
                raise RuntimeError("已取消")
            break

        if kind == "character":
            # ② 四视图（可重做）
            while True:
                _set(slot, stage="生成四视图", progress=0, message="front / left / back / right")
                mv_task = _tripo("POST", "/task", {"type": "generate_multiview_image", "file": {"type": "png", "url": ref_url}})["data"]["task_id"]
                info = _wait(slot, mv_task, "四视图")
                views = _urls(info.get("output", {}))
                art["views"] = [_save(slot, u, f"view_{i}_{k.split('.')[-1]}") for i, (k, u) in enumerate(views[:4])]
                _set(slot, artifacts=art, message=f"{len(views)} 张视图")
                ans = "ok" if auto else _gate(slot, "views")
                if ans == "redo":
                    continue
                if ans != "ok":
                    raise RuntimeError("已取消")
                break
            # ③ 四视图 → 模型
            _set(slot, stage="Tripo 建模", progress=0, message="multiview_to_model")
            task = _tripo("POST", "/task", {"type": "multiview_to_model", "original_task_id": mv_task, "texture": True})["data"]["task_id"]
        else:
            _set(slot, stage="Tripo 建模", progress=0, message="image_to_model")
            task = _tripo("POST", "/task", {"type": "image_to_model", "texture": True, "file": {"type": "png", "url": ref_url}})["data"]["task_id"]
        info = _wait(slot, task, "建模")
        out = info.get("output", {})
        url = out.get("pbr_model") or out.get("model") or out.get("base_model")
        if isinstance(url, dict):
            url = url.get("url")
        _set(slot, stage="下载", progress=None, message="下载模型")
        with urllib.request.urlopen(url, timeout=300) as res:
            (d / "tripo.glb").write_bytes(res.read())
        _process(slot, d / "tripo.glb")
        bal1 = (balance() or {}).get("balance")
        if bal0 is not None and bal1 is not None:
            _set(slot, message=f"{_jobs[slot].get('message', '')} · 本次用了 {bal0 - bal1} 额度")
    except Exception as err:  # noqa: BLE001  任何一步失败都显示在工作台上
        _set(slot, stage="失败", message=str(err)[:300], done=True, failed=True, waiting=None)


def _run_upload(slot, glb):
    try:
        d = SOURCES / slot
        d.mkdir(parents=True, exist_ok=True)
        (d / "tripo.glb").write_bytes(glb)
        _process(slot, d / "tripo.glb")
    except Exception as err:
        _set(slot, stage="失败", message=str(err)[:300], done=True, failed=True)


def handle(handler, method):
    """处理 /api/studio/ 请求；返回 True 表示已处理。"""
    url = urllib.parse.urlparse(handler.path)
    if not url.path.startswith("/api/studio/"):
        return False
    q = urllib.parse.parse_qs(url.query)
    if url.path.startswith("/api/studio/doc/"):
        win = url.path.rsplit("/", 1)[1]
        if win not in WINDOWS:
            return musicbox_api._send(handler, 404, {"error": "没有这扇窗"})
        f = LAYER_DOCS / f"{win}.json"
        if method == "GET":
            return musicbox_api._send(handler, 200, json.loads(f.read_text()) if f.exists() else {})
        if method == "PUT":
            length = int(handler.headers.get("Content-Length", 0))
            doc = json.loads(handler.rfile.read(length) or b"{}")
            LAYER_DOCS.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
            return musicbox_api._send(handler, 200, {"ok": True, "saved": time.time()})
    if method == "GET" and url.path == "/api/studio/slots":
        return musicbox_api._send(handler, 200, {**slots(), "balance": cached_balance()})
    if method == "POST" and url.path == "/api/studio/answer":
        slot = (q.get("slot") or [""])[0]
        job = _jobs.get(slot) or {}
        if not job.get("waiting"):
            return musicbox_api._send(handler, 409, {"error": "这个槽位没有在等确认"})
        job["_answer"] = (q.get("a") or ["cancel"])[0]
        job["_ev"].set()
        return musicbox_api._send(handler, 200, {"ok": True})
    if method == "POST" and url.path in ("/api/studio/generate", "/api/studio/upload", "/api/studio/pipeline"):
        slot = (q.get("slot") or [""])[0]
        if ELEMENT_ID.match(slot):
            _element_slot(slot, (q.get("name") or [None])[0])
        if slot not in SLOTS:
            return musicbox_api._send(handler, 400, {"error": "没有这个槽位"})
        if (_jobs.get(slot) or {}).get("done") is False:
            return musicbox_api._send(handler, 409, {"error": "这个槽位正在生成，等它做完"})
        length = int(handler.headers.get("Content-Length", 0))
        if not 0 < length <= MAX_UPLOAD:
            return musicbox_api._send(handler, 413, {"error": "文件太大或为空"})
        body = handler.rfile.read(length)
        if url.path.endswith("/pipeline"):
            if not os.environ.get("TRIPO_API_KEY"):
                return musicbox_api._send(handler, 400, {"error": "服务器没有配置 TRIPO_API_KEY"})
            ext = "png" if body[:4] == b"\x89PNG" else "webp" if body[8:12] == b"WEBP" else "jpg"
            kind = (q.get("kind") or ["character" if slot.startswith("mucha_lady_") else "object"])[0]
            target, args = _run_pipeline, (slot, body, ext, kind, (q.get("name") or [""])[0], (q.get("hint") or [""])[0], (q.get("auto") or ["0"])[0] == "1")
        elif url.path.endswith("/generate"):
            if not os.environ.get("TRIPO_API_KEY"):
                return musicbox_api._send(handler, 400, {"error": "服务器没有配置 TRIPO_API_KEY，只能上传已经生成好的 GLB"})
            ext = "png" if body[:4] == b"\x89PNG" else "webp" if body[8:12] == b"WEBP" else "jpg"
            target, args = _run_generate, (slot, body, ext)
        else:
            if body[:4] != b"glTF":
                return musicbox_api._send(handler, 400, {"error": "不是 GLB 文件"})
            target, args = _run_upload, (slot, body)
        _set(slot, stage=STAGES[0] if target is _run_generate else "处理", progress=None, message="排队中", done=False, failed=False, started=time.time())
        threading.Thread(target=target, args=args, daemon=True).start()
        return musicbox_api._send(handler, 202, {"ok": True})
    return musicbox_api._send(handler, 404, {"error": "没有这个接口"})
