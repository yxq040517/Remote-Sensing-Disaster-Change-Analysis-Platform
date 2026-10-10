# 上游项目与数据来源

本项目通过Python依赖使用torchange和ever，未将上游模型训练代码伪装为本项目自主训练成果。

- torchange：https://github.com/Z-Zheng/pytorch-change-models ，Apache-2.0；提交190b07a2eb4c389a5dc3f72802c67f428cdfd6b7。
- ChangeOS任务模型：https://huggingface.co/EVER-Z/torchange_example_changeos_swint_on_xview2_best42k ，模型卡标注Apache-2.0。
- xView2 / xBD原始论文与挑战：https://xview2.org/ 。影像及标注使用权以原始发布条款为准。
- 数据托管：https://huggingface.co/datasets/EVER-Z/torchange_xView2 。下载使用镜像地址，并记录对应上游ID与每个文件SHA256。

参考论文：Zheng et al., Building damage assessment for rapid disaster response with a deep object-based semantic change detection framework: From natural disasters to man-made disasters, Remote Sensing of Environment, 2021。

本项目模型能力数字均区分上游模型卡报告和本机固定数据清单复测。代码许可不自动授予底层遥感影像的商业使用许可。
