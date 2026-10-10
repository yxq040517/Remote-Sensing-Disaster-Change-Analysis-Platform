import numpy as np
import pytest
from PIL import Image


def test_invalid_and_mismatched_images_fail_before_inference(tmp_path):
    from backend.images import read_image, validate_pair

    broken = tmp_path / "bad.png"
    broken.write_text("not an image")
    with pytest.raises(ValueError):
        read_image(broken)
    a, b = tmp_path / "a.png", tmp_path / "b.png"
    Image.fromarray(np.zeros((8, 8, 3), np.uint8)).save(a)
    Image.fromarray(np.zeros((9, 8, 3), np.uint8)).save(b)
    with pytest.raises(ValueError):
        validate_pair(a, b)


def test_plain_images_do_not_invent_geolocation(tmp_path):
    from backend.images import read_image

    path = tmp_path / "plain.png"
    Image.fromarray(np.zeros((8, 8, 3), np.uint8)).save(path)
    array, info = read_image(path)
    assert array.shape == (8, 8, 3)
    assert info["geo"] is None


def test_transparent_pixels_preserve_valid_coverage_for_pair(tmp_path):
    from backend.images import validate_pair

    a, b = tmp_path / "a.png", tmp_path / "b.png"
    rgba = np.full((8, 8, 4), 255, np.uint8)
    rgba[0, 0, 3] = 0
    Image.fromarray(rgba).save(a)
    Image.fromarray(rgba).save(b)
    _, _, info = validate_pair(a, b)
    assert not info["valid_mask"][0, 0]
    assert info["valid_mask"][1, 1]
    assert info["nodata_pixels"] == 1


def test_geotiff_uses_real_pixel_area_and_rejects_grid_mismatch(tmp_path):
    import rasterio
    from affine import Affine
    from backend.images import read_image, validate_pair

    a, b = tmp_path / "a.tif", tmp_path / "b.tif"
    for path, origin in [(a, 0), (b, 1)]:
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            height=8,
            width=8,
            count=3,
            dtype="uint8",
            crs="EPSG:32650",
            transform=Affine(2, 0, origin, 0, -3, 100),
        ) as dst:
            dst.write(np.zeros((3, 8, 8), np.uint8))
    _, info = read_image(a)
    assert info["geo"]["pixel_area_m2"] == 6
    with pytest.raises(ValueError, match="像素网格"):
        validate_pair(a, b)
