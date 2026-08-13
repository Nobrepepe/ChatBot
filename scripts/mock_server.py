"""Tiny mock OpenAI-compatible server for testing the app without a real model.

Run with:  python scripts/mock_server.py [port]
Then set the base URL in Settings to http://localhost:8111/v1

It inspects the system prompt to imitate real behavior:
- custom sprite instruction -> reply starts with one of its configured call signs
- multi-character rules   -> reply uses 'Name: dialogue' blocks
- summary request         -> returns a short summary
- memory suggestions      -> returns a bullet list of facts
"""

import json
import random
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

REPLY = (
    'She looks up slowly, rain still clinging to her hair. '
    '"I didn\'t think you\'d actually come looking for me," she says, '
    'half a smile breaking through despite herself.'
)

SUMMARY = (
    "- The user came looking for the character on the rooftop.\n"
    "- The character was surprised but quietly pleased.\n"
    "- Tension eased by the end of the conversation."
)

SUGGESTIONS = (
    "- Daniela admitted she was avoiding everyone on purpose.\n"
    "- Daniela is secretly glad the user came looking for her.\n"
    "- The user promised to keep her secret about the rooftop."
)



def compose_reply(payload: dict) -> str:
    system = ""
    for m in payload.get("messages", []):
        if m.get("role") == "system":
            system += m.get("content", "")
    if "Summarize the scene transcript" in system:
        return SUMMARY
    if "propose the most important facts" in system:
        return SUGGESTIONS
    if "helping the user roleplay as their persona" in system:
        return '*I take a cautious step closer.* "Tell me what really happened."'
    reply = REPLY
    if "Multiple characters are present" in system:
        names = re.findall(r'Character profile: (\w+)', system) or ["Ana", "Bea"]
        parts = []
        for i, n in enumerate(names[:3]):
            parts.append(f'{n}: "{["I heard something down there.", "Then we go together.", "Fine. But quietly."][i % 3]}"')
        if "scene narrator" in system:
            parts.insert(1, "*A cold draft rolls through the corridor.*")
        return "\n\n".join(parts)
    if "scene narrator" in system:
        reply = "*Rain taps against the old windows.*\n\n" + reply
    if "sprite call sign in square brackets" in system:
        choices = re.findall(r"\[([^\[\]]+)\] \([^\r\n,]+\)", system)
        if choices:
            reply = f"[{random.choice(choices)}] {reply}"
    return reply


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[mock] {fmt % args}")

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            body = json.dumps(
                {"data": [{"id": "mock-model-7b"}, {"id": "mock-model-13b"}]}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length) or b"{}")
        reply = compose_reply(payload)
        stream = payload.get("stream", False)
        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            words = reply.split(" ")
            for i, word in enumerate(words):
                chunk = {
                    "choices": [
                        {"delta": {"content": word + (" " if i < len(words) - 1 else "")}}
                    ]
                }
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.flush()
                time.sleep(0.03)
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            body = json.dumps(
                {"choices": [{"message": {"role": "assistant", "content": reply}}]}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8111
    print(f"Mock OpenAI-compatible server on http://localhost:{port}/v1")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
