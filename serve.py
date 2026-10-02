#!/usr/bin/env python3
"""本地服务器：木盒预览 + 制作端 + 制作端接口（见 musicbox_api.py），全部禁止缓存。

浏览器会按 Last-Modified 启发式缓存 ES 模块，改了 config.js 或换了 Tripo 模型后刷新仍是旧的。
用法：python3 serve.py [端口]，默认 5173，监听 0.0.0.0 以便相框在同一 Wi-Fi 下访问。
"""
import functools
import http.server
import pathlib
import sys

import musicbox_api

ROOT = pathlib.Path(__file__).resolve().parent / "prototype"
CAPTURES = ROOT.parent / "captures"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if not musicbox_api.handle(self, "GET"):
            super().do_GET()

    def do_POST(self):
        if musicbox_api.handle(self, "POST"):
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
