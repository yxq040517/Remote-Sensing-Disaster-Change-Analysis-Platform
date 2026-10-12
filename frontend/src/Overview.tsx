import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Layers3,
  ScanLine,
  Activity,
  Clock3,
  Search,
  FolderOpen,
  Satellite,
  MoveHorizontal,
  CheckCircle2,
} from "lucide-react";
import type { Case, Task, Status } from "./types";
import { format, states } from "./types";
import { caseFile, file } from "./api";

export default function Overview({
  cases,
  tasks,
  status,
  onAnalyze,
  onOpen,
  onUpload,
}: {
  cases: Case[];
  tasks: Task[];
  status: Status | null;
  onAnalyze: (c: Case) => void;
  onOpen: (t: Task) => void;
  onUpload: () => void;
}) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState("全部"),
    [page, setPage] = useState(0);
  const [compare, setCompare] = useState(48);
  const completed = tasks.filter((t) => t.state === "completed"),
    busy = tasks.filter((t) => ["running", "queued"].includes(t.state));
  const types = ["全部", ...new Set(cases.map((c) => c.type))];
  const filtered = useMemo(
    () =>
      cases.filter(
        (c) =>
          (kind === "全部" || c.type === kind) &&
          `${c.name} ${c.event}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [cases, kind, query],
  );
  const hero = cases[0],
    latest = completed[0];
  const recentMap = new Map(
    tasks.filter((t) => t.case_id).map((t) => [t.case_id, t]),
  );
  const metrics = [
    {
      label: "公开观测样本",
      value: cases.length,
      unit: "组",
      icon: Layers3,
      foot: "灾前 / 灾后成对影像",
    },
    {
      label: "已完成分析",
      value: completed.length,
      unit: "次",
      icon: ScanLine,
      foot: "真实模型推理记录",
    },
    {
      label: "候选建筑区域",
      value: completed.reduce((n, t) => n + (t.stats?.candidate_count || 0), 0),
      unit: "处",
      icon: Activity,
      foot: "来自已完成任务的连通区域",
    },
    {
      label: "当前分析队列",
      value: busy.length,
      unit: "项",
      icon: Clock3,
      foot: busy.length ? "任务在本地依次处理" : "准备好迎接下一次观测",
    },
  ];
  return (
    <div className="overview page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DISASTER OBSERVATORY</div>
          <h1>
            灾害观测台
            <span className="heading-dot" />
          </h1>
          <p>从灾前到灾后，让变化有迹可循。</p>
        </div>
        <button className="primary" onClick={onUpload}>
          <FolderOpen size={17} />
          新建分析任务
        </button>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            <Satellite size={15} /> 从轨道视角，理解地面变化
          </span>
          <h2>
            每一处变化，
            <br />
            都值得被看见。
          </h2>
          <p>
            成对遥感影像与建筑损毁分析，
            <br />
            连接观测、判断和人工复核。
          </p>
          <button
            className="hero-button"
            onClick={() => (hero ? onAnalyze(hero) : onUpload())}
          >
            开启一次观测
            <ArrowRight size={17} />
          </button>
          <div className="hero-bottom">
            <span>
              <i /> 本地推理
            </span>
            <span>公开数据 · 结果可追溯</span>
          </div>
        </div>
        <div className="hero-image">
          {hero ? (
            <>
              <img src={caseFile(hero.id)} />
              <div
                className="hero-before"
                style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}
              >
                <img src={caseFile(hero.id, "before")} />
              </div>
              <div className="hero-divider" style={{ left: `${compare}%` }}>
                <MoveHorizontal size={16} />
              </div>
              <input
                aria-label="首页灾前灾后对比"
                className="hero-range"
                type="range"
                min="5"
                max="95"
                value={compare}
                onChange={(e) => setCompare(+e.target.value)}
              />
              <span className="image-chip before">灾前</span>
              <span className="image-chip after">灾后</span>
              <div className="hero-caption">
                <span className="live-label">
                  <i /> PUBLIC OBSERVATION
                </span>
                <strong>{hero.event_name}</strong>
                <span>
                  xBD 留出样本 / {hero.width} × {hero.height}
                </span>
              </div>
            </>
          ) : (
            <div className="hero-empty">
              <Satellite size={54} />
              <p>等待公开影像准备完成</p>
            </div>
          )}
        </div>
      </section>
      <div className="metric-grid">
        {metrics.map(({ label, value, unit, icon: Icon, foot }) => (
          <section className="metric-card" key={label}>
            <div className="metric-label">
              {label}
              <Icon size={17} />
            </div>
            <strong>
              {format(value)}
              <small>{unit}</small>
            </strong>
            <p>{foot}</p>
          </section>
        ))}
      </div>
      <section className="case-section">
        <div className="section-heading">
          <div>
            <h2>
              公开灾害案例<span className="count-pill">{cases.length}</span>
            </h2>
            <p>使用真实遥感影像，探索不同灾害事件的建筑变化。</p>
          </div>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="搜索灾害案例"
              placeholder="搜索事件或区域"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <div className="filter-row">
          {types.map((type) => (
            <button
              key={type}
              className={type === kind ? "filter active" : "filter"}
              onClick={() => {
                setKind(type);
                setPage(0);
              }}
            >
              {type}
            </button>
          ))}
          <span className="source-tag">xBD / hold 数据</span>
        </div>
        <div className="case-grid">
          {filtered.slice(page * 6, page * 6 + 6).map((c) => {
            const existing = recentMap.get(c.id);
            return (
              <button
                className="case-card"
                key={c.id}
                onClick={() => (existing ? onOpen(existing) : onAnalyze(c))}
              >
                <div className="case-image">
                  <img loading="lazy" src={caseFile(c.id)} />
                  <span className="case-type">{c.type}</span>
                  <span className="case-action">
                    <ArrowUpRight size={19} />
                  </span>
                  {existing?.state === "completed" && (
                    <span className="case-completed">
                      <CheckCircle2 size={12} />
                      已分析
                    </span>
                  )}
                </div>
                <div className="case-copy">
                  <h3>{c.name}</h3>
                  <p>
                    <span>
                      {c.width} × {c.height}
                    </span>
                    <span>成对影像 · 人工标注</span>
                  </p>
                  <div className="case-bottom">
                    <span>
                      {existing ? states[existing.state] : "开始分析"}
                    </span>
                    <ArrowRight size={15} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {!filtered.length && (
          <div className="empty-state">
            <Layers3 size={32} />
            <p>
              {cases.length
                ? "没有匹配的案例"
                : "公开数据正在准备，完成后自动显示案例。"}
            </p>
          </div>
        )}
        {filtered.length > 6 && (
          <div className="pagination">
            <span>
              第 {page + 1} / {Math.ceil(filtered.length / 6)} 页 ·{" "}
              {filtered.length} 组案例
            </span>
            <button
              className="secondary"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <button
              className="secondary"
              disabled={(page + 1) * 6 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </section>
      <div className="bottom-grid">
        <section className="recent-panel">
          <div className="section-heading">
            <h2>最近分析</h2>
            <span className="subtle">本地持久化记录</span>
          </div>
          {tasks.slice(0, 4).map((t) => (
            <button className="recent-row" key={t.id} onClick={() => onOpen(t)}>
              <img src={file(t.id, "after.png")} />
              <div>
                <strong>{t.name}</strong>
                <span>
                  {new Date(t.created_at).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}{" "}
                  · {t.source}
                </span>
              </div>
              <span className={`state ${t.state}`}>{states[t.state]}</span>
              <ArrowUpRight size={17} />
            </button>
          ))}
          {!tasks.length && (
            <p className="empty-small">选择一个案例，开始你的第一项分析。</p>
          )}
        </section>
        <section className="method-card">
          <span className="eyebrow">EVIDENCE, NOT ASSUMPTION</span>
          <h2>
            每个判断，
            <br />
            都有依据。
          </h2>
          <p>
            原始影像、模型输出与人工复核分开保存。来源公开指标与本机复测结果明确区分。
          </p>
          <div>
            <span className="model-mark">COS</span>
            <span>
              <strong>ChangeOS Swin-T</strong>
              <small>
                {status?.model.downloaded ? "任务权重已准备" : "模型准备中"}
                {latest?.inference
                  ? ` · 最近推理 ${latest.inference.seconds.toFixed(1)}s`
                  : ""}
              </small>
            </span>
          </div>
        </section>
      </div>
      <footer className="page-footer">
        STARWATCH / 星察<span>遥感灾害变化分析平台 · 本地研究与辅助复核</span>
      </footer>
    </div>
  );
}
