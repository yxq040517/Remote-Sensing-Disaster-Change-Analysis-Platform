import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw

CLASSES = [
    {"id": 1, "name": "未见损伤", "color": "#28b9ad"},
    {"id": 2, "name": "轻度损伤", "color": "#f6c45d"},
    {"id": 3, "name": "重度损伤", "color": "#f48b53"},
    {"id": 4, "name": "毁坏", "color": "#e65a70"},
]
PALETTE = np.array(
    [
        [0, 0, 0, 0],
        [40, 185, 173, 210],
        [246, 196, 93, 220],
        [244, 139, 83, 225],
        [230, 90, 112, 230],
    ],
    dtype=np.uint8,
)


def confusion_matrix(truth, prediction):
    truth, prediction = np.asarray(truth).ravel(), np.asarray(prediction).ravel()
    if truth.shape != prediction.shape:
        raise ValueError("标注与预测尺寸不同")
    valid = (truth >= 0) & (truth < 5)
    if np.any((prediction[valid] < 0) | (prediction[valid] > 4)):
        raise ValueError("预测类别必须是0至4")
    return np.bincount(
        (truth[valid] * 5 + prediction[valid]).astype(np.int64), minlength=25
    ).reshape(5, 5)


def scores(matrix, localization_counts=None):
    matrix = np.asarray(matrix, dtype=np.float64)
    tp = np.diag(matrix)
    denominators = matrix.sum(0) + matrix.sum(1)
    f1 = np.divide(2 * tp, denominators, out=np.zeros(5), where=denominators > 0)
    damage = 4 / np.sum(1 / f1[1:]) if np.all(f1[1:] > 0) else 0.0
    if localization_counts is None:
        loc_tp = matrix[1:, 1:].sum()
        loc_fp, loc_fn = matrix[0, 1:].sum(), matrix[1:, 0].sum()
    else:
        loc_tp, loc_fp, loc_fn = localization_counts
    loc_den = 2 * loc_tp + loc_fp + loc_fn
    loc = 2 * loc_tp / loc_den if loc_den else 0.0
    support = matrix.sum(1)[1:]
    present = f1[1:][support > 0]
    return {
        "overall_f1": float(0.3 * loc + 0.7 * damage),
        "localization_f1": float(loc),
        "damage_f1": float(damage),
        "class_f1": f1[1:].tolist(),
        "pixels": int(matrix.sum()),
        "class_support": support.astype(int).tolist(),
        "present_class_mean_f1": float(present.mean()) if present.size else None,
    }


def benchmark_counts(footprint, damage_truth, prediction, localization):
    footprint = np.asarray(footprint) > 0
    localization = np.asarray(localization, dtype=bool)
    damage_truth = np.asarray(damage_truth)
    valid = (damage_truth > 0) & (damage_truth < 5)
    matrix = confusion_matrix(damage_truth[valid], np.asarray(prediction)[valid])
    counts = [
        int((footprint & localization).sum()),
        int((~footprint & localization).sum()),
        int((footprint & ~localization).sum()),
    ]
    return matrix, counts


def statistics(mask, confidence=None, geo=None):
    mask = np.asarray(mask, dtype=np.uint8)
    labels, count = ndimage.label(mask > 0, structure=np.ones((3, 3)))
    boxes = ndimage.find_objects(labels)
    regions = []
    for index, box in enumerate(boxes, 1):
        if box is None:
            continue
        local = labels[box] == index
        size = int(local.sum())
        votes = np.bincount(mask[box][local], minlength=5)
        category = int(np.argmax(votes[1:]) + 1)
        y, x = box
        regions.append(
            {
                "id": index,
                "class_id": category,
                "pixels": size,
                "bbox": [x.start, y.start, x.stop, y.stop],
                "confidence": float(np.asarray(confidence)[box][local].mean())
                if confidence is not None
                else None,
            }
        )
    counts = [int((mask == i).sum()) for i in range(1, 5)]
    building_pixels = sum(counts)
    pixel_area = geo.get("pixel_area_m2") if geo else None
    return {
        "candidate_count": int(count),
        "building_pixels": building_pixels,
        "damaged_pixels": sum(counts[1:]),
        "total_pixels": int(mask.size),
        "class_counts": counts,
        "class_shares": [v / building_pixels if building_pixels else 0 for v in counts],
        "area_m2": building_pixels * pixel_area if pixel_area else None,
        "regions": sorted(regions, key=lambda r: (-r["class_id"], -r["pixels"])),
    }, labels.astype(np.int32)


def apply_reviews(original, regions, reviews):
    result = np.array(original, copy=True)
    for review in reviews:
        if not review.get("active", True):
            continue
        category = review.get("class_id")
        if category is None or review.get("status") == "needs_review":
            continue
        if review["kind"] == "region":
            result[regions == review["region_id"]] = category
        elif review["kind"] == "polygon":
            layer = Image.new("L", (result.shape[1], result.shape[0]))
            ImageDraw.Draw(layer).polygon([tuple(p) for p in review["points"]], fill=1)
            result[np.asarray(layer) > 0] = category
    return result


def colorize(mask):
    mask = np.asarray(mask)
    return Image.fromarray(PALETTE[np.where(mask <= 4, mask, 0)], "RGBA")
