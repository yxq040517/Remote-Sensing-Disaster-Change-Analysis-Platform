import argparse
import hashlib
import json
import random
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import requests

ROOT = Path(__file__).resolve().parents[1]
MODEL = "EVER-Z/torchange_example_changeos_swint_on_xview2_best42k"
DATASET = "EVER-Z/torchange_xView2"
EVENTS = {
    "midwest-flooding": ("美国中西部洪灾", "洪灾"),
    "hurricane-michael": ("迈克尔飓风", "飓风"),
    "hurricane-matthew": ("马修飓风", "飓风"),
    "hurricane-florence": ("佛罗伦斯飓风", "飓风"),
    "hurricane-harvey": ("哈维飓风", "飓风"),
    "moore-tornado": ("摩尔龙卷风", "龙卷风"),
    "joplin-tornado": ("乔普林龙卷风", "龙卷风"),
    "palu-tsunami": ("帕卢海啸", "海啸"),
    "sunda-tsunami": ("巽他海啸", "海啸"),
    "santa-rosa-wildfire": ("圣罗莎山火", "山火"),
    "woolsey-fire": ("伍尔西山火", "山火"),
    "portugal-wildfire": ("葡萄牙山火", "山火"),
    "mexico-earthquake": ("墨西哥地震", "地震"),
    "nepal-earthquake": ("尼泊尔地震", "地震"),
    "guatemala-volcano": ("危地马拉火山事件", "火山"),
}
EVENTS["socal-fire"] = ("南加州山火", "山火")


def sample_indices(total, count, seed):
    return sorted(random.Random(seed).sample(range(total), min(total, count)))


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while chunk := stream.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download(url, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Validate existing downloads against server metadata rather than trusting existence.
    head = requests.head(
        url,
        allow_redirects=True,
        headers={"Accept-Encoding": "identity"},
        timeout=(20, 60),
    )
    head.raise_for_status()
    expected = int(head.headers.get("Content-Length", 0))
    if path.exists() and expected and path.stat().st_size == expected:
        print(f"已验证缓存: {path.name}", flush=True)
        return {"source": url, "bytes": expected, "sha256": sha256(path)}
    temporary = path.with_suffix(path.suffix + ".part")
    for attempt in range(4):
        try:
            offset = temporary.stat().st_size if temporary.exists() else 0
            headers = {"Accept-Encoding": "identity"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            response = requests.get(url, stream=True, headers=headers, timeout=(20, 90))
            response.raise_for_status()
            if offset and response.status_code != 206:
                offset = 0
            with temporary.open("ab" if offset else "wb") as target:
                for chunk in response.iter_content(1024 * 1024):
                    if chunk:
                        target.write(chunk)
            if expected and temporary.stat().st_size != expected:
                raise IOError("下载长度与服务器声明不一致")
            temporary.replace(path)
            print(
                f"下载完成: {path.name} ({path.stat().st_size / 1024**2:.1f}MB)",
                flush=True,
            )
            return {"source": url, "bytes": path.stat().st_size, "sha256": sha256(path)}
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2**attempt)


def extract(shards, count=100, seed=1337):
    import pyarrow.parquet as pq
    from PIL import Image
    import numpy as np

    total = sum(pq.ParquetFile(p).metadata.num_rows for p in shards)
    chosen = sample_indices(total, count, seed)
    selected = set(chosen)
    cases = []
    global_index = 0
    for shard in shards:
        for batch in pq.ParquetFile(shard).iter_batches(batch_size=4):
            for row in batch.to_pylist():
                if global_index in selected:
                    raw = row["image_name"].split("/")[-1]
                    event, number = raw.rsplit("_", 1)
                    title, kind = EVENTS.get(event, (event, "灾害事件"))
                    case_id = f"hold-{global_index:04d}"
                    folder = ROOT / "data" / "cases" / case_id
                    folder.mkdir(parents=True, exist_ok=True)
                    for source, dest in [
                        ("t1_image", "before"),
                        ("t2_image", "after"),
                        ("t1_mask", "footprint"),
                        ("t2_mask", "truth"),
                    ]:
                        (folder / f"{dest}.png").write_bytes(row[source]["bytes"])
                    truth = np.asarray(Image.open(folder / "truth.png"))
                    valid = truth[truth != 255]
                    values = set(np.unique(valid).tolist())
                    if not values.issubset(set(range(5))):
                        raise ValueError(f"未知标注类别: {values}")
                    cases.append(
                        {
                            "id": case_id,
                            "name": f"{title} · 区域 {int(number)}",
                            "event": event,
                            "event_name": title,
                            "type": kind,
                            "image_name": row["image_name"],
                            "split": "hold",
                            "index": global_index,
                            "width": truth.shape[1],
                            "height": truth.shape[0],
                            "truth_counts": [
                                int((truth == i).sum()) for i in range(1, 5)
                            ],
                        }
                    )
                global_index += 1
    manifest = {
        "dataset": DATASET,
        "split": "hold",
        "available_images": total,
        "samples": len(cases),
        "seed": seed,
        "indices": chosen,
        "protocol": "从全部可用hold影像按固定随机种子抽样，未按预测效果筛选",
    }
    encoded = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode()
    manifest["sha256"] = hashlib.sha256(encoded).hexdigest()
    (ROOT / "data" / "cases.json").write_text(
        json.dumps(cases, ensure_ascii=False, indent=2), "utf-8"
    )
    (ROOT / "data" / "evaluation").mkdir(exist_ok=True)
    (ROOT / "data" / "evaluation" / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8"
    )
    print(f"公开案例已准备: {len(cases)}对；原始hold可用 {total}对", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--data-only", action="store_true")
    parser.add_argument("--first-shard", action="store_true")
    args = parser.parse_args()
    sources = []
    if not args.data_only:
        for name in ("config.json", "model.safetensors"):
            sources.append(
                download(
                    f"https://hf-mirror.com/{MODEL}/resolve/main/{name}",
                    ROOT / "models" / "changeos" / name,
                )
            )
    paths = [
        ROOT / "data" / "downloads" / f"hold-{i:05d}-of-00006.parquet"
        for i in range(1 if args.first_shard else 6)
    ]
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [
            pool.submit(
                download,
                f"https://hf-mirror.com/datasets/{DATASET}/resolve/main/data/{p.name}",
                p,
            )
            for p in paths
        ]
        sources.extend(f.result() for f in futures)
    (ROOT / "data" / "provenance.json").write_text(
        json.dumps(
            {
                "model": MODEL,
                "dataset": DATASET,
                "sources": sources,
                "rights": "数据使用权以原始xBD发布条款为准，模型代码许可不替代影像数据许可。",
            },
            ensure_ascii=False,
            indent=2,
        ),
        "utf-8",
    )
    extract(paths, args.samples, args.seed)


if __name__ == "__main__":
    main()
