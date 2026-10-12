import base64
import html
import json
from pathlib import Path
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from .domain import CLASSES


def report_html(task, reviews, folder, evaluation=None, reviewed_stats=None):
    def image(name):
        path = Path(folder) / name
        return (
            "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()
            if path.exists()
            else ""
        )

    stats = task.get("stats", {})
    counts = stats.get("class_counts", [0, 0, 0, 0])
    rows = "".join(
        f'<tr><td><i style="background:{c["color"]}"></i>{c["name"]}</td><td>{n:,}</td></tr>'
        for c, n in zip(CLASSES, counts)
    )
    notes = "".join(
        f"<li>{html.escape(r.get('status', ''))} · {html.escape(r.get('note', '') or '无补充备注')}</li>"
        for r in reviews
    )
    metadata = html.escape(
        json.dumps(task.get("inference", {}), ensure_ascii=False, indent=2)
    )
    name = html.escape(task.get("name", "遥感分析"))
    raw_date = task.get("created_at", "")
    try:
        date = datetime.fromisoformat(raw_date)
        date = date.replace(tzinfo=timezone.utc) if date.tzinfo is None else date
        displayed_date = date.astimezone(ZoneInfo("Asia/Shanghai")).strftime(
            "%Y-%m-%d %H:%M:%S (UTC+8)"
        )
    except (ValueError, TypeError):
        displayed_date = raw_date
    reviewed_counts = (reviewed_stats or stats).get("class_counts", [0, 0, 0, 0])
    review_rows = "".join(
        f"<tr><td>{c['name']}</td><td>{n:,}</td></tr>"
        for c, n in zip(CLASSES, reviewed_counts)
    )
    local = (
        f"hold 固定清单：{evaluation['samples']} / {evaluation['total']} 对；综合 F1：{evaluation['overall_f1'] * 100:.2f}%"
        if evaluation and evaluation.get("samples")
        else "尚无本机已评估样本"
    )
    return f'''<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>星察分析报告 · {name}</title>
<style>body{{font-family:"Microsoft YaHei",sans-serif;color:#243547;max-width:1000px;margin:50px auto;padding:24px}}h1{{font-size:32px}}.top{{border-bottom:3px solid #21a79a;padding-bottom:24px}}small{{color:#6d8192}}.images{{display:flex;gap:16px;margin:28px 0}}figure{{margin:0;flex:1}}img{{width:100%;border-radius:8px}}figcaption{{margin-top:10px;color:#697d8d}}table{{width:100%;border-collapse:collapse}}td,th{{text-align:left;padding:12px;border-bottom:1px solid #dde5e9}}i{{display:inline-block;width:10px;height:10px;margin-right:10px;border-radius:3px}}pre{{background:#f3f6f8;padding:18px;white-space:pre-wrap}}button{{padding:12px 20px;border:0;background:#17374a;color:white;border-radius:8px;cursor:pointer}}@media print{{button{{display:none}}body{{margin:0;max-width:none}}figure,table,pre{{break-inside:avoid}}}}</style>
<button onclick="window.print()">打印 / 保存为 PDF</button><div class="top"><p>星察 STARWATCH / 分析报告</p><h1>{name}</h1><small>任务 {html.escape(task["id"])} · {html.escape(displayed_date)}</small></div>
<div class="images"><figure><img src="{image("before.png")}"><figcaption>灾前影像</figcaption></figure><figure><img src="{image("after.png")}"><figcaption>灾后影像</figcaption></figure><figure><img src="{image("composite.png")}"><figcaption>模型原始结果叠加</figcaption></figure></div>
<h2>模型原始结果</h2><p>候选建筑区域：{stats.get("candidate_count", 0)}。连通区域统计不等于精确建筑实例计数。</p><table><tr><th>损毁类别</th><th>像素量</th></tr>{rows}</table>
<h2>人工复核</h2><p>共有 {len(reviews)} 条有效复核操作。原始预测保留不变，复核图层单独导出。</p><ul>{notes or "<li>尚无人工复核记录</li>"}</ul>
<table><tr><th>人工复核后的类别</th><th>像素量</th></tr>{review_rows}</table>
<h2>模型能力验证</h2><p><strong>来源公开指标：</strong>完整 hold 报告综合 F1 为76.91%。</p><p><strong>本机复测：</strong>{html.escape(local)}。</p><p>上述指标属于数据集层面的验证，不代表这张影像的逐建筑正确率；子集评估不替代完整hold或跨事件泛化验证。</p>
<h2>来源与运行记录</h2><pre>{metadata}</pre><p>模型分数用于辅助复核，不代表经过校准的真实灾损概率。模型卡公开指标与本次个案分析无直接准确率对应关系。无地理参考的影像仅报告像素统计。</p>
<small>来源：{html.escape(task.get("source", "upload"))}；模型为 ChangeOS Swin-T / xView2。报告生成内容可与原始影像、mask、元数据和复核记录交叉核验。</small></html>'''
