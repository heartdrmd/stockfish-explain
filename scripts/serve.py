#!/usr/bin/env python3
"""
Minimal dev server for stockfish-web.

Serves the current project directory over HTTP with the
Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy response
headers required by SharedArrayBuffer — which is what lets Stockfish run
in multi-threaded WASM mode.

Usage:
    python3 scripts/serve.py           # listens on http://localhost:8000
    python3 scripts/serve.py 8080      # custom port
"""
import http.server
import os
import socketserver
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))

class COOPCOEPHandler(http.server.SimpleHTTPRequestHandler):
    """Adds the two headers required for crossOriginIsolated = true."""

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path):
        # Ensure .wasm files get the right MIME so browsers accept them
        if path.endswith(".wasm"):
            return "application/wasm"
        if path.endswith(".mjs") or path.endswith(".js"):
            return "application/javascript"
        return super().guess_type(path)


def main():
    os.chdir(ROOT)
    with socketserver.TCPServer(("", PORT), COOPCOEPHandler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"stockfish-web dev server → {url}")
        print(f"serving {ROOT}")
        print("COOP + COEP headers enabled — multi-threaded Stockfish ready.")
        print("Ctrl-C to stop.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nbye.")


if __name__ == "__main__":
    main()
