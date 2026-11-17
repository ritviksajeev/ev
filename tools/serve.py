"""Local preview server for the site.

Like `python -m http.server`, with two differences that match production
better: the browser is told never to cache (so edits and deleted pages show
up on a normal reload), and unknown addresses get 404.html, the way GitHub
Pages serves it.

    python tools/serve.py [port]      # default 8765, run from the repo root
"""
import http.server
import os
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        page = os.path.join(os.getcwd(), '404.html')
        if code == 404 and os.path.isfile(page):
            with open(page, 'rb') as f:
                body = f.read()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    with http.server.ThreadingHTTPServer(('', port), Handler) as httpd:
        print('Serving on http://localhost:%d' % port)
        httpd.serve_forever()
