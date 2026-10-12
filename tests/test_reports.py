def test_report_escapes_notes_and_separates_predictions_from_reviews(tmp_path):
    from backend.reports import report_html

    task = {
        "id": "sample",
        "name": "<script>bad</script>",
        "created_at": "2026-10-10",
        "stats": {"class_counts": [1, 2, 3, 4], "candidate_count": 2},
        "inference": {"seconds": 1, "model_id": "verified"},
    }
    report = report_html(
        task, [{"note": "<img onerror=alert(1)>", "status": "confirmed"}], tmp_path
    )
    assert "<script>bad</script>" not in report
    assert "&lt;script&gt;" in report
    assert "模型原始结果" in report and "人工复核" in report


def test_report_labels_local_subset_separately_from_source_metrics(tmp_path):
    from backend.reports import report_html

    task = {
        "id": "sample",
        "name": "公开案例",
        "stats": {"class_counts": [1, 2, 3, 4]},
        "inference": {},
    }
    local = {"samples": 100, "total": 100, "overall_f1": 0.7749, "state": "completed"}
    report = report_html(task, [], tmp_path, evaluation=local)
    assert "来源公开指标" in report
    assert "本机复测" in report
    assert "100" in report and "77.49%" in report


def test_report_displays_shanghai_time_not_raw_utc(tmp_path):
    from backend.reports import report_html

    task = {
        "id": "sample",
        "name": "公开案例",
        "created_at": "2026-10-10T08:30:00+00:00",
        "stats": {},
        "inference": {},
    }
    report = report_html(task, [], tmp_path)
    assert "2026-10-10 16:30:00" in report
