def test_tasks_and_review_history_survive_reopening(tmp_path):
    from backend.storage import Store

    store = Store(tmp_path)
    item = store.create({"name": "测试案例", "source": "upload", "state": "queued"})
    store.update(item["id"], state="completed", progress=1)
    review = store.add_review(
        item["id"],
        {
            "kind": "region",
            "region_id": 1,
            "class_id": 4,
            "status": "confirmed",
            "note": "屋顶损坏",
        },
    )
    reopened = Store(tmp_path)
    assert reopened.get(item["id"])["state"] == "completed"
    assert reopened.reviews(item["id"])[0]["note"] == "屋顶损坏"
    reopened.undo_review(item["id"], review["id"])
    assert reopened.reviews(item["id"]) == []
    assert len(reopened.reviews(item["id"], include_inactive=True)) == 1


def test_nonexistent_task_does_not_accept_reviews(tmp_path):
    from backend.storage import Store
    import pytest

    with pytest.raises(KeyError):
        Store(tmp_path).add_review(
            "missing", {"kind": "region", "region_id": 1, "class_id": 1}
        )
