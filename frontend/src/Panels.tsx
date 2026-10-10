import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Flag,
  Undo2,
  Download,
  FileText,
  ShieldCheck,
  Database,
  ExternalLink,
  Activity,
  ArrowUpRight,
  Search,
  Info,
} from "lucide-react";
import type { Region, Review, Status, Task } from "./types";
import { classes, format, percent } from "./types";
import { api, file, caseFile } from "./api";

function Crop({ url, bbox }: { url: string; bbox: number[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      const [x, y, right, bottom] = bbox;
      const margin = Math.max(8, (right - x) * 0.2);
      const sx = Math.max(0, x - margin),
        sy = Math.max(0, y - margin);
      const sw = Math.min(image.width - sx, right - x + margin * 2),
        sh = Math.min(image.height - sy, bottom - y + margin * 2);
      ctx.clearRect(0, 0, 160, 110);
      const scale = Math.min(160 / sw, 110 / sh);
      ctx.drawImage(
        image,
        sx,
        sy,
        sw,
        sh,
        (160 - sw * scale) / 2,
        (110 - sh * scale) / 2,
        sw * scale,
        sh * scale,
      );
    };
    image.src = url;
    return () => {
      image.onload = null;
    };
  }, [url, bbox]);
  return <canvas ref={canvas} width={160} height={110} />;
}

export function ReviewPanel({
  region,
  reviews,
  onSave,
  onUndo,
  taskId,
}: {
  region: Region | null;
  reviews: Review[];
  onSave: (r: Review) => void;
  onUndo: (id: string) => void;
  taskId: string;
}) {
  const [category, setCategory] = useState(1),
    [note, setNote] = useState("");
  const matching = reviews.filter(
      (r) => r.kind === "region" && r.region_id === region?.id,
    ),
    latest = matching.at(-1);
  useEffect(() => {
    setCategory(latest?.class_id ?? region?.class_id ?? 1);
    setNote(latest?.note ?? "");
  }, [region?.id, latest?.id]);
  if (!region)
    return (
      <div className="review-empty">
        <Search size={30} />
        <h3>选择一个候选区域</h3>
        <p>点击影像中的建筑，或从候选列表选择，查看前后对比并进行复核。</p>
      </div>
    );
  const save = (status: "confirmed" | "needs_review") =>
    onSave({
      kind: "region",
      region_id: region.id,
      class_id: category,
      status,
      note,
    });
  return (
    <section className="review-panel">
      <div className="region-heading">
        <span>候选区域 #{region.id.toString().padStart(3, "0")}</span>
        <span className={`review-badge ${latest?.status || ""}`}>
          {latest?.status === "confirmed"
            ? "已复核"
            : latest?.status === "needs_review"
              ? "需复查"
              : "待复核"}
        </span>
      </div>
      <div className="crop-grid">
        <figure>
          <Crop url={file(taskId, "before.png")} bbox={region.bbox} />
          <figcaption>灾前</figcaption>
        </figure>
        <figure>
          <Crop url={file(taskId, "after.png")} bbox={region.bbox} />
          <figcaption>灾后</figcaption>
        </figure>
      </div>
      <div className="region-facts">
        <span>
          模型原始判断
          <strong style={{ color: classes[region.class_id - 1]?.color }}>
            {classes[region.class_id - 1]?.name}
          </strong>
        </span>
        <span>
          平均模型分数
          <strong>
            {region.confidence === null ? "—" : percent(region.confidence)}
          </strong>
        </span>
        <span>
          候选区域像素<strong>{format(region.pixels)}</strong>
        </span>
      </div>
      <div className="small-notice">
        <Info size={13} />
        模型分数未经概率校准，轻度损伤请重点复核。
      </div>
      <label className="field-label">
        人工复核类别
        <select
          aria-label="人工复核类别"
          value={category}
          onChange={(e) => setCategory(+e.target.value)}
        >
          <option value={0}>非建筑 / 剔除区域</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        复核备注
        <textarea
          aria-label="复核备注"
          placeholder="记录你的判断依据，例如屋顶结构、阴影或影像质量…"
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button className="primary full" onClick={() => save("confirmed")}>
        <CheckCircle2 size={16} />
        确认并保存
      </button>
      <div className="review-buttons">
        <button className="secondary" onClick={() => save("needs_review")}>
          <Flag size={14} />
          标记需复查
        </button>
        {latest?.id && (
          <button className="text-button" onClick={() => onUndo(latest.id!)}>
            <Undo2 size={14} />
            撤销
          </button>
        )}
      </div>
    </section>
  );
}

export function EvaluationPage({ status }: { status: Status | null }) {
  const metrics = status?.model.source_metrics,
    evaluation = status?.evaluation;
  const [starting, setStarting] = useState(false),
    [error, setError] = useState("");
  const start = async () => {
    setStarting(true);
    setError("");
    try {
      await api.evaluate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="page-enter standard-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MODEL & EVIDENCE</div>
          <h1>评估与模型</h1>
          <p>让模型能力、验证方法与实际结果清晰可见。</p>
        </div>
        <span className="outlined-badge">
          <ShieldCheck size={15} />
          公开权重 · 无需训练
        </span>
      </div>
      <section className="model-banner">
        <div className="large-model-icon">
          <Activity size={35} />
        </div>
        <div>
          <span className="eyebrow">BUILDING DAMAGE ASSESSMENT</span>
          <h2>
            ChangeOS <span>Swin-T</span>
          </h2>
          <p>灾前 / 灾后 RGB 影像 · 建筑定位与四级损毁分类</p>
        </div>
        <span
          className={`model-ready ${status?.model.downloaded ? "yes" : ""}`}
        >
          <i />
          {status?.model.loaded
            ? "模型已加载"
            : status?.model.downloaded
              ? "任务权重就绪"
              : "等待模型准备"}
        </span>
      </section>
      <div className="evaluation-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>来源模型卡指标</h2>
            <span className="soft-badge">官方报告值</span>
          </div>
          <p className="panel-subtitle">
            xView2 / hold 留出集。下列数字尚不能视为本机复测结果。
          </p>
          <div className="score-row">
            {metrics &&
              [
                ["综合 F1", metrics.overall_f1],
                ["建筑定位 F1", metrics.localization_f1],
                ["损毁 F1", metrics.damage_f1],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <strong>{percent(Number(value))}</strong>
                  <span>{label}</span>
                </div>
              ))}
          </div>
          <div className="class-score-list">
            {classes.map((c, i) => (
              <div key={c.id}>
                <span>
                  <i style={{ background: c.color }} />
                  {c.name}
                </span>
                <div className="bar">
                  <i
                    style={{
                      width: `${(metrics?.class_f1[i] || 0) * 100}%`,
                      background: c.color,
                    }}
                  />
                </div>
                <strong>{metrics ? percent(metrics.class_f1[i]) : "—"}</strong>
              </div>
            ))}
          </div>
          <div className="notice">
            <Info size={17} />
            <p>
              轻度损伤 F1
              低于其他类别。工作台提供人工复核与需复查标记，保留原始预测用于核验。
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>本机真实复测</h2>
            <span className="soft-badge">
              {evaluation?.state === "completed"
                ? "已完成"
                : evaluation
                  ? "进行中"
                  : "等待评估"}
            </span>
          </div>
          {evaluation ? (
            <>
              <div className="score-row">
                <div>
                  <strong>{percent(evaluation.overall_f1)}</strong>
                  <span>已评估样本综合 F1</span>
                </div>
                <div>
                  <strong>
                    {evaluation.samples}
                    <small> / {evaluation.total}</small>
                  </strong>
                  <span>固定样本清单</span>
                </div>
              </div>
              <div className="class-score-list">
                {classes.map((c, i) => (
                  <div key={c.id}>
                    <span>
                      <i style={{ background: c.color }} />
                      {c.name}
                    </span>
                    <div className="bar">
                      <i
                        style={{
                          width: `${evaluation.class_f1[i] * 100}%`,
                          background: c.color,
                        }}
                      />
                    </div>
                    <strong>{percent(evaluation.class_f1[i])}</strong>
                  </div>
                ))}
              </div>
              <dl className="details-list">
                <div>
                  <dt>平均推理耗时</dt>
                  <dd>{evaluation.mean_seconds.toFixed(2)} 秒 / 对</dd>
                </div>
                <div>
                  <dt>评估方式</dt>
                  <dd>{evaluation.protocol}</dd>
                </div>
                <div>
                  <dt>清单 SHA-256</dt>
                  <dd className="mono">
                    {evaluation.manifest_sha256?.slice(0, 24)}…
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="evaluation-empty">
              <Database size={38} />
              <h3>真实评估尚未完成</h3>
              <p>
                评估使用固定抽样的 hold
                影像与人工标注。未运行的结果不会用来源指标填充。
              </p>
            </div>
          )}
        </section>
      </div>
      <div className="evaluation-actions">
        <button
          className="primary"
          onClick={start}
          disabled={
            starting ||
            evaluation?.state === "running" ||
            !status?.model.downloaded
          }
        >
          {starting
            ? "正在启动"
            : evaluation?.state === "running"
              ? `正在评估 ${evaluation.samples}/${evaluation.total}`
              : "启动 / 继续固定清单评估"}
        </button>
        <span className="subtle">
          使用本地hold数据，不进行模型训练。已完成样本在相同权重和流程下可断点恢复。
        </span>
        {error && <span className="form-error">{error}</span>}
      </div>
      {!!evaluation?.failure_examples?.length && (
        <section className="panel weak-samples">
          <div className="section-heading">
            <div>
              <h2>需要关注的薄弱样本</h2>
              <p>
                按样本中有标注类别的平均 F1
                排序，用于误差排查；该诊断分数与整体综合 F1 不同。
              </p>
            </div>
          </div>
          <div className="weak-grid">
            {evaluation.failure_examples.map((sample) => (
              <figure key={sample.id}>
                <img src={caseFile(sample.id)} />
                <figcaption>
                  <strong>{sample.id}</strong>
                  <span>{sample.event}</span>
                  <small>
                    有标注类别平均 F1：
                    {sample.metrics.present_class_mean_f1 === null
                      ? "无标注"
                      : percent(sample.metrics.present_class_mean_f1)}
                  </small>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      <section className="panel provenance">
        <h2>可追溯的分析链路</h2>
        <div className="pipeline">
          {[
            "原始影像与标注",
            "固定样本清单",
            "现成权重推理",
            "指标与失败案例",
            "人工复核与报告",
          ].map((s, i) => (
            <div key={s}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <strong>{s}</strong>
            </div>
          ))}
        </div>
        <dl className="details-list">
          <div>
            <dt>代码与模型</dt>
            <dd>
              <a
                href="https://github.com/Z-Zheng/pytorch-change-models"
                target="_blank"
                rel="noreferrer"
              >
                torchange / ChangeOS <ExternalLink size={13} />
              </a>
            </dd>
          </div>
          <div>
            <dt>模型卡</dt>
            <dd>
              <a
                href="https://huggingface.co/EVER-Z/torchange_example_changeos_swint_on_xview2_best42k"
                target="_blank"
                rel="noreferrer"
              >
                公开任务权重与评估协议 <ExternalLink size={13} />
              </a>
            </dd>
          </div>
          <div>
            <dt>数据来源</dt>
            <dd>xView2 / xBD；公开数据使用权以原始发布条款为准</dd>
          </div>
          <div>
            <dt>地理精度</dt>
            <dd>
              无地理参考的影像仅报告像素统计，不生成虚构位置和平方米面积。
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export function ReportsPage({
  tasks,
  onOpen,
}: {
  tasks: Task[];
  onOpen: (t: Task) => void;
}) {
  const ready = tasks.filter((t) => t.state === "completed"),
    [query, setQuery] = useState("");
  return (
    <div className="standard-page page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ANALYSIS ARCHIVE</div>
          <h1>报告与记录</h1>
          <p>从观测结果到复核依据，完整保存每次分析。</p>
        </div>
        <span className="outlined-badge">
          <FileText size={15} />
          {ready.length} 份可导出报告
        </span>
      </div>
      <div className="panel">
        <div className="section-heading">
          <h2>分析档案</h2>
          <label className="search">
            <Search size={16} />
            <input
              placeholder="搜索任务"
              aria-label="搜索报告"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="report-table">
          <div className="report-table-head">
            <span>任务与影像</span>
            <span>候选区域</span>
            <span>推理耗时</span>
            <span>报告与数据</span>
          </div>
          {ready
            .filter((t) => t.name.includes(query))
            .map((t) => (
              <div className="report-table-row" key={t.id}>
                <button className="report-task" onClick={() => onOpen(t)}>
                  <img src={file(t.id, "composite.png")} />
                  <span>
                    <strong>{t.name}</strong>
                    <small>
                      {new Date(t.created_at).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
                <span>{format(t.stats?.candidate_count || 0)}</span>
                <span>{t.inference?.seconds.toFixed(1)}s</span>
                <div className="report-actions">
                  <a
                    className="secondary"
                    href={`/api/tasks/${t.id}/report`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText size={14} />
                    报告
                  </a>
                  <a
                    className="icon-button"
                    aria-label={`下载${t.name}元数据`}
                    href={file(t.id, "metadata.json")}
                    download
                  >
                    <Download size={16} />
                  </a>
                </div>
              </div>
            ))}
          {!ready.length && (
            <div className="empty-state">
              <FileText size={38} />
              <h3>还没有完成的分析</h3>
              <p>完成一次分析后，在这里查看和导出报告。</p>
            </div>
          )}
        </div>
      </div>
      <div className="export-info">
        <ShieldCheck size={24} />
        <div>
          <h3>完整记录，清晰区分</h3>
          <p>
            导出包含原始模型结果、运行参数、影像来源与复核历史。修改后的图层单独保存，原始预测始终保留。
          </p>
        </div>
      </div>
    </div>
  );
}
