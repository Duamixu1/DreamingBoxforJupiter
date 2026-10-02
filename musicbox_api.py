"""制作端后端：照片识别、保存旅程、Tripo 生成地标。

接口（全部 JSON）：
  GET  /api/status            哪些 AI 能力可用
  POST /api/analyze           {photo: dataURL} → 识别结果（地名、地标、地貌、时段、主色、地标框）
  POST /api/journeys          {recipient, vehicle, letter, stations[]} → {id}；随后在后台生成地标
  GET  /api/journeys/<id>     旅程内容 + 每站地标的生成状态
  GET  /api/journeys/latest   最近做好的一段旅程的编号（木盒用 ?journey=latest 载入）

旅程保存在 prototype/journeys/<id>/，木盒用 /?journey=<id> 载入。

两项 AI 能力都是可选的：
  照片识别  需要 `pip install anthropic`，并配置 ANTHROPIC_API_KEY（或 `ant auth login`）
  Tripo 地标 需要环境变量 TRIPO_API_KEY
缺哪项就退回手动：用户在第 3 步自己选地貌和时段，地标用该地貌的默认模型。
"""
import base64
import json
import os
import pathlib
import re
import secrets
import threading
import time
import urllib.error
import urllib.request

try:
    import anthropic
except ImportError:  # 未安装时退回手动识别
    anthropic = None

ROOT = pathlib.Path(__file__).resolve().parent / "prototype"
JOURNEYS = ROOT / "journeys"
MAX_BODY = 40 * 1024 * 1024
MAX_STATIONS = 5

BIOMES = ["countryside", "mountain", "seaside", "city", "forest", "snow"]
TIMES = ["dawn", "day", "dusk", "night"]

CLAUDE_MODEL = "claude-opus-5-5"
TRIPO_BASE = "https://openapi.tripo3d.com/v3"
TRIPO_MODEL_VERSION = os.environ.get("TRIPO_MODEL_VERSION", "v3.1-20260211")
TRIPO_FACE_LIMIT = 3000  # 每帧 9 个视点，单个地标控制在 3k 面以内
TRIPO_STYLE = "miniature diorama, hand-painted toy style, warm soft colors, matte, low poly, clean silhouette, no base plate, no ground"

_lock = threading.Lock()


def status():
    return {
        "recognition": anthropic is not None,
        "tripo": bool(os.environ.get("TRIPO_API_KEY")),
    }


# —— 照片识别 ————————————————————————————————————————————————

ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "place": {"type": "string"},
        "landmark": {"type": "string"},
        "landmark_box": {
            "type": "object",
            "properties": {k: {"type": "number"} for k in ("x", "y", "w", "h")},
            "required": ["x", "y", "w", "h"],
            "additionalProperties": False,
        },
        "biome": {"type": "string", "enum": BIOMES},
        "time_of_day": {"type": "string", "enum": TIMES},
        "palette": {"type": "array", "items": {"type": "string"}},
        "has_people": {"type": "boolean"},
    },
    "required": ["place", "landmark", "landmark_box", "biome", "time_of_day", "palette", "has_people"],
    "additionalProperties": False,
}

ANALYSIS_PROMPT = """这是一张旅行照片，它会变成一个桌面微缩音乐盒里的一站：照片里最有辨识度的东西会被做成一个小小的 3D 模型，周围的布景按地貌和时段生成。

请看照片，返回：
- place：简短的中文地名或场景名。认得出具体地点就写地名（如「青岛 · 小麦岛」），认不出就描述场景（如「海边小镇」）。
- landmark：照片里最适合做成微缩模型的一个实物，用简短中文名词短语，例如「白色灯塔」「红顶教堂」「木质渔船」「摩天轮」。必须是建筑、交通工具、雕塑、树、山峰这类实物，不能是人，也不能是天空、水面这类背景。实在没有就返回空字符串。
- landmark_box：这个地标在照片里的位置，x、y 是左上角，w、h 是宽高，都用 0 到 1 的比例。没有地标时返回 0,0,1,1。
- biome：countryside（田园、村庄）、mountain（山野）、seaside（海边、湖边）、city（城市街道）、forest（森林）、snow（雪地）中最贴近的一个。
- time_of_day：dawn、day、dusk、night 中最贴近的一个。
- palette：照片的 3 个主色，#rrggbb 格式。
- has_people：照片里是否有人。"""


def _decode_data_url(data_url):
    m = re.match(r"^data:image/(jpeg|jpg|png|webp);base64,(.+)$", data_url or "", re.S)
    if not m:
        raise ValueError("照片格式不对，需要 JPEG / PNG / WebP")
    return ("jpeg" if m.group(1) == "jpg" else m.group(1)), base64.b64decode(m.group(2))


def analyze(photo_data_url):
    fmt, raw = _decode_data_url(photo_data_url)
    if anthropic is None:
        return {"mode": "manual", "reason": "未安装 anthropic，照片识别改为手动选择"}
    try:
        client = anthropic.Anthropic()
        response = client.beta.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=4000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": ANALYSIS_SCHEMA}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": f"image/{fmt}",
                                                 "data": base64.standard_b64encode(raw).decode("ascii")}},
                    {"type": "text", "text": ANALYSIS_PROMPT},
                ],
            }],
        )
    except anthropic.AuthenticationError:
        return {"mode": "manual", "reason": "没有配置 Claude 的凭据，照片识别改为手动选择"}
    except anthropic.APIConnectionError:
        return {"mode": "manual", "reason": "连不上 Claude，照片识别改为手动选择"}
    except anthropic.APIStatusError as err:
        return {"mode": "manual", "reason": f"识别失败（{err.status_code}），请手动选择"}
    except TypeError:  # SDK 找不到任何凭据
        return {"mode": "manual", "reason": "没有配置 Claude 的凭据，照片识别改为手动选择"}
    if response.stop_reason == "refusal":
        return {"mode": "manual", "reason": "这张照片无法自动识别，请手动选择"}
    text = next((b.text for b in response.content if b.type == "text"), "")
    data = json.loads(text)
    box = data["landmark_box"]
    data["landmark_box"] = {k: min(max(float(box[k]), 0.0), 1.0) for k in ("x", "y", "w", "h")}
    data["palette"] = [c for c in data["palette"] if re.match(r"^#[0-9a-fA-F]{6}$", c)][:3]
    data["mode"] = "ai"
    return data


# —— 旅程 ————————————————————————————————————————————————————

def _clean(text, limit):
    return re.sub(r"[\x00-\x1f]", "", str(text or "")).strip()[:limit]


def _journey_dir(jid):
    if not re.match(r"^[a-z0-9]{6,32}$", jid or ""):
        raise ValueError("旅程编号不对")
    return JOURNEYS / jid


def _write_journey(jdir, data):
    tmp = jdir / "journey.json.tmp"
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(jdir / "journey.json")


def read_journey(jid):
    path = _journey_dir(jid) / "journey.json"
    if not path.exists():
        raise FileNotFoundError(jid)
    return json.loads(path.read_text(encoding="utf-8"))


def create_journey(payload):
    stations_in = payload.get("stations") or []
    if not 1 <= len(stations_in) <= MAX_STATIONS:
        raise ValueError(f"需要 1–{MAX_STATIONS} 张照片")
    jid = secrets.token_hex(5)
    jdir = _journey_dir(jid)
    (jdir / "photos").mkdir(parents=True)
    (jdir / "landmarks").mkdir()
    tripo_on = status()["tripo"]

    stations, crops = [], []
    for i, st in enumerate(stations_in, start=1):
        fmt, raw = _decode_data_url(st.get("photo"))
        ext = "jpg" if fmt == "jpeg" else fmt
        (jdir / "photos" / f"{i}.{ext}").write_bytes(raw)
        crop = None
        if st.get("crop"):
            cfmt, craw = _decode_data_url(st["crop"])
            crop = (cfmt, craw)
        crops.append(crop)
        label = _clean((st.get("landmark") or {}).get("label"), 40)
        stations.append({
            "name": _clean(st.get("name"), 30) or f"第 {i} 站",
            "biome": st.get("biome") if st.get("biome") in BIOMES else "countryside",
            "timeOfDay": st.get("timeOfDay") if st.get("timeOfDay") in TIMES else "day",
            "caption": _clean(st.get("caption"), 24),
            "photo": f"photos/{i}.{ext}",
            "landmark": {
                "label": label,
                "glb": None,
                "status": "pending" if (tripo_on and label) else "skipped",
            },
        })

    letter = payload.get("letter") or {}
    # 按行清理，保留用户的换行；最多 12 行
    body = [_clean(line, 120) for line in str(letter.get("body") or "")[:600].split("\n")][:12]
    while body and not body[-1]:
        body.pop()
    data = {
        "version": 1,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "recipient": _clean(payload.get("recipient"), 16),
        "vehicle": "plane" if payload.get("vehicle") == "plane" else "train",
        "stations": stations,
        "letter": {
            "greeting": _clean(letter.get("greeting"), 20) or "亲爱的你：",
            "lines": [{"text": l, "style": "zh"} if l.strip() else {"gap": 1} for l in body],
            "signature": _clean(letter.get("signature"), 20),
            "date": time.strftime("%Y · %m"),
        },
    }
    with _lock:
        _write_journey(jdir, data)
    if any(s["landmark"]["status"] == "pending" for s in stations):
        threading.Thread(target=_generate_landmarks, args=(jid, crops), daemon=True).start()
    return {"id": jid}


def _set_landmark(jid, index, **fields):
    with _lock:
        jdir = _journey_dir(jid)
        data = read_journey(jid)
        data["stations"][index]["landmark"].update(fields)
        _write_journey(jdir, data)


# —— Tripo ————————————————————————————————————————————————————

def _tripo(method, path, body=None, files=None):
    headers = {"Authorization": f"Bearer {os.environ['TRIPO_API_KEY']}"}
    data = None
    if files:
        boundary = "----musicbox" + secrets.token_hex(8)
        name, content, mime = files
        data = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
                f"Content-Type: {mime}\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(TRIPO_BASE + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def _generate_one(jid, index, label, crop):
    common = {"model_version": TRIPO_MODEL_VERSION, "texture": True, "face_limit": TRIPO_FACE_LIMIT}
    if crop:
        fmt, raw = crop
        token = _tripo("POST", "/files", files=(f"landmark.{fmt}", raw, f"image/{fmt}"))["data"]["file_token"]
        task = _tripo("POST", "/generation/image-to-model",
                      {**common, "file": {"type": "jpg" if fmt == "jpeg" else fmt, "file_token": token}})
    else:
        task = _tripo("POST", "/generation/text-to-model", {**common, "prompt": f"{label}, {TRIPO_STYLE}"})
    task_id = task["data"]["task_id"]
    _set_landmark(jid, index, status="running", taskId=task_id)

    deadline = time.time() + 8 * 60
    while time.time() < deadline:
        time.sleep(4)
        info = _tripo("GET", f"/tasks/{task_id}")
        state = info.get("data", {}).get("status") or info.get("status")
        if state == "success":
            url = info["data"]["output"]["model_url"]
            with urllib.request.urlopen(url, timeout=120) as res:
                (_journey_dir(jid) / "landmarks" / f"{index + 1}.glb").write_bytes(res.read())
            _set_landmark(jid, index, status="ready", glb=f"landmarks/{index + 1}.glb")
            return
        if state in ("failed", "cancelled"):
            raise RuntimeError(f"Tripo 任务{state}")
    raise TimeoutError("Tripo 生成超时")


def _generate_landmarks(jid, crops):
    data = read_journey(jid)
    threads = []
    for i, st in enumerate(data["stations"]):
        if st["landmark"]["status"] != "pending":
            continue

        def run(i=i, label=st["landmark"]["label"]):
            try:
                _generate_one(jid, i, label, crops[i])
            except (urllib.error.URLError, KeyError, RuntimeError, TimeoutError, ValueError) as err:
                _set_landmark(jid, i, status="failed", error=str(err)[:200])

        t = threading.Thread(target=run, daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()


# —— 路由 ————————————————————————————————————————————————————

def handle(handler, method):
    """处理 /api/ 请求；返回 True 表示已处理。"""
    path = handler.path.split("?")[0]
    if not path.startswith("/api/"):
        return False
    try:
        if method == "GET" and path == "/api/status":
            return _send(handler, 200, status())
        if method == "GET" and path == "/api/journeys/latest":
            done = sorted(JOURNEYS.glob("*/journey.json"), key=lambda f: f.stat().st_mtime) if JOURNEYS.exists() else []
            if not done:
                return _send(handler, 404, {"error": "还没有做好的旅程"})
            return _send(handler, 200, {"id": done[-1].parent.name})
        if method == "GET" and path.startswith("/api/journeys/"):
            return _send(handler, 200, read_journey(path.rsplit("/", 1)[1]))
        if method == "POST":
            length = int(handler.headers.get("Content-Length", 0))
            if length > MAX_BODY:
                return _send(handler, 413, {"error": "照片太大了，请少选几张或换小一点的照片"})
            payload = json.loads(handler.rfile.read(length) or b"{}")
            if path == "/api/analyze":
                return _send(handler, 200, analyze(payload.get("photo")))
            if path == "/api/journeys":
                return _send(handler, 200, create_journey(payload))
        return _send(handler, 404, {"error": "没有这个接口"})
    except FileNotFoundError:
        return _send(handler, 404, {"error": "找不到这段旅程"})
    except (ValueError, json.JSONDecodeError) as err:
        return _send(handler, 400, {"error": str(err)})


def _send(handler, code, obj):
    body = json.dumps(obj, ensure_ascii=False).encode()
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)
    return True
