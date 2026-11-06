"""S0 tumble spike (throwaway): a local PUT/GET file drop for s0_tumble_capture.js, 127.0.0.1:8148 only.

    python3.11 client/web/tools/s0_upload.py <folder>
"""
import http.server,os,re,sys
D=sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Methods','PUT, OPTIONS');self.send_header('Access-Control-Allow-Headers','*')
    def do_OPTIONS(self):self.send_response(204);self.cors();self.end_headers()
    def do_PUT(self):
        name=re.sub(r'[^A-Za-z0-9_.-]','_',self.path.strip('/'));n=int(self.headers['Content-Length'])
        open(os.path.join(D,name),'wb').write(self.rfile.read(n));self.send_response(200);self.cors();self.end_headers()
    def do_GET(self):
        name=re.sub(r'[^A-Za-z0-9_.-]','_',self.path.strip('/'));b=open(os.path.join(D,name),'rb').read()
        self.send_response(200);self.cors();self.send_header('Content-Type','text/javascript');self.end_headers();self.wfile.write(b)
    def log_message(self,*a):pass
http.server.ThreadingHTTPServer(('127.0.0.1',8148),H).serve_forever()
