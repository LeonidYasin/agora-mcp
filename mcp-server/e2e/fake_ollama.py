"""Fake Ollama-compatible embedding server for plumbing tests ONLY.

Implements POST /api/embed ({model, input} -> {embeddings: [[...1024 floats]]}).
Vectors are a hashed bag-of-words, L2-normalised — texts sharing words get
higher cosine similarity. This exercises the full request/DB/pgvector path;
it says nothing about the semantic quality of a real model like bge-m3.

The role-instruction prefix agora-mcp prepends is stripped before hashing
(a real instruction-aware model treats it as an instruction, not content).
"""
import hashlib
import json
import math
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

DIM = 1024
PREFIXES = (
    "Represent this offer for matching against user wants: ",
    "Represent this want for finding relevant offers: ",
)
seen = []


def embed(text: str):
    for p in PREFIXES:
        if text.startswith(p):
            text = text[len(p):]
    vec = [0.0] * DIM
    for tok in re.findall(r"\w+", text.lower()):
        # crude stemming so "консультации"/"консультант" share a prefix bucket
        tok = tok[:6]
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        vec[h % DIM] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path != "/api/embed":
            self.send_response(404)
            self.end_headers()
            return
        seen.append(body["input"])
        out = json.dumps({"model": body.get("model"), "embeddings": [embed(body["input"])]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
