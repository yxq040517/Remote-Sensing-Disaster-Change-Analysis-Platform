import asyncio
import csv
import io
import json
import shutil
import uuid
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .engine import ROOT, ModelEngine
from .storage import Store
from .images import validate_pair, MAX_BYTES
from .domain import CLASSES, apply_reviews, statistics, colorize
from .jobs import Worker
from .reports import report_html


class CaseRequest(BaseModel):
    case_id: str
    device: Literal["auto", "cuda", "cpu"] = "auto"


class ReviewRequest(BaseModel):
    kind: Literal["region", "polygon"] = "region"
    region_id: int | None = None
    class_id: int = Field(ge=0, le=4)
    points: list[list[float]] | None = None
    status: Literal["confirmed", "needs_review"] = "confirmed"
    note: str = Field(default="", max_length=1000)


def create_app(data_root=None, start_worker=True):
    root = Path(data_root) if data_root else ROOT / "data"
    store = Store(root)
    engine = ModelEngine()
    worker = Worker(root, store, engine)

    @asynccontextmanager
    async def lifespan(app):
        if start_worker:
            worker.start()
        yield
        worker.running = False
        worker.queue.put(None)

    app = FastAPI(title="星察 Starwatch", lifespan=lifespan)
    app.state.store = store
    app.state.evaluation_thread = None

    def task(task_id):
        try:
            return store.get(task_id)
        except KeyError:
            raise HTTPException(404, "任务不存在")

    def cases():
        path = root / "cases.json"
        return json.loads(path.read_text("utf-8")) if path.exists() else []

    def case(case_id):
        for item in cases():
            if item["id"] == case_id:
                return item
        raise HTTPException(404, "公开案例不存在或尚未下载")

    def materialize(item, before, after, info, truth=None):
        created = store.create(
            {
                **item,
                "state": "queued",
                "width": info["width"],
                "height": info["height"],
                "geo": info["geo"],
            }
        )
        folder = root / "tasks" / created["id"]
        folder.mkdir(parents=True, exist_ok=True)
        Image.fromarray(before).save(folder / "before.png")
        Image.fromarray(after).save(folder / "after.png")
        if info.get("valid_mask") is not None:
            Image.fromarray(info["valid_mask"].astype(np.uint8) * 255).save(
                folder / "validity.png"
            )
        if truth and Path(truth).exists():
            shutil.copyfile(truth, folder / "truth.png")
            colorize(np.asarray(Image.open(truth))).save(folder / "truth-overlay.png")
        worker.submit(created["id"])
        return created

    def reviewed(task_id):
        folder = root / "tasks" / task_id
        original = np.asarray(Image.open(folder / "mask.png"))
        regions = np.load(folder / "regions.npy")
        result = apply_reviews(original, regions, store.reviews(task_id))
        return result, folder

    @app.get("/api/status")
    def status():
        evaluation = root / "evaluation" / "summary.json"
        return {
            "service": "starwatch",
            "workspace": str(ROOT),
            "model": engine.state(),
            "classes": CLASSES,
            "cases": len(cases()),
            "queue": worker.queue.qsize(),
            "evaluation": json.loads(evaluation.read_text("utf-8"))
            if evaluation.exists()
            else None,
        }

    @app.get("/api/cases")
    def list_cases():
        return cases()

    @app.post("/api/evaluate")
    def run_evaluation():
        if not cases() or not (root / "evaluation" / "manifest.json").exists():
            raise HTTPException(422, "请先准备固定hold数据清单")
        if not engine.state()["downloaded"]:
            raise HTTPException(422, "请先准备任务模型权重")
        if app.state.evaluation_thread and app.state.evaluation_thread.is_alive():
            raise HTTPException(409, "固定清单评估已经在运行")
        from scripts.evaluate import evaluate, atomic_json

        manifest = json.loads(
            (root / "evaluation" / "manifest.json").read_text("utf-8")
        )
        initial = {
            "state": "running",
            "samples": 0,
            "total": manifest["samples"],
            "overall_f1": 0,
            "localization_f1": 0,
            "damage_f1": 0,
            "class_f1": [0, 0, 0, 0],
            "manifest_sha256": manifest["sha256"],
            "seconds": 0,
            "mean_seconds": 0,
            "protocol": "固定hold清单评估启动中；尚无已评估样本",
        }
        atomic_json(root / "evaluation" / "summary.json", initial)

        def job():
            try:
                evaluate(engine=engine)
            except Exception as exc:
                initial.update(state="failed", error=str(exc))
                atomic_json(root / "evaluation" / "summary.json", initial)

        app.state.evaluation_thread = threading.Thread(
            target=job, daemon=True, name="starwatch-evaluation"
        )
        app.state.evaluation_thread.start()
        return {"state": "running", "total": manifest["samples"]}

    @app.get("/api/cases/{case_id}/{image}")
    def case_image(case_id: str, image: Literal["before", "after", "truth"]):
        case(case_id)
        path = root / "cases" / case_id / f"{image}.png"
        if not path.exists():
            raise HTTPException(404, "案例影像不存在")
        return FileResponse(path)

    @app.get("/api/tasks")
    def list_tasks():
        return [
            {
                **t,
                "stats": {
                    k: v for k, v in t.get("stats", {}).items() if k != "regions"
                },
            }
            for t in store.list()
        ]

    @app.post("/api/tasks")
    def create_case(payload: CaseRequest):
        sample = case(payload.case_id)
        folder = root / "cases" / sample["id"]
        before, after, info = validate_pair(folder / "before.png", folder / "after.png")
        return materialize(
            {
                "name": sample["name"],
                "case_id": sample["id"],
                "event": sample["event"],
                "source": "xBD / hold",
                "image_name": sample["image_name"],
                "device": payload.device,
            },
            before,
            after,
            info,
            folder / "truth.png",
        )

    @app.post("/api/upload")
    async def upload(
        before: UploadFile = File(...),
        after: UploadFile = File(...),
        name: str = Form("自定义影像分析"),
        aligned: bool = Form(False),
        device: Literal["auto", "cuda", "cpu"] = Form("auto"),
    ):
        if not aligned:
            raise HTTPException(422, "请确认两幅影像已经对齐到同一区域和像素网格")
        uploads = root / "uploads"
        uploads.mkdir(exist_ok=True)
        paths = []
        try:
            for file in (before, after):
                suffix = Path(file.filename or "").suffix.lower()
                if suffix not in (".png", ".jpg", ".jpeg", ".tif", ".tiff"):
                    raise ValueError("支持PNG、JPEG和8位RGB GeoTIFF")
                path = uploads / f"{uuid.uuid4().hex}{suffix}"
                paths.append(path)
                size = 0
                with path.open("wb") as stream:
                    while chunk := await file.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise ValueError("单文件不能超过100MB")
                        stream.write(chunk)
            a, b, info = validate_pair(*paths)
            return materialize(
                {
                    "name": name[:120],
                    "source": "用户上传",
                    "device": device,
                    "original_names": [before.filename, after.filename],
                },
                a,
                b,
                info,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        finally:
            for path in paths:
                path.unlink(missing_ok=True)

    @app.get("/api/tasks/{task_id}")
    def get_task(task_id: str):
        item = task(task_id)
        reviews = store.reviews(task_id)
        item["reviews"] = reviews
        item["has_truth"] = (root / "tasks" / task_id / "truth.png").exists()
        if item["state"] == "completed" and reviews:
            mask, folder = reviewed(task_id)
            review_stats, _ = statistics(mask, None, item.get("geo"))
            item["review_stats"] = {
                k: v for k, v in review_stats.items() if k != "regions"
            }
        return item

    @app.post("/api/tasks/{task_id}/retry")
    def retry(task_id: str, device: Literal["auto", "cpu", "cuda"] = "auto"):
        item = task(task_id)
        if item["state"] not in ("failed", "interrupted"):
            raise HTTPException(409, "仅失败或中断任务可重试")
        store.update(task_id, state="queued", progress=0, device=device, error=None)
        worker.submit(task_id)
        return task(task_id)

    @app.get("/api/tasks/{task_id}/events")
    async def events(task_id: str, request: Request):
        task(task_id)

        async def stream():
            while not await request.is_disconnected():
                item = task(task_id)
                yield (
                    "data: "
                    + json.dumps(
                        {
                            k: item.get(k)
                            for k in ("state", "stage", "progress", "error")
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )
                if item["state"] in ("completed", "failed", "interrupted"):
                    return
                await asyncio.sleep(0.8)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache"},
        )

    @app.get("/api/tasks/{task_id}/pick")
    def pick(task_id: str, x: int, y: int):
        item = task(task_id)
        if item["state"] != "completed":
            raise HTTPException(409, "等待分析完成后选择区域")
        if not 0 <= x < item["width"] or not 0 <= y < item["height"]:
            return {"region_id": 0}
        labels = np.load(root / "tasks" / task_id / "regions.npy", mmap_mode="r")
        return {"region_id": int(labels[y, x])}

    @app.post("/api/tasks/{task_id}/reviews")
    def review(task_id: str, payload: ReviewRequest):
        item = task(task_id)
        if item["state"] != "completed":
            raise HTTPException(409, "等待分析完成后复核")
        if payload.kind == "region":
            regions = np.load(root / "tasks" / task_id / "regions.npy", mmap_mode="r")
            if (
                payload.region_id is None
                or payload.region_id <= 0
                or not np.any(regions == payload.region_id)
            ):
                raise HTTPException(422, "候选区域不存在")
        else:
            if not payload.points or not 3 <= len(payload.points) <= 500:
                raise HTTPException(422, "多边形需要3至500个顶点")
            for p in payload.points:
                if (
                    len(p) != 2
                    or not np.isfinite(p).all()
                    or not 0 <= p[0] < item["width"]
                    or not 0 <= p[1] < item["height"]
                ):
                    raise HTTPException(422, "多边形顶点必须位于影像范围内")
        return store.add_review(task_id, payload.model_dump())

    @app.delete("/api/tasks/{task_id}/reviews/{review_id}")
    def undo(task_id: str, review_id: str):
        task(task_id)
        try:
            store.undo_review(task_id, review_id)
        except KeyError:
            raise HTTPException(404, "复核记录不存在")
        return {"ok": True}

    @app.get("/api/tasks/{task_id}/report", response_class=HTMLResponse)
    def report(task_id: str):
        item = task(task_id)
        if item["state"] != "completed":
            raise HTTPException(409, "分析尚未完成")
        result, _ = reviewed(task_id)
        review_stats, _ = statistics(result, None, item.get("geo"))
        evaluation_path = root / "evaluation" / "summary.json"
        evaluation = (
            json.loads(evaluation_path.read_text("utf-8"))
            if evaluation_path.exists()
            else None
        )
        return report_html(
            item,
            store.reviews(task_id),
            root / "tasks" / task_id,
            evaluation,
            review_stats,
        )

    @app.get("/api/tasks/{task_id}/files/{name}")
    def artifact(task_id: str, name: str):
        item = task(task_id)
        folder = root / "tasks" / task_id
        simple = {
            "before.png",
            "after.png",
            "mask.png",
            "overlay.png",
            "truth.png",
            "truth-overlay.png",
            "composite.png",
        }
        if name in simple:
            path = folder / name
            if path.exists():
                return FileResponse(path, headers={"Cache-Control": "no-cache"})
        dynamic = {
            "reviewed-mask.png",
            "reviewed-overlay.png",
            "metadata.json",
            "regions.csv",
            "regions.geojson",
            "result.tif",
        }
        if name not in dynamic:
            raise HTTPException(404, "结果文件不存在")
        if item["state"] != "completed":
            raise HTTPException(409, "分析尚未完成")
        mask, _ = reviewed(task_id)
        if name.endswith(".png"):
            image = (
                colorize(mask)
                if name == "reviewed-overlay.png"
                else Image.fromarray(mask)
            )
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return Response(
                buffer.getvalue(),
                media_type="image/png",
                headers={"Cache-Control": "no-store"},
            )
        if name == "metadata.json":
            content = json.dumps(
                {**item, "reviews": store.reviews(task_id, True)},
                ensure_ascii=False,
                indent=2,
            )
            return Response(
                content,
                media_type="application/json",
                headers={"Content-Disposition": 'attachment; filename="metadata.json"'},
            )
        if name == "regions.csv":
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow(
                [
                    "region_id",
                    "model_class",
                    "review_class",
                    "pixels",
                    "model_score",
                    "review_status",
                ]
            )
            latest = {
                r["region_id"]: r
                for r in store.reviews(task_id)
                if r["kind"] == "region"
            }
            for region in item["stats"]["regions"]:
                r = latest.get(region["id"], {})
                writer.writerow(
                    [
                        region["id"],
                        region["class_id"],
                        r.get("class_id", ""),
                        region["pixels"],
                        region["confidence"],
                        r.get("status", "unreviewed"),
                    ]
                )
            return Response(
                "\ufeff" + buffer.getvalue(),
                media_type="text/csv",
                headers={"Content-Disposition": 'attachment; filename="regions.csv"'},
            )
        if name == "result.tif":
            if not item.get("geo"):
                raise HTTPException(422, "影像没有地理参考，不能导出地理参考GeoTIFF")
            import rasterio
            from affine import Affine
            from rasterio.io import MemoryFile

            with MemoryFile() as mem:
                with mem.open(
                    driver="GTiff",
                    height=mask.shape[0],
                    width=mask.shape[1],
                    count=1,
                    dtype="uint8",
                    crs=item["geo"]["crs"],
                    transform=Affine(*item["geo"]["transform"]),
                    compress="deflate",
                ) as dst:
                    dst.write(mask, 1)
                return Response(
                    mem.read(),
                    media_type="image/tiff",
                    headers={
                        "Content-Disposition": 'attachment; filename="result.tif"'
                    },
                )
        import rasterio.features
        from affine import Affine

        geo = item.get("geo")
        transform = Affine(*geo["transform"]) if geo else Affine.identity()
        features = []
        for geometry, value in rasterio.features.shapes(
            mask, mask=mask > 0, transform=transform
        ):
            if geo:
                from rasterio.warp import transform_geom

                geometry = transform_geom(geo["crs"], "EPSG:4326", geometry)
            features.append(
                {
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": {
                        "class_id": int(value),
                        "coordinate_space": "geographic" if geo else "image_pixels",
                    },
                }
            )
        content = json.dumps(
            {
                "type": "FeatureCollection",
                "coordinate_space": "WGS84" if geo else "image_pixels",
                "features": features,
            },
            ensure_ascii=False,
        )
        return Response(
            content,
            media_type="application/geo+json",
            headers={"Content-Disposition": 'attachment; filename="regions.geojson"'},
        )

    dist = ROOT / "frontend" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
