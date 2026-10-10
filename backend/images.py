from pathlib import Path
import warnings
import numpy as np
from PIL import Image

MAX_PIXELS = 16_000_000
MAX_BYTES = 100 * 1024 * 1024


def read_image(path):
    path = Path(path)
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("单文件不能超过100MB")
    geo = None
    valid_mask = None
    try:
        if path.suffix.lower() in (".tif", ".tiff"):
            import rasterio

            with rasterio.open(path) as source:
                if source.width * source.height > MAX_PIXELS:
                    raise ValueError("影像不能超过1600万像素")
                if source.count < 3:
                    raise ValueError("需要三波段RGB影像；单波段SAR不适用于当前模型")
                array = source.read([1, 2, 3]).transpose(1, 2, 0)
                valid_mask = source.dataset_mask() > 0
                if array.dtype != np.uint8:
                    raise ValueError(
                        "当前模型使用8位RGB影像，请先按一致规则将前后影像转换为RGB"
                    )
                if source.crs:
                    transform = list(source.transform)[:6]
                    pixel_area = None
                    if source.crs.is_projected:
                        unit, factor = source.crs.linear_units_factor
                        pixel_area = (
                            abs(
                                source.transform.a * source.transform.e
                                - source.transform.b * source.transform.d
                            )
                            * factor**2
                        )
                    geo = {
                        "crs": source.crs.to_string(),
                        "transform": transform,
                        "bounds": list(source.bounds),
                        "pixel_area_m2": pixel_area,
                    }
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(path) as im:
                    if im.width * im.height > MAX_PIXELS:
                        raise ValueError("影像不能超过1600万像素")
                    if im.format not in ("PNG", "JPEG"):
                        raise ValueError("支持PNG、JPEG或8位RGB GeoTIFF")
                    array = np.asarray(im.convert("RGB")).copy()
                    if "A" in im.getbands() or "transparency" in im.info:
                        valid_mask = np.asarray(im.convert("RGBA"))[:, :, 3] > 0
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("文件无法读取为有效影像") from exc
    return array, {
        "width": array.shape[1],
        "height": array.shape[0],
        "geo": geo,
        "format": path.suffix.lower(),
        "valid_mask": valid_mask,
    }


def validate_pair(before_path, after_path):
    before, binfo = read_image(before_path)
    after, ainfo = read_image(after_path)
    if before.shape != after.shape:
        raise ValueError("前后影像尺寸不同，请先对齐到相同像素网格")
    if bool(binfo["geo"]) != bool(ainfo["geo"]):
        raise ValueError("前后影像的地理信息不一致")
    if binfo["geo"] and (
        binfo["geo"]["crs"] != ainfo["geo"]["crs"]
        or not np.allclose(
            binfo["geo"]["transform"], ainfo["geo"]["transform"], rtol=0, atol=1e-6
        )
    ):
        raise ValueError("前后GeoTIFF坐标系或像素网格不同，请先进行配准")
    valid = binfo.get("valid_mask")
    if ainfo.get("valid_mask") is not None:
        valid = ainfo["valid_mask"] if valid is None else valid & ainfo["valid_mask"]
    if valid is not None and not valid.any():
        raise ValueError("前后影像没有共同有效区域")
    binfo["valid_mask"] = valid
    binfo["nodata_pixels"] = int((~valid).sum()) if valid is not None else 0
    return before, after, binfo
