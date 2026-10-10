from io import BytesIO
import numpy as np
from PIL import Image


def test_upload_requires_alignment_and_valid_images(tmp_path):
    from fastapi.testclient import TestClient
    from backend.server import create_app

    with TestClient(create_app(tmp_path, start_worker=False)) as client:
        response = client.post(
            "/api/upload",
            files={
                "before": ("a.png", b"bad", "image/png"),
                "after": ("b.png", b"bad", "image/png"),
            },
            data={"aligned": "true"},
        )
        assert response.status_code == 422
        stream = BytesIO()
        Image.fromarray(np.zeros((8, 8, 3), np.uint8)).save(stream, format="PNG")
        response = client.post(
            "/api/upload",
            files={
                "before": ("a.png", stream.getvalue(), "image/png"),
                "after": ("b.png", stream.getvalue(), "image/png"),
            },
            data={"aligned": "false"},
        )
        assert response.status_code == 422


def test_unknown_artifact_and_case_are_not_filesystem_access(tmp_path):
    from fastapi.testclient import TestClient
    from backend.server import create_app

    with TestClient(create_app(tmp_path, start_worker=False)) as client:
        assert client.get("/api/cases/missing/before").status_code == 404
        assert (
            client.post("/api/tasks", json={"case_id": "../../outside"}).status_code
            == 404
        )
        assert client.get("/api/tasks/missing/files/secret.txt").status_code == 404
        assert client.post("/api/evaluate").status_code == 422


def test_review_validation_and_reloading(tmp_path):
    from fastapi.testclient import TestClient
    from backend.server import create_app

    app = create_app(tmp_path, start_worker=False)
    item = app.state.store.create(
        {"name": "test", "state": "completed", "width": 8, "height": 8}
    )
    folder = tmp_path / "tasks" / item["id"]
    folder.mkdir(parents=True)
    np.save(folder / "regions.npy", np.ones((8, 8), np.int32))
    Image.fromarray(np.ones((8, 8), np.uint8)).save(folder / "mask.png")
    with TestClient(app) as client:
        assert (
            client.post(
                f"/api/tasks/{item['id']}/reviews",
                json={"kind": "region", "region_id": 1, "class_id": 8},
            ).status_code
            == 422
        )
        assert (
            client.post(
                f"/api/tasks/{item['id']}/reviews",
                json={
                    "kind": "polygon",
                    "points": [[-1, 0], [2, 1], [2, 2]],
                    "class_id": 4,
                },
            ).status_code
            == 422
        )
        saved = client.post(
            f"/api/tasks/{item['id']}/reviews",
            json={
                "kind": "region",
                "region_id": 1,
                "class_id": 4,
                "status": "confirmed",
                "note": "检查过",
            },
        ).json()
        assert (
            client.get(f"/api/tasks/{item['id']}").json()["reviews"][0]["note"]
            == "检查过"
        )
        assert (
            client.delete(f"/api/tasks/{item['id']}/reviews/{saved['id']}").status_code
            == 200
        )
        assert client.get(f"/api/tasks/{item['id']}").json()["reviews"] == []
