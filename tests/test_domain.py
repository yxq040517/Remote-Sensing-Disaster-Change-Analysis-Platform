import numpy as np


def test_ignored_pixels_and_localization_are_independent():
    from backend.domain import confusion_matrix, scores

    truth = np.array([0, 1, 2, 3, 4, 255], dtype=np.uint8)
    pred = np.array([0, 1, 2, 3, 4, 1], dtype=np.uint8)
    matrix = confusion_matrix(truth, pred)
    assert matrix.sum() == 5
    result = scores(matrix)
    assert result["overall_f1"] == 1
    assert result["damage_f1"] == 1
    assert result["localization_f1"] == 1


def test_missing_minor_class_is_not_hidden_by_background_accuracy():
    from backend.domain import confusion_matrix, scores

    truth = np.array([0] * 100 + [1, 2, 3, 4])
    pred = np.array([0] * 100 + [1, 1, 3, 4])
    result = scores(confusion_matrix(truth, pred))
    assert result["class_f1"][1] == 0
    assert result["damage_f1"] == 0
    assert result["overall_f1"] < 0.31


def test_regions_are_candidates_and_non_geographic_area_is_pixels():
    from backend.domain import statistics

    mask = np.zeros((8, 8), dtype=np.uint8)
    mask[0:2, 0:2] = 1
    mask[5:8, 5:8] = 4
    result, labels = statistics(mask, np.ones(mask.shape), None)
    assert result["candidate_count"] == 2
    assert result["building_pixels"] == 13
    assert result["area_m2"] is None
    assert len(result["regions"]) == 2
    assert labels[0, 0] != labels[7, 7]


def test_review_layer_never_mutates_original_and_supports_polygons():
    from backend.domain import apply_reviews

    original = np.ones((8, 8), dtype=np.uint8)
    regions = np.ones((8, 8), dtype=np.int32)
    reviewed = apply_reviews(
        original, regions, [{"kind": "region", "region_id": 1, "class_id": 4}]
    )
    assert (original == 1).all()
    assert (reviewed == 4).all()
    edited = apply_reviews(
        original,
        regions,
        [
            {
                "kind": "polygon",
                "points": [[1, 1], [3, 1], [3, 3], [1, 3]],
                "class_id": 2,
            }
        ],
    )
    assert edited[2, 2] == 2
    assert edited[6, 6] == 1


def test_xview_damage_scores_exclude_background_but_localization_counts_it():
    from backend.domain import benchmark_counts, scores

    truth = np.array([0, 1, 2, 3, 4, 255])
    footprints = np.array([0, 1, 1, 1, 1, 1])
    prediction = np.array([4, 1, 2, 3, 4, 4])
    matrix, loc = benchmark_counts(footprints, truth, prediction, np.ones(6, bool))
    assert matrix.sum() == 4
    assert matrix[0].sum() == 0
    result = scores(matrix, loc)
    assert result["damage_f1"] == 1
    assert result["localization_f1"] < 1


def test_unlabelled_ground_truth_pixels_are_transparent():
    from backend.domain import colorize

    rgba = np.asarray(colorize(np.array([[255, 4]], np.uint8)))
    assert rgba[0, 0, 3] == 0
    assert rgba[0, 1, 3] > 0


def test_case_diagnostics_do_not_call_missing_classes_prediction_failures():
    from backend.domain import confusion_matrix, scores

    result = scores(confusion_matrix(np.array([1, 1]), np.array([1, 1])))
    assert result["present_class_mean_f1"] == 1
    assert result["class_support"] == [2, 0, 0, 0]
    assert result["damage_f1"] == 0
