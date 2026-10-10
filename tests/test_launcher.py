import json
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import pytest


def test_windows_powershell_status_decodes_chinese_workspace_as_utf8(tmp_path):
    powershell = shutil.which("powershell.exe")
    if not powershell:
        pytest.skip("Windows PowerShell compatibility regression")
    workspace = str(tmp_path / "中文项目目录")
    payload = json.dumps(
        {"service": "starwatch", "workspace": workspace}, ensure_ascii=False
    ).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    helper = Path(__file__).resolve().parents[1] / "scripts" / "status.ps1"
    command = f"$ErrorActionPreference='Stop'; . '{str(helper).replace(chr(39), chr(39) * 2)}'; $taskStatus=Get-StarwatchStatus -Url 'http://127.0.0.1:{server.server_port}/'; if($taskStatus.workspace -ne '{workspace.replace(chr(39), chr(39) * 2)}'){{exit 3}}"
    try:
        result = subprocess.run(
            [powershell, "-NoProfile", "-Command", command],
            capture_output=True,
            timeout=15,
        )
        assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    finally:
        server.shutdown()
