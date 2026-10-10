# 星察 · STARWATCH

遥感灾害变化分析平台。本地运行，使用现成 ChangeOS Swin-T 任务权重分析灾前/灾后 RGB 影像中的建筑损毁，无需训练模型。

## 直接使用

当前电脑的依赖、模型和公开案例已准备。双击根目录 **`启动星察.cmd`**，打开：

**http://127.0.0.1:8765/**

服务只绑定本机。完成数据准备后，分析过程无需向外部模型服务发送影像。首次分析需要加载模型，后续任务复用已加载模型。

## 已实现功能

- 灾害观测台：100组真实公开案例、灾种筛选、搜索、分页、任务统计及历史。
- 影像上传：PNG/JPEG/8位RGB GeoTIFF，验证尺寸、文件大小、真实图像内容和地理网格，要求确认对齐。
- 真实推理：现成完整任务权重；GPU/CPU设备选择；1024原图GPU推理、大图重叠切块和显存不足重试。
- 影像工作台：灾前/灾后/滑动对比/损毁叠加，同步缩放平移、透明度、类别过滤、真值对照和候选区域选择。
- 人工复核：区域确认、改判、需复查、备注、多边形修正和撤销。原始预测不可改写，复核图层独立保存。
- 本地持久化：SQLite任务与复核历史，文件结果保存，刷新恢复；中断任务可重试。
- 可追溯报告：打印HTML并通过浏览器保存为PDF，原始mask、复核mask、叠加图、区域CSV、完整元数据JSON。
- 地理输出：有真实地理参考时导出GeoTIFF与WGS84区域GeoJSON；普通图片仅输出像素坐标与像素统计。
- 模型评估：固定抽样清单、本地复测进度、来源指标分开展示、薄弱样本与断点恢复。

## 已完成的真实验证

设备：RTX 3050 Laptop 4GB，Ryzen 7 6800H，约16GB内存。

使用从完整933对hold中按种子1337固定抽取的100对样本，未按模型效果选择。实际结果：

- 综合 F1：**77.49%**。
- 建筑定位 F1：**85.35%**。
- 损毁类别调和平均 F1：**74.12%**。
- 未见损伤、轻度、重度、毁坏 F1 分别为 **89.01%、52.29%、80.02%、90.00%**。
- 模型加载后平均推理时间：约 **0.35秒/对**；首个1024原图CUDA烟测峰值分配显存约 **833MB**。
- 100个样本推理失败数：**0**。

这是本机固定hold子集结果，不是完整933对结果，也不是新的灾害事件泛化保证。轻度损伤仍是薄弱类别，工作台支持明确的人工复核流程。

评估清单SHA256：`74909a69061215c98d134e9837dc47491451f86fe740b1b40cd830e75a023a13`。

完整模型权重SHA256：`81ae6386ceebe225ab6c072cb987b57312fdcfdb2a7f72ab9b30e5e8f1041cc4`。

## 操作建议

从公开案例打开“圣罗莎山火”或“帕卢海啸”，用滑杆观察前后影像，再切换损毁图层。点击候选区域查看局部对比，记录复核意见。从右侧“导出”下载结果，或打开报告打印为PDF。

滚轮缩放，拖动平移；`0`重置视图。绘制多边形时点击增加顶点，`Enter`完成，`Esc`取消。

## 在另一台电脑部署

准备Python3.11、Node.js20.19+和Git，NVIDIA GPU使用支持CUDA12.8的驱动。推荐安装uv加快依赖准备。

在根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

脚本建立独立`.venv`，安装固定CUDA PyTorch和上游模型库，下载任务权重及hold数据，准备固定100个样本并构建前端。GPU依赖体积较大，首次安装取决于网络；数据与模型下载支持缓存校验和续传。准备后双击启动脚本。

运行库版本固定于`requirements-lock.txt`；上游torchange源代码固定到提交`190b07a2eb4c389a5dc3f72802c67f428cdfd6b7`。模型初始化显式禁用骨干权重下载，严格加载本地完整任务safetensors权重。

## 开发与验证命令

```powershell
# 后端
.\.venv\Scripts\python.exe -m uvicorn backend.server:app --host 127.0.0.1 --port 8765 --no-access-log

# 前端热更新（另一终端）
cd frontend
npm ci
npm run dev
```

前端开发地址为http://127.0.0.1:5173/，API代理至8765。

```powershell
# 根目录：后端测试
.\.venv\Scripts\python.exe -m pytest tests -q

# frontend目录：交互测试与构建
npm test
npm run build

# 根目录：固定100样本评估，相同权重与流程自动续跑
.\.venv\Scripts\python.exe -m scripts.evaluate

# 全部933对hold评估；使用已下载的6个数据分片
.\.venv\Scripts\python.exe -m scripts.evaluate --full
```

全量命令会将本地案例清单扩展为完整hold并生成新的清单哈希。此前100子集的验证快照保存在`docs/validation-results.json`，不会与全量结果混淆。

## 文件结构

- `frontend/src/`：页面、影像视口、复核、数据接口与样式。
- `backend/`：影像校验、模型适配、任务队列、持久化、指标、报告与API。
- `scripts/`：环境准备、模型/数据下载、固定清单评估及启动。
- `tests/`：后端核心行为与输入、复核、导出规则测试。
- `models/changeos/`：本地任务权重与配置，不纳入Git。
- `data/cases/`、`data/tasks/`、`data/evaluation/`：公开样本、真实任务结果、评估明细，不纳入Git。
- `data/provenance.json`：下载来源、长度与SHA256。
- `docs/`：设计、实施计划、验收记录和截图。

## 能力边界

当前模型分析灾后建筑损毁，不能直接输出洪水淹没范围、经济损失或保证任意卫星数据识别效果。图片必须配准，改变分辨率、季节、拍摄角度或传感器可能影响模型表现。模型分数未经概率校准。

候选建筑区域来自连通域，不等于精确独立建筑实例。无地理信息时不输出平方米或虚构地图位置。当前GeoTIFF输入限定三波段或前三波段已明确为RGB的8位数据；多光谱、16位及SAR数据需使用匹配的处理方法与模型。

## 来源

- [torchange / ChangeOS](https://github.com/Z-Zheng/pytorch-change-models)
- [预训练任务模型卡](https://huggingface.co/EVER-Z/torchange_example_changeos_swint_on_xview2_best42k)
- [xView2/xBD数据镜像](https://huggingface.co/datasets/EVER-Z/torchange_xView2)

代码和权重、数据的使用条款分别遵循上游发布声明。模型Apache-2.0许可不替代原始遥感影像的数据使用权；发布或商用前核验原始xBD条款。
