"""Serve the repository with enough connection backlog for ES module loading.
Run from the repository root: python3.11 client/web/tools/serve.py [--port 8000]
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import os

class ViewerServer(ThreadingHTTPServer):
    request_queue_size = 128

class FreshViewerHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8000)
    args=parser.parse_args()
    os.chdir(Path(__file__).resolve().parents[3])
    print(f'Tumbler: http://127.0.0.1:{args.port}/client/web/scene.html',flush=True)
    ViewerServer(('127.0.0.1',args.port),FreshViewerHandler).serve_forever()
