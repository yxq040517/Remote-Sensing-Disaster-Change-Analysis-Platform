def test_hold_sampling_is_reproducible_and_does_not_choose_by_prediction():
    from scripts.prepare import sample_indices

    first = sample_indices(933, 100, 1337)
    assert first == sample_indices(933, 100, 1337)
    assert len(first) == len(set(first)) == 100
    assert min(first) >= 0 and max(first) < 933


def test_download_verifies_decoded_size_with_identity_encoding(tmp_path):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    import threading
    from scripts.prepare import download

    payload = b'{"verified":true}'
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_HEAD(self):
            identity = self.headers.get("Accept-Encoding") == "identity"
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload) if identity else 20))
            if not identity:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()

        def do_GET(self):
            requests.append("get")
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    path = tmp_path / "config.json"
    path.write_bytes(payload)
    try:
        result = download(f"http://127.0.0.1:{server.server_port}/config.json", path)
        assert result["bytes"] == len(payload)
        assert requests == []
    finally:
        server.shutdown()
