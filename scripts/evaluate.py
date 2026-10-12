import argparse
import json
import sys
import time
from pathlib import Path
import numpy as np
from PIL import Image
from backend.engine import ROOT, ModelEngine, INFERENCE_VERSION
from backend.domain import benchmark_counts, scores, colorize
from scripts.prepare import sha256, extract


def atomic_json(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(content, ensure_ascii=False, indent=2), "utf-8")
    temp.replace(path)


def evaluate(engine=None, limit=None, full=False):
    engine = engine or ModelEngine()
    engine.load()
    if full:
        shards = sorted((ROOT / "data" / "downloads").glob("hold-*-of-00006.parquet"))
        if len(shards) != 6:
            raise RuntimeError("完整hold评估需要全部6个数据分片")
        extract(shards, 933, 1337)
    cases = json.loads((ROOT / "data" / "cases.json").read_text("utf-8"))
    manifest = json.loads(
        (ROOT / "data" / "evaluation" / "manifest.json").read_text("utf-8")
    )
    if limit:
        cases = cases[:limit]
    evaluation = ROOT / "data" / "evaluation"
    evaluation.mkdir(exist_ok=True)
    weight_sha = sha256(ROOT / "models" / "changeos" / "model.safetensors")
    result_path = evaluation / "per_case.json"
    previous = (
        json.loads(result_path.read_text("utf-8")) if result_path.exists() else {}
    )
    if (
        previous.get("model_sha256") != weight_sha
        or previous.get("manifest_sha256") != manifest["sha256"]
        or previous.get("pipeline_version") != INFERENCE_VERSION
        or previous.get("device") != engine.device
    ):
        previous = {
            "model_sha256": weight_sha,
            "manifest_sha256": manifest["sha256"],
            "pipeline_version": INFERENCE_VERSION,
            "device": engine.device,
            "results": {},
        }
    started = time.time()
    matrix = np.zeros((5, 5), np.int64)
    loc = np.zeros(3, np.int64)
    elapsed = 0.0
    failures = []
    items = []
    for index, sample in enumerate(cases):
        folder = ROOT / "data" / "cases" / sample["id"]
        cached = previous["results"].get(sample["id"])
        try:
            if not cached:
                before = np.asarray(Image.open(folder / "before.png").convert("RGB"))
                after = np.asarray(Image.open(folder / "after.png").convert("RGB"))
                mask, confidence, localization, meta = engine.predict(before, after)
                truth = np.asarray(Image.open(folder / "truth.png"))
                footprint = np.asarray(Image.open(folder / "footprint.png"))
                cm, counts = benchmark_counts(
                    footprint, truth, mask, localization > 0.5
                )
                local_scores = scores(cm, counts)
                cached = {
                    "id": sample["id"],
                    "image_name": sample["image_name"],
                    "event": sample["event"],
                    "confusion": cm.tolist(),
                    "localization": counts,
                    "seconds": meta["seconds"],
                    "metrics": local_scores,
                    "inference": meta,
                }
                previous["results"][sample["id"]] = cached
                output = evaluation / "predictions" / sample["id"]
                output.mkdir(parents=True, exist_ok=True)
                Image.fromarray(mask).save(output / "mask.png")
                colorize(mask).save(output / "overlay.png")
                atomic_json(result_path, previous)
            matrix += np.asarray(cached["confusion"])
            loc += cached["localization"]
            elapsed += cached["seconds"]
            items.append(cached)
            cached["metrics"] = scores(cached["confusion"], cached["localization"])
        except Exception as exc:
            failures.append({"id": sample["id"], "error": str(exc)})
            print(f"评估失败 {sample['id']}: {exc}", flush=True)
        measured = scores(matrix, loc)
        summary = {
            **measured,
            "state": "running" if index + 1 < len(cases) else "completed",
            "samples": len(items),
            "total": len(cases),
            "split": "hold",
            "manifest_sha256": manifest["sha256"],
            "model_sha256": weight_sha,
            "seconds": round(elapsed, 2),
            "mean_seconds": round(elapsed / len(items), 3) if items else 0,
            "wall_seconds": round(time.time() - started, 1),
            "failures": len(failures),
            "protocol": f"hold{'全量' if len(cases) == 933 else '固定抽样子集'}；损毁指标排除背景及255；独立定位F1；1024原图GPU推理",
            "events": sorted(set(x["event"] for x in items)),
            "failure_examples": sorted(
                items, key=lambda x: x["metrics"].get("present_class_mean_f1") or 0
            )[:5],
        }
        atomic_json(evaluation / "summary.json", summary)
        print(
            f"评估 {index + 1}/{len(cases)} | F1 {measured['overall_f1']:.4f} | {cached['seconds'] if cached else 0:.2f}s",
            flush=True,
        )
    atomic_json(evaluation / "errors.json", failures)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args()
    result = evaluate(limit=args.limit, full=args.full)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["failures"]:
        sys.exit(1)
