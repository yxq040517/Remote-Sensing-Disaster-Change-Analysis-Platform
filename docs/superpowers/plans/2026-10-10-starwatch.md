# 星察 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete a local disaster damage workbench with real pretrained inference, xBD imagery, manual review, reproducible evaluation and exports.

**Architecture:** React workbench, FastAPI HTTP/SSE service, SQLite metadata and local files. One worker serializes GPU inference. Original output is immutable; review and benchmark share explicit class definitions.

**Tech Stack:** React/TypeScript/Vite, Python 3.11, FastAPI, CUDA PyTorch, torchange ChangeOS, rasterio/Pillow, SQLite, pytest, Vitest.

## Global Constraints

Root `F:\project\遥感灾害变化分析平台`. No model training or simulated output. Independent environment. 4GB GPU, batch1, bounded tiled inference. Loopback binding. Real geographic area only with suitable metadata. Source metrics distinct from measured metrics. User approved direct full execution on 2026-10-10; implement inline.

## Task 1: Model Runtime and Data

Files: `requirements.txt`, `scripts/prepare.py`, `backend/engine.py`, `tests/test_engine.py`.
Interfaces: `ModelEngine.predict(before, after, progress) -> mask, confidence, metadata`; `tile_starts(length, size, stride)`.

- [x] Create Python3.11 venv; install CUDA Torch and application/model libraries.
- [x] Write and observe failing coverage test, then implement tiling:
```python
def test_tile_edges_cover_small_images():
    assert tile_starts(600,512,256) == [0,88]
    assert tile_starts(100,512,256) == [0]
```
- [x] Download full task weights/config and hold data, record SHA256/source/split.
- [x] Run real image pair; measure peak CUDA memory and latency; validate finite outputs/dimensions.

## Task 2: Metrics, Images and Persistence

Files: `backend/domain.py`, `backend/images.py`, `backend/storage.py`, `tests/test_domain.py`, `tests/test_storage.py`.
Interfaces: `statistics(mask, confidence, geo)`, `confusion_matrix(truth,pred)`, `scores(matrix)`; tasks/reviews SQLite records.

- [x] Write ignore-pixel and absent-class tests before functions:
```python
def test_ignore_pixels():
    assert confusion_matrix(np.array([1,255]),np.array([1,4])).sum() == 1
```
- [x] Run failing tests, implement benchmark formulas and region summaries, verify tests.
- [x] Test invalid image, dimensions and geographic grid rejection, then implement image validation.
- [x] Test persisted task/review reload and undo, then implement SQLite methods.

## Task 3: Upload, Queue and API

Files: `backend/server.py`, `tests/test_api.py`.
Interfaces: status/cases/tasks/task-events/reviews/files endpoints under `/api`.

- [x] Write failing API tests for invalid input, task creation, unsafe paths and review classes.
- [x] Implement sequential worker, real progress, retries and persisted lifecycle.
- [x] Add SSE/poll recovery; mark interrupted tasks retryable at restart.
- [x] Expose actionable missing-model/data errors, never replacement predictions.

## Task 4: Complete UI

Files: `frontend/src/{App,Overview,Workbench,Panels}.tsx`, `api.ts`, `types.ts`, `styles.css`, `workbench.test.tsx`.
Interfaces: typed Task/Case/Region/Review matching backend; app-owned active task.

- [x] Test view switching/class filtering/review selection before component behavior.
- [x] Build app shell, genuine imagery overview, import dialog and readiness status.
- [x] Implement synchronized pan/zoom, swipe, overlays, opacity, hit-test and local crops.
- [x] Implement review confirmation/reclassification/notes, polygon editing, undo and persistence.
- [x] Typecheck/build and verify desktop/narrow-screen browser workflows.

## Task 5: Exports and Evaluation

Files: `backend/reports.py`, `scripts/evaluate.py`, `tests/test_reports.py`, `frontend/src/Panels.tsx`.

- [x] Test original/reviewed export distinction and CSV/JSON fields before implementation.
- [x] Build printable HTML/PDF, mask/CSV/JSON and geo-aware polygon exports.
- [x] Freeze seeded100 hold manifest/hash; run independent evaluation without favorable selection.
- [x] Report per-class/localization/composite F1 and latency, failure cases, resumable933 full option.
- [x] Separate source-reported numbers from local measurement with explicit sample count/protocol.

## Task 6: Delivery

Files: `启动星察.ps1`, `启动星察.cmd`, `README.md`, `docs/validation.md`.

- [x] Run backend/frontend tests, typecheck/build and genuine inference.
- [x] Browser-check upload, analysis, swipe, pan/zoom, filters, selection, polygons, review/reload/undo and reports.
- [x] Verify invalid/missing asset states, responsive/print CSS and downloaded-asset offline use.
- [x] Record measured GPU/runtime/model results, provenance/licenses and actual UI screenshots.
- [x] Commit complete application and open local UI.
