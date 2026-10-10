import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  MoveHorizontal,
  Layers3,
  MousePointer2,
  PenTool,
  Download,
  FileText,
  ChevronDown,
  Check,
  LoaderCircle,
  AlertTriangle,
  Undo2,
  Search,
  ScanLine,
} from "lucide-react";
import type { Task, Region, Review } from "./types";
import { classes, format, percent, states } from "./types";
import { api, file, reviewRevision } from "./api";
import { ReviewPanel } from "./Panels";

type View = "compare" | "before" | "after" | "overlay";
function Viewport({
  task,
  view,
  opacity,
  enabled,
  truth,
  reviewed,
  selected,
  drawing,
  onPick,
  onPolygon,
}: {
  task: Task;
  view: View;
  opacity: number;
  enabled: number[];
  truth: boolean;
  reviewed: boolean;
  selected: Region | null;
  drawing: boolean;
  onPick: (x: number, y: number) => void;
  onPolygon: (points: number[][]) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null),
    images = useRef<Record<string, HTMLImageElement>>({});
  const [size, setSize] = useState({ w: 800, h: 650 }),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [split, setSplit] = useState(0.5),
    [points, setPoints] = useState<number[][]>([]),
    [loaded, setLoaded] = useState(0);
  const drag = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
    moved: boolean;
    divider: boolean;
  } | null>(null);
  const filteredOverlay = useRef<{
    key: string;
    canvas: HTMLCanvasElement;
  } | null>(null);
  const base = Math.min(
      (size.w - 60) / task.width,
      (size.h - 60) / task.height,
    ),
    scale = base * zoom;
  const offset = {
    x: (size.w - task.width * scale) / 2 + pan.x,
    y: (size.h - task.height * scale) / 2 + pan.y,
  };
  const toPixel = (x: number, y: number) => [
    (x - offset.x) / scale,
    (y - offset.y) / scale,
  ];
  const overlayName = truth
    ? "truth-overlay.png"
    : reviewed
      ? "reviewed-overlay.png"
      : "overlay.png";
  const revision = reviewRevision(task.reviews || []);
  const overlayKey = `${overlayName}:${revision}`;
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPoints([]);
    images.current = {};
  }, [task.id]);
  useEffect(() => {
    if (!drawing) setPoints([]);
  }, [drawing]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((z) =>
        Math.min(8, Math.max(0.5, z * (event.deltaY > 0 ? 0.9 : 1.1))),
      );
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const [x, y, r, b] = selected.bbox;
    const cx = offset.x + ((x + r) * scale) / 2,
      cy = offset.y + ((y + b) * scale) / 2;
    if (cx < 20 || cx > size.w - 20 || cy < 20 || cy > size.h - 20)
      setPan({
        x: (task.width / 2 - (x + r) / 2) * scale,
        y: (task.height / 2 - (y + b) / 2) * scale,
      });
  }, [selected?.id]);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const paths: Record<string, string> = {
      before: file(task.id, "before.png"),
      after: file(task.id, "after.png"),
    };
    if (task.state === "completed")
      paths[overlayKey] = file(task.id, overlayName, revision);
    let active = true;
    for (const [key, url] of Object.entries(paths)) {
      if (images.current[key]) continue;
      const image = new Image();
      image.onload = () => {
        if (active) {
          if (key !== "before" && key !== "after")
            Object.keys(images.current)
              .filter((k) => k !== "before" && k !== "after")
              .forEach((k) => delete images.current[k]);
          images.current[key] = image;
          setLoaded((v) => v + 1);
        }
      };
      image.src = url;
    }
    return () => {
      active = false;
    };
  }, [task.id, task.state, overlayKey]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = size.w * ratio;
    c.height = size.h * ratio;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#12232f";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.strokeStyle = "rgba(115,154,176,.08)";
    for (let x = 0; x < size.w; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.h);
      ctx.stroke();
    }
    for (let y = 0; y < size.h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.w, y);
      ctx.stroke();
    }
    const draw = (key: string) => {
      const im = images.current[key];
      if (im)
        ctx.drawImage(
          im,
          offset.x,
          offset.y,
          task.width * scale,
          task.height * scale,
        );
    };
    draw(view === "before" ? "before" : "after");
    if (view === "compare") {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size.w * split, size.h);
      ctx.clip();
      draw("before");
      ctx.restore();
    }
    const overlay = images.current[overlayKey];
    if (overlay && view === "overlay") {
      const key = overlayKey + ":" + enabled.join(",");
      if (filteredOverlay.current?.key !== key) {
        const filtered = document.createElement("canvas");
        filtered.width = overlay.width;
        filtered.height = overlay.height;
        const fctx = filtered.getContext("2d")!;
        fctx.drawImage(overlay, 0, 0);
        const data = fctx.getImageData(0, 0, filtered.width, filtered.height);
        const allowed = new Set(
          enabled.map((id) => parseInt(classes[id - 1].color.slice(1), 16)),
        );
        for (let i = 0; i < data.data.length; i += 4) {
          const color =
            (data.data[i] << 16) | (data.data[i + 1] << 8) | data.data[i + 2];
          if (!allowed.has(color)) data.data[i + 3] = 0;
        }
        fctx.putImageData(data, 0, 0);
        filteredOverlay.current = { key, canvas: filtered };
      }
      ctx.globalAlpha = opacity;
      ctx.drawImage(
        filteredOverlay.current.canvas,
        offset.x,
        offset.y,
        task.width * scale,
        task.height * scale,
      );
      ctx.globalAlpha = 1;
    }
    if (selected) {
      const [x, y, right, bottom] = selected.bbox;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(
        offset.x + x * scale - 3,
        offset.y + y * scale - 3,
        (right - x) * scale + 6,
        (bottom - y) * scale + 6,
      );
      ctx.setLineDash([]);
    }
    if (points.length) {
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = offset.x + p[0] * scale,
          y = offset.y + p[1] * scale;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      points.forEach((p) => {
        ctx.beginPath();
        ctx.arc(
          offset.x + p[0] * scale,
          offset.y + p[1] * scale,
          4,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = "#28b9ad";
        ctx.fill();
      });
    }
  }, [
    size,
    zoom,
    pan,
    view,
    split,
    opacity,
    enabled,
    loaded,
    selected,
    overlayKey,
    points,
  ]);
  const finishPolygon = useCallback(() => {
    if (points.length >= 3) {
      onPolygon(points);
      setPoints([]);
    }
  }, [points, onPolygon]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      if (e.key === "Escape") setPoints([]);
      if (e.key === "Enter" && drawing) finishPolygon();
      if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      if (e.key === "+") setZoom((z) => Math.min(8, z * 1.2));
      if (e.key === "-") setZoom((z) => Math.max(0.5, z / 1.2));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [drawing, finishPolygon]);
  return (
    <div className={`viewport ${drawing ? "drawing" : ""}`} ref={container}>
      <canvas
        ref={canvas}
        aria-label="遥感影像分析视口"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left,
            y = e.clientY - r.top;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x,
            y,
            ox: pan.x,
            oy: pan.y,
            moved: false,
            divider: view === "compare" && Math.abs(x - size.w * split) < 24,
          };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left,
            y = e.clientY - r.top;
          const d = drag.current;
          if (Math.abs(x - d.x) + Math.abs(y - d.y) > 5) d.moved = true;
          if (d.divider) setSplit(Math.max(0.05, Math.min(0.95, x / size.w)));
          else if (!drawing) setPan({ x: d.ox + x - d.x, y: d.oy + y - d.y });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved) return;
          const r = e.currentTarget.getBoundingClientRect();
          const p = toPixel(e.clientX - r.left, e.clientY - r.top);
          if (p[0] < 0 || p[1] < 0 || p[0] >= task.width || p[1] >= task.height)
            return;
          if (drawing) setPoints((current) => [...current, p]);
          else onPick(Math.floor(p[0]), Math.floor(p[1]));
        }}
      />
      {view === "compare" && (
        <>
          <span className="viewport-label left">灾前影像</span>
          <span className="viewport-label right">灾后影像</span>
          <div className="compare-line" style={{ left: `${split * 100}%` }}>
            <span>
              <MoveHorizontal size={19} />
            </span>
          </div>
          <input
            className="sr-only"
            type="range"
            aria-label="影像对比分割线"
            min="5"
            max="95"
            value={split * 100}
            onChange={(e) => setSplit(+e.target.value / 100)}
          />
        </>
      )}
      <div className="viewport-coordinate">
        {task.geo ? task.geo.crs : "IMAGE COORDINATES"}
        <span>
          {task.width} × {task.height} PX
        </span>
      </div>
      <div className="viewport-controls">
        <button
          aria-label="放大"
          onClick={() => setZoom((z) => Math.min(8, z * 1.3))}
        >
          <ZoomIn size={18} />
        </button>
        <button
          aria-label="缩小"
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.3))}
        >
          <ZoomOut size={18} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="重置视图"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          <RotateCcw size={17} />
        </button>
        <button
          aria-label="全屏影像"
          onClick={() =>
            document.fullscreenElement
              ? document.exitFullscreen()
              : container.current?.requestFullscreen()
          }
        >
          <Maximize size={17} />
        </button>
      </div>
      {drawing && (
        <div className="polygon-hint">
          点击添加顶点 · Enter 完成 · Esc 取消
          <button disabled={points.length < 3} onClick={finishPolygon}>
            <Check size={13} />
            完成区域
          </button>
          <button onClick={() => setPoints((p) => p.slice(0, -1))}>
            <Undo2 size={13} />
          </button>
        </div>
      )}
      {["queued", "running"].includes(task.state) && (
        <div className="processing-card">
          <LoaderCircle className="spin" size={27} />
          <h3>{task.stage}</h3>
          <p>影像在本地处理，任务进度自动保存</p>
          <div className="progress-track">
            <i style={{ width: `${task.progress * 100}%` }} />
          </div>
          <span>{Math.round(task.progress * 100)}%</span>
        </div>
      )}
    </div>
  );
}

export default function Workbench({
  task,
  tasks,
  onSelect,
  onBack,
  onSave,
  onUndo,
  onRetry,
}: {
  task: Task | null;
  tasks: Task[];
  onSelect: (id: string) => void;
  onBack: () => void;
  onSave: (r: Review) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
  onRetry: (device: string) => void;
}) {
  const [view, setView] = useState<View>("compare"),
    [opacity, setOpacity] = useState(0.72),
    [enabled, setEnabled] = useState([1, 2, 3, 4]),
    [truth, setTruth] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [selectedId, setSelectedId] = useState<number | null>(null),
    [drawing, setDrawing] = useState(false),
    [filter, setFilter] = useState(0),
    [mobileLayers, setMobileLayers] = useState(false),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("复核"),
    [polygon, setPolygon] = useState<number[][] | null>(null),
    [polygonClass, setPolygonClass] = useState(4),
    [polygonNote, setPolygonNote] = useState("");
  useEffect(() => {
    setSelectedId(null);
    setView("compare");
    setDrawing(false);
    setPolygon(null);
  }, [task?.id]);
  if (!task)
    return (
      <div className="standard-page page-enter">
        <div className="page-heading">
          <div>
            <div className="eyebrow">IMAGE WORKSPACE</div>
            <h1>影像分析</h1>
            <p>选择一个案例，或上传你的成对遥感影像。</p>
          </div>
        </div>
        <div className="empty-state panel tall">
          <ScanLine size={48} />
          <h2>准备一次新的观测</h2>
          <p>灾前与灾后影像将在同一工作台中同步呈现。</p>
          <button className="primary" onClick={onBack}>
            选择公开案例
          </button>
        </div>
      </div>
    );
  const regions = task.stats?.regions || [],
    selected = regions.find((r) => r.id === selectedId) || null;
  const counts = task.stats?.class_counts || [0, 0, 0, 0],
    total = counts.reduce((a, b) => a + b, 0);
  const latest = new Map(
    task.reviews
      ?.filter((r) => r.kind === "region")
      .map((r) => [r.region_id, r]),
  );
  const confirmed = [...latest.values()].filter(
    (r) => r.status === "confirmed",
  ).length;
  const filtered = regions.filter(
    (r) =>
      (filter === 0 || r.class_id === filter) &&
      (query === "" || String(r.id).includes(query)),
  );
  const pick = async (x: number, y: number) => {
    if (task.state !== "completed") return;
    const found = await api.pick(task.id, x, y);
    setSelectedId(found.region_id || null);
    setTab("复核");
  };
  const views: [View, string][] = [
    ["compare", "滑动对比"],
    ["before", "灾前"],
    ["after", "灾后"],
    ["overlay", "损毁图层"],
  ];
  return (
    <div className="workbench page-enter">
      <header className="workspace-heading">
        <button
          className="icon-button"
          aria-label="返回观测台"
          onClick={onBack}
        >
          <ArrowLeft size={19} />
        </button>
        <div>
          <h1>{task.name}</h1>
          <p>
            {task.source} <span> / </span> {task.width} × {task.height}{" "}
            <span> / </span> <b>{states[task.state]}</b>
          </p>
        </div>
        <select
          aria-label="切换分析任务"
          value={task.id}
          onChange={(e) => onSelect(e.target.value)}
        >
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {task.state === "completed" && (
          <a
            className="primary"
            href={`/api/tasks/${task.id}/report`}
            target="_blank"
            rel="noreferrer"
          >
            <FileText size={15} />
            导出报告
          </a>
        )}
      </header>
      {task.error && (
        <div className="error-banner">
          <AlertTriangle size={18} />
          <span>{task.error}</span>
          <button onClick={() => onRetry("auto")}>重新分析</button>
          <button onClick={() => onRetry("cpu")}>改用 CPU</button>
        </div>
      )}
      <button
        className="mobile-layer-toggle secondary"
        onClick={() => setMobileLayers((v) => !v)}
      >
        <Layers3 size={15} />
        {mobileLayers ? "收起图层与区域" : "展开图层与候选区域"}
      </button>
      <div className={`workspace-main ${mobileLayers ? "show-layers" : ""}`}>
        <aside className="layers-panel">
          <div className="panel-label">
            <Layers3 size={15} />
            图层与区域
          </div>
          <div className="layer-section">
            <span className="small-heading">影像图层</span>
            <button
              className={`image-layer ${view === "before" ? "selected" : ""}`}
              onClick={() => setView("before")}
            >
              <img src={file(task.id, "before.png")} />
              <span>
                <strong>灾前影像</strong>
                <small>PRE-EVENT</small>
              </span>
              <i />
            </button>
            <button
              className={`image-layer ${view === "after" ? "selected" : ""}`}
              onClick={() => setView("after")}
            >
              <img src={file(task.id, "after.png")} />
              <span>
                <strong>灾后影像</strong>
                <small>POST-EVENT</small>
              </span>
              <i />
            </button>
          </div>
          <div className="layer-section">
            <div className="small-heading">
              损毁分类<span>图层显示</span>
            </div>
            {classes.map((c) => (
              <label key={c.id} className="class-toggle">
                <input
                  type="checkbox"
                  checked={enabled.includes(c.id)}
                  onChange={() => {
                    setEnabled((list) =>
                      list.includes(c.id)
                        ? list.filter((id) => id !== c.id)
                        : [...list, c.id],
                    );
                    setView("overlay");
                  }}
                />
                <i style={{ background: c.color }} />
                <span>{c.name}</span>
                <small>{format(counts[c.id - 1])}</small>
              </label>
            ))}
            <label className="opacity-control">
              图层透明度<span>{Math.round(opacity * 100)}%</span>
              <input
                aria-label="图层透明度"
                type="range"
                min="0"
                max="1"
                step=".01"
                value={opacity}
                onChange={(e) => {
                  setOpacity(+e.target.value);
                  setView("overlay");
                }}
              />
            </label>
            {task.has_truth && (
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={truth}
                  onChange={(e) => {
                    setTruth(e.target.checked);
                    setReviewed(false);
                    setView("overlay");
                  }}
                />
                人工标注真值<span className="tiny-badge">仅对照</span>
              </label>
            )}
            {!!task.reviews?.length && (
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => {
                    setReviewed(e.target.checked);
                    setTruth(false);
                    setView("overlay");
                  }}
                />
                人工复核图层
              </label>
            )}
          </div>
          <div className="candidate-heading">
            <span className="small-heading">
              候选建筑区域 <b>{regions.length}</b>
            </span>
            <select
              aria-label="按损伤类别筛选区域"
              value={filter}
              onChange={(e) => setFilter(+e.target.value)}
            >
              <option value={0}>全部等级</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="region-search">
              <Search size={13} />
              <input
                placeholder="查找区域编号"
                aria-label="查找区域编号"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="candidate-list">
            {filtered.slice(0, 150).map((r) => (
              <button
                key={r.id}
                className={`candidate ${r.id === selectedId ? "selected" : ""}`}
                onClick={() => {
                  setSelectedId(r.id);
                  setTab("复核");
                }}
              >
                <i style={{ background: classes[r.class_id - 1].color }} />
                <span>
                  <strong>区域 #{String(r.id).padStart(3, "0")}</strong>
                  <small>
                    {format(r.pixels)} px ·{" "}
                    {r.confidence === null ? "—" : percent(r.confidence)}
                  </small>
                </span>
                {latest.get(r.id)?.status === "confirmed" ? (
                  <Check size={14} />
                ) : (
                  <ChevronDown size={13} />
                )}
              </button>
            ))}
            {filtered.length > 150 && (
              <p className="empty-small">显示前150项，请筛选或点击影像选择。</p>
            )}
            {!regions.length && (
              <p className="empty-small">
                {task.state === "completed"
                  ? "未发现候选建筑区域"
                  : "分析完成后显示候选区域"}
              </p>
            )}
          </div>
        </aside>
        <section className="image-panel">
          <div className="image-toolbar">
            <div className="view-tabs">
              {views.map(([id, name]) => (
                <button
                  key={id}
                  className={view === id ? "active" : ""}
                  onClick={() => setView(id)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="tool-mode">
              <button
                className={!drawing ? "active" : ""}
                title="选择 / 平移"
                aria-label="选择区域工具"
                onClick={() => setDrawing(false)}
              >
                <MousePointer2 size={16} />
              </button>
              <button
                className={drawing ? "active" : ""}
                title="绘制复核多边形"
                aria-label="绘制复核多边形"
                disabled={task.state !== "completed"}
                onClick={() => setDrawing(true)}
              >
                <PenTool size={16} />
              </button>
            </div>
          </div>
          <Viewport
            task={task}
            view={view}
            opacity={opacity}
            enabled={enabled}
            truth={truth}
            reviewed={reviewed}
            selected={selected}
            drawing={drawing}
            onPick={pick}
            onPolygon={(p) => {
              setPolygon(p);
              setDrawing(false);
            }}
          />
          <div className="image-status">
            <span>
              <i />
              {task.state === "completed" ? "分析完成" : task.stage}
            </span>
            <span>
              {task.inference
                ? `${task.inference.device.toUpperCase()} · ${task.inference.seconds.toFixed(1)}s · ${task.inference.tiles} 块`
                : "本地任务队列"}
            </span>
          </div>
        </section>
        <aside className="results-panel">
          <div className="result-tabs">
            {["复核", "统计", "导出"].map((name) => (
              <button
                className={tab === name ? "active" : ""}
                onClick={() => setTab(name)}
                key={name}
              >
                {name}
              </button>
            ))}
          </div>
          {tab === "复核" ? (
            <>
              <div className="review-progress">
                <span>
                  人工复核进度
                  <strong>
                    {confirmed} / {regions.length}
                  </strong>
                </span>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${regions.length ? (confirmed / regions.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <ReviewPanel
                region={selected}
                taskId={task.id}
                reviews={task.reviews || []}
                onSave={(r) => void onSave(r)}
                onUndo={(id) => void onUndo(id)}
              />
              <div className="review-history">
                <span className="small-heading">最近复核记录</span>
                {task.reviews
                  ?.slice(-4)
                  .reverse()
                  .map((r) => (
                    <div key={r.id}>
                      <i
                        style={{
                          background:
                            classes[r.class_id - 1]?.color || "#8999a3",
                        }}
                      />
                      <span>
                        {r.kind === "polygon"
                          ? "绘制区域"
                          : `区域 #${r.region_id}`}
                        <small>
                          {r.status === "confirmed" ? "已确认" : "需复查"}
                          {r.note ? ` · ${r.note}` : ""}
                        </small>
                      </span>
                      <button
                        aria-label="撤销这条复核"
                        className="icon-button"
                        onClick={() => r.id && onUndo(r.id)}
                      >
                        <Undo2 size={13} />
                      </button>
                    </div>
                  ))}
              </div>
            </>
          ) : tab === "统计" ? (
            <div className="statistics-panel">
              <span className="small-heading">模型原始统计</span>
              <strong className="large-stat">
                {format(regions.length)}
                <small>候选区域</small>
              </strong>
              <div className="damage-bar">
                {classes.map((c, i) => (
                  <i
                    key={c.id}
                    style={{
                      background: c.color,
                      width: `${total ? (counts[i] / total) * 100 : 0}%`,
                    }}
                  />
                ))}
              </div>
              {classes.map((c, i) => (
                <div className="stat-row" key={c.id}>
                  <span>
                    <i style={{ background: c.color }} />
                    {c.name}
                  </span>
                  <strong>{total ? percent(counts[i] / total) : "—"}</strong>
                  <small>{format(counts[i])} px</small>
                </div>
              ))}
              <dl className="details-list">
                <div>
                  <dt>建筑像素量</dt>
                  <dd>{format(total)} px</dd>
                </div>
                <div>
                  <dt>损伤像素量</dt>
                  <dd>{format(task.stats?.damaged_pixels || 0)} px</dd>
                </div>
                <div>
                  <dt>建筑面积</dt>
                  <dd>
                    {task.stats?.area_m2
                      ? `${format(Math.round(task.stats.area_m2))} m²`
                      : "无地理信息"}
                  </dd>
                </div>
                <div>
                  <dt>峰值显存</dt>
                  <dd>
                    {task.inference?.peak_vram_mb
                      ? `${task.inference.peak_vram_mb} MB`
                      : "—"}
                  </dd>
                </div>
              </dl>
              <p className="small-notice">
                比例以模型定位的建筑像素为分母。连通区域不是精确建筑实例。
              </p>
              {task.review_stats && (
                <div className="review-summary">
                  <h3>人工复核后</h3>
                  <p>建筑像素 {format(task.review_stats.building_pixels)} px</p>
                  <p>损伤像素 {format(task.review_stats.damaged_pixels)} px</p>
                </div>
              )}
            </div>
          ) : (
            <div className="exports-panel">
              <h3>结果与分析证据</h3>
              <p>下载模型原始输出、复核图层和运行记录。</p>
              {[
                ["mask.png", "模型原始分类 mask"],
                ["overlay.png", "模型原始叠加图"],
                ["reviewed-mask.png", "人工复核分类 mask"],
                ["reviewed-overlay.png", "人工复核叠加图"],
                ["regions.csv", "候选区域与复核 CSV"],
                ["metadata.json", "完整运行记录 JSON"],
                [
                  "regions.geojson",
                  task.geo ? "地理参考区域 GeoJSON" : "像素坐标区域 JSON",
                ],
                ...(task.geo ? [["result.tif", "地理参考分类 GeoTIFF"]] : []),
              ].map(([name, label]) => (
                <a
                  key={name}
                  className={`export-link ${task.state !== "completed" ? "disabled" : ""}`}
                  href={file(task.id, name)}
                  download
                >
                  <Download size={15} />
                  <span>{label}</span>
                  <ArrowLeft size={13} />
                </a>
              ))}
            </div>
          )}
        </aside>
      </div>
      {polygon && (
        <div className="modal-backdrop">
          <div
            className="modal small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="polygon-title"
          >
            <h2 id="polygon-title">保存人工绘制区域</h2>
            <p>已绘制 {polygon.length} 个顶点。修正保存在独立复核图层。</p>
            <label className="field-label">
              修正类别
              <select
                value={polygonClass}
                onChange={(e) => setPolygonClass(+e.target.value)}
              >
                <option value={0}>背景 / 剔除</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              判断依据
              <textarea
                value={polygonNote}
                onChange={(e) => setPolygonNote(e.target.value)}
                maxLength={1000}
              />
            </label>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setPolygon(null)}>
                取消
              </button>
              <button
                className="primary"
                onClick={async () => {
                  await onSave({
                    kind: "polygon",
                    points: polygon,
                    class_id: polygonClass,
                    status: "confirmed",
                    note: polygonNote,
                  });
                  setPolygon(null);
                  setReviewed(true);
                  setView("overlay");
                }}
              >
                保存复核区域
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
