#!/usr/bin/env python3
"""本地服务器：木盒预览 + 制作端 + 制作端接口（见 musicbox_api.py），全部禁止缓存。

浏览器会按 Last-Modified 启发式缓存 ES 模块，改了 config.js 或换了 Tripo 模型后刷新仍是旧的。
用法：python3 serve.py [端口]，默认 5173，监听 0.0.0.0 以便相框在同一 Wi-Fi 下访问。
"""
import functools
import http.server
import pathlib
import sys

import os

# 本机密钥放在 Jupitermusic/.env（不进仓库），格式 KEY=VALUE；已设置的环境变量优先
_env = pathlib.Path(__file__).resolve().parent / ".env"
if _env.exists():
    for _line in _env.read_text().splitlines():
        _k, _, _v = _line.strip().partition("=")
        if _k and not _k.startswith("#") and _v:
            os.environ.setdefault(_k, _v)

import musicbox_api  # noqa: E402  读密钥之后再导入
import studio_api  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent / "prototype"
CAPTURES = ROOT.parent / "captures"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        # 相框上手输网址容易漏掉「?」：/device、/device&open、/device?auto 都跳到 /?device&open...
        if self.path == "/device" or self.path.startswith(("/device&", "/device?")):
            rest = self.path[len("/device"):].lstrip("?&")
            self.send_response(302)
            self.send_header("Location", "/?device&open" + ("&" + rest if rest and rest != "open" else ""))
            self.end_headers()
            return
        if self.path == "/studio":  # 布景工作台
            self.send_response(302)
            self.send_header("Location", "/studio.html")
            self.end_headers()
            return
        if not (studio_api.handle(self, "GET") or musicbox_api.handle(self, "GET")):
            super().do_GET()

    def do_PUT(self):
        if not studio_api.handle(self, "PUT"):
            self.send_error(404)

    def do_POST(self):
        if studio_api.handle(self, "POST") or musicbox_api.handle(self, "POST"):
            return
        self._capture()

    # 调试面板「截图」：把当前画面以 PNG 存到 Jupitermusic/captures/，只接受本机请求
    def _capture(self):
        if not self.path.startswith("/__capture") or self.client_address[0] not in ("127.0.0.1", "::1"):
            self.send_error(404)
            return
        name = "".join(c for c in self.path.partition("name=")[2] if c.isalnum() or c in "-_") or "frame"
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if not data.startswith(b"\x89PNG"):
            self.send_error(400)
            return
        CAPTURES.mkdir(exist_ok=True)
        (CAPTURES / f"{name}.png").write_bytes(data)
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("0.0.0.0", port), handler) as httpd:
        print(f"木盒预览  http://localhost:{port}/\n制作端    http://localhost:{port}/make/   （手机用 http://<本机IP>:{port}/make/）\n相框      http://<本机IP>:{port}/?device&journey=<编号>")
        print(f"AI 能力：{musicbox_api.status()}")
        httpd.serve_forever()
