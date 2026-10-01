# 矿区钻孔岩芯编目台（gbdrillcore）

面向地质勘查钻探班组与地质编录员：登记钻孔台帐、回次进尺与采取率、岩芯箱箱位，并按深度区间编录岩性描述与样品。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## 两套深度：孔深与垂深各自持有

矿区钻孔多为斜孔，系统内同时存在两套深度，**各自持有、互不覆盖**：

- **孔深（沿孔进尺）**：回次、岩芯箱、岩性、样品的唯一落库深度。岩芯箱格位与样品号只按孔深对应；改岩芯、改编录只动孔深一栏。
- **垂深（竖直深度）**：由测量组的测斜成果（孔深上的倾角、方位角）按**平均角法**逐段换算派生，不回写到任何编录记录上。补测或改点只动垂深一栏。

配套规则：

- **待换算**：测斜成果未覆盖（或段内含无效测点）的段，按孔深保留并标「待换算」，只影响本段显示，不挡住其他段。
- **按段重试**：换算失败的段在工作台「待换算」清单中逐段重试；已换算的段保持不动。
- **幂等补送**：测量组补送测斜成果按测点孔深去重合并——同深度同值不变、异值更新、新深度追加，同一份成果重复补送不会多出测点。
- **按基准显示**：工作台可切换「孔深基准 / 垂深基准」，钻孔剖面、深度覆盖与岩芯箱连续性随基准显示（基准存于 URL `?basis=`）。
- **导出带两套深度**：顶栏「导出成果」生成 CSV，回次 / 岩芯箱 / 岩性 / 测斜全部并列孔深、垂深两列与换算状态，可直接交设计部门作垂深剖面。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21811>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（`npm run build` 含 `tsc --noEmit` 类型检查） |
| UI | Ant Design 5 + @ant-design/icons |
| 路由 | React Router 6（5 条业务路由 + 404） |
| 状态 | Zustand（holeStore / runStore / boxStore / lithoStore） |
| 存储 | IndexedDB（Dexie，库名 `gbdrillcore-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21811
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # drill-hole / drill-run / core-box / litho-log
│       ├── stores/            # holeStore / runStore / boxStore / lithoStore
│       ├── components/common/ # DepthRangeInput / RecoveryBadge / BoxGrid / LithoColumn / HoleProfile / TvdRange / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useHoleFilter / useDepthCalc / useSurvey
│       ├── pages/             # HoleBoard / HoleList / RunLog / CoreBoxList / LithoEditor
│       ├── router/index.tsx   # 路由表
│       └── utils/             # recovery.ts / survey.ts / db.ts / export.ts（+ seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 工作台 | 钻孔进度、设计达成率、未达设计待补勘清单、采取率异常清单（<75% 标红）；深度基准切换，钻孔剖面、深度覆盖与岩芯箱连续性按基准显示，待换算清单逐段重试 |
| `/holes` | 钻孔台帐 | 建孔、坐标与孔口标高、设计/终孔深度、测斜数据（严格校验 + 补送合并去重）、回次深度覆盖与岩芯箱数回显 |
| `/runs` | 回次记录 | 起止深度自动算进尺与采取率，低于 75% 立即标红并入异常清单；孔深/垂深两栏并列 |
| `/boxes` | 岩芯箱编目 | 格位网格按孔深填充、破损格标记、装箱深度连续性与格位容量校验；垂深栏只读 |
| `/lithology` | 岩性编录 | 按孔深区间编录岩性/蚀变/矿化/RQD/样品，区间重叠报冲突并高亮，SVG 岩性柱状图；垂深栏只读 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbdrillcore-db`），表：`holes`、`runs`、`boxes`、`lithos`、`meta`。
- 编录记录（回次 / 岩芯箱 / 岩性）只落库孔深；垂深由 `holes.surveyData` 经 `utils/survey.ts` 平均角法即时换算，不落库、不回写，因此测斜成果与编录记录各自持有深度，互不覆盖。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为岩性表增加 `[holeId+fromDepth]` 复合索引并回填历史 RQD。升级前可用顶栏「导出备份」导出全量 JSON。
- 顶栏两个导出：「导出备份」为可恢复的全量 JSON；「导出成果」为交付用 CSV，孔深 / 垂深两套深度并列并标注换算状态。
- 首次打开且表为空时写入一批示例编目数据（`src/utils/seed.ts`，5 个钻孔 + 回次 + 岩芯箱 + 岩性区间；个别孔测斜滞后于进尺，用于演示待换算与按段重试）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
