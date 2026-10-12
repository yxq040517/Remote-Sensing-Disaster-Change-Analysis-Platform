import pytest


def test_tiles_cover_edges_without_redundant_padding():
    from backend.engine import tile_starts

    assert tile_starts(600, 512, 256) == [0, 88]
    assert tile_starts(1024, 512, 256) == [0, 256, 512]
    assert tile_starts(100, 512, 256) == [0]


def test_tile_parameters_cannot_leave_uncovered_pixels():
    from backend.engine import tile_starts

    with pytest.raises(ValueError):
        tile_starts(600, 256, 512)


def test_task_checkpoint_load_never_downloads_backbone_weights(monkeypatch):
    pytest.importorskip("torch")
    pytest.importorskip("torchange")
    import torchvision.models._api as model_api
    from backend.engine import ModelEngine

    engine = ModelEngine()
    if not engine.state()["downloaded"]:
        pytest.skip("requires downloaded official task weights")

    def forbidden(*args, **kwargs):
        raise AssertionError("Full task inference must not download backbone weights")

    monkeypatch.setattr(model_api, "load_state_dict_from_url", forbidden)
    engine.load("cpu")
    assert engine.model is not None
