import json
import os
import threading
import time
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "EVER-Z/torchange_example_changeos_swint_on_xview2_best42k"
INFERENCE_VERSION = "changeos-native1024-cuda-v1"
os.environ.setdefault("NO_ALBUMENTATIONS_UPDATE", "1")


def tile_starts(length, size=512, stride=256):
    if length <= 0 or size <= 0 or stride <= 0 or stride > size:
        raise ValueError("切块参数不能产生空隙或空图像")
    if length <= size:
        return [0]
    starts = list(range(0, length - size + 1, stride))
    if starts[-1] != length - size:
        starts.append(length - size)
    return starts


class ModelEngine:
    def __init__(self):
        self.model = None
        self.device = None
        self.error = None
        self.lock = threading.RLock()
        self.model_dir = ROOT / "models" / "changeos"

    def state(self):
        weights = self.model_dir / "model.safetensors"
        return {
            "name": "ChangeOS Swin-T",
            "model_id": MODEL_ID,
            "downloaded": weights.is_file()
            and (self.model_dir / "config.json").is_file(),
            "loaded": self.model is not None,
            "device": self.device,
            "error": self.error,
            "source_metrics": {
                "overall_f1": 0.7691,
                "localization_f1": 0.8503,
                "damage_f1": 0.7343,
                "class_f1": [0.8939, 0.5803, 0.7275, 0.8125],
            },
            "source_protocol": "train+tier3训练，test选权重，hold报告；来源模型卡指标",
        }

    def load(self, requested="auto"):
        with self.lock:
            import torch

            if requested == "cuda" and not torch.cuda.is_available():
                raise RuntimeError("CUDA不可用，请安装项目CUDA依赖或选择CPU")
            device = (
                "cuda" if requested != "cpu" and torch.cuda.is_available() else "cpu"
            )
            if self.model is not None and self.device == device:
                return
            if not self.state()["downloaded"]:
                raise RuntimeError("模型权重未就绪，请运行模型与数据准备脚本")
            from torchange.models.changeos import ChangeOS

            torch.set_num_threads(4)
            from safetensors.torch import load_model

            config = json.loads((self.model_dir / "config.json").read_text("utf-8"))[
                "config"
            ]
            config["encoder"]["params"]["weights"] = None
            model = ChangeOS(config)
            load_model(model, str(self.model_dir / "model.safetensors"), strict=True)
            self.model = model.eval().to(device)
            self.device, self.error = device, None

    def predict(
        self,
        before,
        after,
        progress=lambda value, message: None,
        requested="auto",
        tile=None,
    ):
        with self.lock:
            import torch

            self.load(requested)
            h, w = before.shape[:2]
            if tile is None:
                tile = (
                    1024 if self.device == "cuda" and 512 < max(h, w) <= 1024 else 512
                )
            if before.shape != after.shape:
                raise ValueError("前后影像尺寸不同")
            started = time.perf_counter()
            if self.device == "cuda":
                torch.cuda.reset_peak_memory_stats()
            xs, ys = tile_starts(w, tile, tile // 2), tile_starts(h, tile, tile // 2)
            total = len(xs) * len(ys)
            probs = np.zeros((5, h, w), np.float32)
            locs = np.zeros((h, w), np.float32)
            norm = np.zeros((h, w), np.float32)
            window = np.outer(
                np.maximum(np.hanning(tile), 0.05), np.maximum(np.hanning(tile), 0.05)
            ).astype(np.float32)
            mean = np.array([0.485, 0.456, 0.406] * 2, np.float32)[:, None, None]
            std = np.array([0.229, 0.224, 0.225] * 2, np.float32)[:, None, None]
            step = 0
            with torch.inference_mode():
                for y in ys:
                    for x in xs:
                        hh, ww = min(tile, h - y), min(tile, w - x)
                        pair = np.concatenate(
                            [
                                before[y : y + hh, x : x + ww],
                                after[y : y + hh, x : x + ww],
                            ],
                            axis=2,
                        )
                        pair = np.pad(
                            pair, ((0, tile - hh), (0, tile - ww), (0, 0)), mode="edge"
                        )
                        tensor = torch.from_numpy(
                            (pair.transpose(2, 0, 1).astype(np.float32) / 255 - mean)
                            / std
                        )[None].to(self.device)
                        with torch.autocast(
                            device_type=self.device,
                            enabled=self.device == "cuda",
                            dtype=torch.float16,
                        ):
                            output = self.model(tensor)
                        damage = (
                            output["change_prediction"][0]
                            .float()
                            .cpu()
                            .numpy()[:, :hh, :ww]
                        )
                        footprint = (
                            output["t1_semantic_prediction"][0, 0]
                            .float()
                            .cpu()
                            .numpy()[:hh, :ww]
                        )
                        if (
                            not np.isfinite(damage).all()
                            or not np.isfinite(footprint).all()
                        ):
                            raise RuntimeError("模型输出包含非有限值，停止分析")
                        weight = window[:hh, :ww]
                        probs[:, y : y + hh, x : x + ww] += damage * weight
                        locs[y : y + hh, x : x + ww] += footprint * weight
                        norm[y : y + hh, x : x + ww] += weight
                        step += 1
                        progress(step / total, f"正在分析影像块 {step} / {total}")
            probs /= norm[None]
            locs /= norm
            mask = ((locs > 0.5) * probs.argmax(0)).astype(np.uint8)
            confidence = probs.max(0)
            metadata = {
                "model_id": MODEL_ID,
                "device": self.device,
                "tile": tile,
                "stride": tile // 2,
                "tiles": total,
                "pipeline_version": INFERENCE_VERSION,
                "strategy": "native" if total == 1 else "overlap-tiles",
                "seconds": round(time.perf_counter() - started, 3),
                "width": w,
                "height": h,
                "peak_vram_mb": round(torch.cuda.max_memory_allocated() / 1024**2, 1)
                if self.device == "cuda"
                else None,
                "normalization": "ImageNet RGB; pre/post stacked; localization>0.5; argmax damage",
            }
            return mask, confidence, locs, metadata
