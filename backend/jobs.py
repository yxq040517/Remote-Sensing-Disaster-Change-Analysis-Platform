import queue
import threading
import time
import traceback
from pathlib import Path
import numpy as np
from PIL import Image
from .domain import statistics, colorize
from .images import validate_pair


class Worker:
    def __init__(self, root, store, engine):
        self.root = Path(root)
        self.store, self.engine = store, engine
        self.queue = queue.Queue()
        self.running = True
        self.thread = threading.Thread(
            target=self.run, daemon=True, name="starwatch-inference"
        )

    def start(self):
        for task in self.store.list():
            if task["state"] == "running":
                self.store.update(
                    task["id"], state="interrupted", stage="服务重启，任务可重新分析"
                )
            elif task["state"] == "queued":
                self.submit(task["id"])
        self.thread.start()

    def submit(self, task_id):
        self.queue.put(task_id)

    def run(self):
        while self.running:
            task_id = self.queue.get()
            if task_id is None:
                return
            folder = self.root / "tasks" / task_id
            try:
                task = self.store.get(task_id)
                self.store.update(
                    task_id,
                    state="running",
                    stage="校验影像与加载模型",
                    progress=0.02,
                    error=None,
                )
                before, after, info = validate_pair(
                    folder / "before.png", folder / "after.png"
                )
                last = 0

                def progress(value, message):
                    nonlocal last
                    now = time.monotonic()
                    if now - last > 0.25 or value == 1:
                        self.store.update(
                            task_id, stage=message, progress=0.06 + 0.87 * value
                        )
                        last = now

                try:
                    mask, confidence, locs, meta = self.engine.predict(
                        before, after, progress, requested=task.get("device", "auto")
                    )
                except Exception as exc:
                    if (
                        "out of memory" in str(exc).lower()
                        and task.get("device") != "cpu"
                    ):
                        import torch

                        torch.cuda.empty_cache()
                        self.store.update(task_id, stage="显存不足，使用256像素块重试")
                        mask, confidence, locs, meta = self.engine.predict(
                            before,
                            after,
                            progress,
                            requested=task.get("device", "auto"),
                            tile=256,
                        )
                    else:
                        raise
                self.store.update(
                    task_id, stage="拼接结果与统计候选区域", progress=0.95
                )
                if (folder / "validity.png").exists():
                    valid = np.asarray(Image.open(folder / "validity.png")) > 0
                    mask[~valid] = 0
                    confidence[~valid] = 0
                    locs[~valid] = 0
                    meta["nodata_pixels"] = int((~valid).sum())
                Image.fromarray(mask).save(folder / "mask.png")
                np.save(folder / "confidence.npy", confidence)
                np.save(folder / "localization.npy", locs)
                result, regions = statistics(mask, confidence, task.get("geo"))
                np.save(folder / "regions.npy", regions)
                overlay = colorize(mask)
                overlay.save(folder / "overlay.png")
                composite = Image.alpha_composite(
                    Image.fromarray(after).convert("RGBA"), overlay
                )
                composite.convert("RGB").save(folder / "composite.png")
                self.store.update(
                    task_id,
                    state="completed",
                    stage="分析完成",
                    progress=1,
                    stats=result,
                    inference=meta,
                    completed_at=time.time(),
                    error=None,
                )
            except Exception as exc:
                self.engine.error = str(exc)
                self.store.update(
                    task_id, state="failed", stage="分析未完成", error=str(exc)
                )
                traceback.print_exc()
            finally:
                self.queue.task_done()
