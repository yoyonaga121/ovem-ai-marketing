# OVEM · 光谷效应

AI 营销操作系统 · 虚拟品牌全案作品集

OVEM（Optics Valley Effect）是一个虚构的消费级生活机器人品牌。本项目把一次品牌全案做成可配置的内容产线：17 页营销系统前台 + V2 配置后台，覆盖 20 款产品、8 个内容渠道、160 个基础物料位与 480 个 A/B 变体。

## 在线演示

- 前台：https://yoyonaga121.github.io/ovem-ai-marketing/
- 配置后台：https://yoyonaga121.github.io/ovem-ai-marketing/OVEM配置后台.html

## 目录

- `index.html`：GitHub Pages 入口，与主站内容一致
- `OVEM_AI营销系统.html`：17 页营销系统主站
- `OVEM配置后台.html`：V2 配置后台，支持产品、渠道、页面、指标配置与实时预览
- `ovem-config.js`：默认配置，可被后台导出文件覆盖
- `assets/`：品牌视觉、产品设定图、渠道物料与宣传片

## 说明

- 本项目为虚拟品牌案例，页面内数据为演示数据。
- 后台配置保存在浏览器 `localStorage`，不依赖服务端。
- 页面为单文件 HTML，可直接本地打开，也可通过任意静态托管访问。

## 更新

修改 `OVEM_AI营销系统.html` 后，同步覆盖 `index.html`，再提交并推送 `main` 分支；GitHub Pages 会自动重新构建。`_backup/`、`_preview/`、`_tools/` 为本地工作目录，不参与部署。
