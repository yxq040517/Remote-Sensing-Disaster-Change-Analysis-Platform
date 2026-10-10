import { useCallback, useEffect, useRef, useState } from "react";
import {
  Satellite,
  LayoutDashboard,
  ScanLine,
  ChartNoAxesCombined,
  Files,
  ArrowUpRight,
  HelpCircle,
  Bell,
  ChevronRight,
  Upload,
  Plus,
  X,
  LoaderCircle,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Menu,
} from "lucide-react";
import Overview from "./Overview";
import Workbench from "./Workbench";
import { EvaluationPage, ReportsPage } from "./Panels";
import { api } from "./api";
import type { Case, Task, Status, Review } from "./types";

function ImportDialog({
  onClose,
  onUpload,
}: {
  onClose: () => void;
  onUpload: (form: FormData) => Promise<void>;
}) {
  const [before, setBefore] = useState<File | null>(null),
    [after, setAfter] = useState<File | null>(null),
    [aligned, setAligned] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [device, setDevice] = useState("auto");
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = [before, after].map((f) =>
      f && !/\.tiff?$/i.test(f.name) ? URL.createObjectURL(f) : "",
    );
    setPreviews(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [before, after]);
  const assign = (f: File | undefined, set: (f: File) => void) => {
    if (!f) return;
    if (f.size > 100 * 1024 * 1024) {
      setError("单文件不能超过100MB");
      return;
    }
    if (!/\.(png|jpe?g|tiff?)$/i.test(f.name)) {
      setError("请选择PNG、JPEG或GeoTIFF影像");
      return;
    }
    setError("");
    set(f);
  };
  const submit = async () => {
    if (!before || !after || !aligned) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("before", before);
    form.set("after", after);
    form.set("aligned", "true");
    form.set("device", device);
    form.set("name", name.trim() || "自定义影像分析");
    try {
      await onUpload(form);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <button
          className="modal-close icon-button"
          aria-label="关闭导入"
          onClick={onClose}
          disabled={busy}
        >
          <X size={20} />
        </button>
        <span className="eyebrow">NEW OBSERVATION</span>
        <h2 id="import-title">开始一次新的观测</h2>
        <p>上传同一区域的灾前与灾后影像，在本地分析建筑损毁。</p>
        <label className="field-label">
          任务名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="例如：某区域灾后建筑评估"
          />
        </label>
        <div className="upload-grid">
          {[
            {
              title: "灾前影像",
              subtitle: "PRE-EVENT",
              value: before,
              set: setBefore,
            },
            {
              title: "灾后影像",
              subtitle: "POST-EVENT",
              value: after,
              set: setAfter,
            },
          ].map((item, i) => (
            <label
              key={i}
              className={`dropzone ${item.value ? "has-file" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                assign(e.dataTransfer.files[0], item.set);
              }}
            >
              <input
                aria-label={item.title}
                type="file"
                accept=".png,.jpg,.jpeg,.tif,.tiff"
                onChange={(e) => assign(e.target.files?.[0], item.set)}
              />
              {previews[i] ? <img src={previews[i]} /> : <Upload size={28} />}
              <strong>{item.title}</strong>
              <span>
                {item.value ? item.value.name : "拖入文件，或点击选择"}
              </span>
              <small>
                {item.value
                  ? `${(item.value.size / 1024 ** 2).toFixed(1)} MB`
                  : item.subtitle}
              </small>
            </label>
          ))}
        </div>
        <div className="upload-rules">
          <ShieldCheck size={16} />
          <span>
            PNG / JPEG / 8位 RGB GeoTIFF · 单文件 ≤ 100MB · 同一像素网格
          </span>
        </div>
        <label className="alignment-check">
          <input
            type="checkbox"
            checked={aligned}
            onChange={(e) => setAligned(e.target.checked)}
          />
          <span>我确认两幅影像覆盖同一区域，并已完成空间对齐。</span>
        </label>
        <label className="device-select">
          运行设备
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="auto">自动选择 · 优先 GPU</option>
            <option value="cuda">NVIDIA GPU</option>
            <option value="cpu">CPU · 较慢</option>
          </select>
        </label>
        {error && (
          <div className="form-error">
            <AlertTriangle size={15} />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="primary"
            disabled={!before || !after || !aligned || busy}
            onClick={submit}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ScanLine size={16} />
            )}
            创建并开始分析
          </button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState(() => {
      const p = Number(localStorage.getItem("starwatch-page"));
      return [0, 1, 2, 3].includes(p) ? p : 0;
    }),
    [cases, setCases] = useState<Case[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [status, setStatus] = useState<Status | null>(null),
    [activeId, setActiveId] = useState(
      () => localStorage.getItem("starwatch-active") || "",
    ),
    [active, setActive] = useState<Task | null>(null),
    [importing, setImporting] = useState(false),
    [help, setHelp] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [menu, setMenu] = useState(false),
    [connected, setConnected] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => localStorage.setItem("starwatch-page", String(page)), [page]);
  const notify = (message: string) => {
    setToast(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setToast(""), 3500);
  };
  const refresh = useCallback(async () => {
    try {
      const [s, c, t] = await Promise.all([
        api.status(),
        api.cases(),
        api.tasks(),
      ]);
      setStatus(s);
      setCases(c);
      setTasks(t);
      setConnected(true);
      setError((current) =>
        ["Failed to fetch", "服务暂时不可用"].includes(current) ? "" : current,
      );
    } catch (e) {
      setConnected(false);
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    localStorage.setItem("starwatch-active", activeId);
    let canceled = false;
    const load = () =>
      api
        .task(activeId)
        .then((t) => {
          if (!canceled) setActive(t);
        })
        .catch((e) => {
          if (!canceled) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [activeId]);
  useEffect(() => {
    if (!activeId || !active || !["queued", "running"].includes(active.state))
      return;
    const events = new EventSource(`/api/tasks/${activeId}/events`);
    events.onmessage = (event) => {
      const update = JSON.parse(event.data);
      setActive((old) => (old ? { ...old, ...update } : old));
      if (["completed", "failed", "interrupted"].includes(update.state)) {
        events.close();
        void api.task(activeId).then(setActive);
        void refresh();
      }
    };
    return () => events.close();
  }, [activeId, active?.state, refresh]);
  const open = (task: Task) => {
    setActiveId(task.id);
    setActive(task);
    setPage(1);
  };
  const analyze = async (sample: Case) => {
    try {
      const existing = tasks.find(
        (t) => t.case_id === sample.id && t.state === "completed",
      );
      if (existing) {
        open(existing);
        return;
      }
      const task = await api.analyze(sample.id);
      open(task);
      void refresh();
      notify("任务已创建，正在本地队列中分析");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const upload = async (form: FormData) => {
    const task = await api.upload(form);
    setImporting(false);
    open(task);
    void refresh();
    notify("影像已校验，分析任务已创建");
  };
  const save = async (review: Review) => {
    if (!activeId) return;
    try {
      await api.save(activeId, review);
      setActive(await api.task(activeId));
      notify("复核已保存，原始模型结果保留不变");
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };
  const undo = async (id: string) => {
    if (!activeId) return;
    try {
      await api.undo(activeId, id);
      setActive(await api.task(activeId));
      notify("已撤销这条复核");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const retry = async (device: string) => {
    try {
      setActive(await api.retry(activeId, device));
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const nav = [
    { name: "灾害观测台", english: "OBSERVATORY", icon: LayoutDashboard },
    { name: "影像分析", english: "WORKSPACE", icon: ScanLine },
    { name: "评估与模型", english: "EVIDENCE", icon: ChartNoAxesCombined },
    { name: "报告与记录", english: "ARCHIVE", icon: Files },
  ];
  return (
    <div className={`app ${menu ? "menu-open" : ""}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage(0);
          }}
        >
          <span className="brand-symbol">
            <Satellite size={27} />
          </span>
          <span>
            <strong>
              星察<span>STARWATCH</span>
            </strong>
            <small>遥感灾害变化分析平台</small>
          </span>
        </a>
        <div className="nav-label">分析工作台</div>
        <nav>
          {nav.map(({ name, english, icon: Icon }, i) => (
            <button
              key={name}
              className={page === i ? "active" : ""}
              onClick={() => {
                setPage(i);
                setMenu(false);
              }}
            >
              <Icon size={20} />
              <span>
                {name}
                <small>{english}</small>
              </span>
              {page === i && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span>
              <i /> 本地分析环境
            </span>
            <strong>
              {status?.model.loaded
                ? status.model.device?.toUpperCase()
                : "RTX 3050 · 4GB"}
            </strong>
            <p>
              {status?.model.loaded
                ? "模型已加载，准备观测"
                : status?.model.downloaded
                  ? "权重已准备，按需加载"
                  : "等待模型准备"}
            </p>
          </div>
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <HelpCircle size={17} />
            使用指南
            <ArrowUpRight size={15} />
          </button>
          <div className="version">
            STARWATCH <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="打开导航"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            工作台
            <ChevronRight size={13} />
            <strong>{nav[page].name}</strong>
          </div>
          <div className="topbar-right">
            <span className={`connection ${connected ? "online" : ""}`}>
              <i />
              {connected ? "本地服务已连接" : "连接本地服务中"}
            </span>
            <button
              className="icon-button"
              aria-label="任务通知"
              onClick={() => {
                setPage(3);
                notify(
                  tasks.some((t) => t.state === "running")
                    ? "有分析任务正在处理"
                    : "分析记录已显示",
                );
              }}
            >
              <Bell size={18} />
              {tasks.some((t) => ["running", "queued"].includes(t.state)) && (
                <i className="notification-dot" />
              )}
            </button>
            <div className="avatar">研</div>
            <span className="researcher">研究工作空间</span>
          </div>
        </header>
        {error && (
          <div className="global-error">
            <AlertTriangle size={17} />
            <span>{error}</span>
            <button
              onClick={() => {
                setError("");
                void refresh();
              }}
            >
              重试连接
            </button>
            <button aria-label="关闭提示" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        <main>
          {page === 0 ? (
            <Overview
              cases={cases}
              tasks={tasks}
              status={status}
              onAnalyze={(c) => void analyze(c)}
              onOpen={open}
              onUpload={() => setImporting(true)}
            />
          ) : page === 1 ? (
            <Workbench
              task={active}
              tasks={tasks}
              onSelect={(id) => setActiveId(id)}
              onBack={() => setPage(0)}
              onSave={save}
              onUndo={undo}
              onRetry={(d) => void retry(d)}
            />
          ) : page === 2 ? (
            <EvaluationPage status={status} />
          ) : (
            <ReportsPage tasks={tasks} onOpen={open} />
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {importing && (
        <ImportDialog onClose={() => setImporting(false)} onUpload={upload} />
      )}
      {help && (
        <div className="modal-backdrop">
          <div
            className="modal small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭使用指南"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">FIELD GUIDE</span>
            <h2 id="help-title">观测、分析与复核</h2>
            <ol className="guide">
              <li>
                <strong>选择影像</strong>
                <p>使用公开案例，或上传已对齐的8位RGB影像对。</p>
              </li>
              <li>
                <strong>查看模型结果</strong>
                <p>滑动比较前后影像，用损毁图层查看模型定位与分类。</p>
              </li>
              <li>
                <strong>人工复核</strong>
                <p>
                  点击候选建筑，确认、改判或标记需复查。绘制多边形可修正区域。
                </p>
              </li>
              <li>
                <strong>导出证据</strong>
                <p>报告、mask、CSV和运行记录分别导出，原始模型结果保持不变。</p>
              </li>
            </ol>
            <div className="shortcut-list">
              <span>
                <kbd>滚轮</kbd>缩放
              </span>
              <span>
                <kbd>拖动</kbd>平移
              </span>
              <span>
                <kbd>0</kbd>重置
              </span>
              <span>
                <kbd>Enter</kbd>完成多边形
              </span>
              <span>
                <kbd>Esc</kbd>取消绘制
              </span>
            </div>
            <button className="primary full" onClick={() => setHelp(false)}>
              开始观测
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
