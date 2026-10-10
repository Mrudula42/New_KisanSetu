import http.client
import json
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlsplit
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), 'public')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', '8000'))

class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        parsed_path = urlsplit(self.path)
        path = parsed_path.path
        if path == '/api' or path.startswith('/api/'):
            self.proxy_api()
            return
        if path in ('/login', '/login/'):
            self.path = '/login.html'
            if parsed_path.query:
                self.path += '?' + parsed_path.query
        elif path in ('/admin', '/admin/'):
            self.path = '/admin.html'
        elif path == '/':
            self.path = '/index.html'
        super().do_GET()

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path == '/api' or path.startswith('/api/'):
            self.proxy_api()
            return
        super().do_HEAD()

    def do_POST(self):
        self.proxy_api()

    def do_PATCH(self):
        self.proxy_api()

    def do_PUT(self):
        self.proxy_api()

    def do_DELETE(self):
        self.proxy_api()

    def do_OPTIONS(self):
        self.proxy_api()

    def proxy_api(self):
        path = urlsplit(self.path).path
        if path != '/api' and not path.startswith('/api/'):
            self.send_error(404)
            return

        try:
            content_length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.send_error(400, 'Invalid Content-Length header')
            return
        if content_length < 0 or content_length > 1024 * 1024:
            self.send_error(413, 'Request body is too large')
            return

        body = self.rfile.read(content_length) if content_length else None
        headers = {}
        for name in ('Accept', 'Authorization', 'Content-Type', 'Cookie', 'Origin'):
            value = self.headers.get(name)
            if value is not None:
                headers[name] = value

        connection = http.client.HTTPConnection('127.0.0.1', 3000, timeout=15)
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            response_body = response.read()
            self.send_response(response.status, response.reason)
            for name, value in response.getheaders():
                if name.lower() not in {
                    'connection',
                    'content-length',
                    'date',
                    'keep-alive',
                    'server',
                    'transfer-encoding',
                }:
                    self.send_header(name, value)
            self.send_header('Content-Length', str(len(response_body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(response_body)
        except (OSError, http.client.HTTPException) as error:
            print(f'Local API proxy failed: {error}', file=sys.stderr)
            payload = json.dumps({'error': 'The local API is unavailable.'}).encode('utf-8')
            self.send_response(502)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        finally:
            connection.close()

    def log_message(self, format, *args):
        return

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', PORT), PreviewHandler)
    print(f'Serving KisanSetu preview on http://localhost:{PORT}')
    server.serve_forever()
