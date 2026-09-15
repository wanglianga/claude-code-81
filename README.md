# 工业园区通勤班车预约与迟到申诉平台

Vue 3 + Element Plus（前端）/ NestJS + TypeORM（后端）/ PostgreSQL（数据库）。
前后端合并为单个镜像：NestJS 同时提供 API 与前端静态资源，`docker compose up -d` 一键部署。

---

## 原始需求

建设工业园区通勤班车预约与迟到申诉平台，可采用 Vue 3、NestJS 和 PostgreSQL。员工按企业、班次、站点、上下班时间、是否携带行李和临时加班提交预约，平台根据车辆座位、线路、司机、站点容量和企业考勤规则生成乘车名单。司机发车前确认车辆、路线、乘客签到和临时空座；员工上车时扫码或刷工牌，迟到、未到、临时改站和代刷会被记录。若道路拥堵、车辆故障、站点施工、员工错过班车、企业临时加班、司机绕行或班车到厂晚点，平台要把员工、司机、调度、企业 HR 和园区运营放在同一趟车里处理。到厂后，实际到达、迟到原因、考勤豁免、补车费用、司机绩效和员工申诉进入档案，用于优化线路和企业考勤协同。平台还要处理多企业共线、节假日调休、夜班员工、临时访客、园区门禁和司机安全培训。班车晚点不只是交通问题，还会影响考勤、生产排班和员工满意度。园区还要处理多班倒、跨区接驳、极端天气停运、临时安检和企业搬迁，线路优化需要持续影响车辆、司机和企业费用。线路调整结果还要给企业负责人和员工代表确认，防止通勤优化只由园区单方决定。

---

## 一、快速启动（宿主 Docker）

```bash
cp .env.example .env        # 可按需修改 CC_PUBLISH_PORT（默认 3081）
docker compose up -d --build
docker compose ps           # web 健康检查变为 healthy 后访问
```

浏览器访问：

```
http://<宿主IP>:<CC_PUBLISH_PORT>/           # 例如 http://localhost:3081/
```

- 前端页面与 API 同源（API 前缀 `/api`），PostgreSQL **不发布到宿主端口**，仅在 compose 内网通过服务名 `db` 访问。
- 健康检查：`GET http://<宿主IP>:<CC_PUBLISH_PORT>/api/health`
- 容器首次启动会自动建表（TypeORM synchronize）并写入幂等演示数据（`seed` 重复启动不会覆盖数据）。
- 查看实际映射端口：`docker compose port web 3000`
- 停止并清理：`docker compose down`（保留数据卷加；连数据一起删：`docker compose down -v`）

## 二、演示 / 测试账号

所有账号密码统一为 **`Pass1234`**，覆盖六种角色：

| 角色 | 用户名 | 姓名 / 说明 | 主要权限 |
|---|---|---|---|
| 系统管理员 | `admin` | 系统管理员 | 全部基础数据与业务 |
| 园区运营 | `operator` | 陈运营 | 线路提案、停运、申诉终裁、绩效、发布调整 |
| 调度员 | `dispatcher` | 周调度 | 生成名单、派车派司机、停运、事件处置 |
| 企业 HR | `hr_huaxing` | 孙丽华（华星电子） | 本企业考勤豁免/改费、申诉初审、企业侧双确认、访客登记 |
| 企业 HR | `hr_ruifeng` | 吴芳（瑞丰精密） | 同上（瑞丰，迟到宽限仅 5 分钟） |
| 企业 HR | `hr_hengxin` | 郑洁（恒信物流） | 同上（恒信，宽限 15 分钟） |
| 司机 | `driver01` | 马建国（安全培训有效至 2027-06） | 发车确认、扫码/工牌签到、代刷/改站登记、发车、到厂归档 |
| 司机 | `driver02` | 刘安全（有效至 2026-12） | 可被派车 |
| 司机 | `driver03` | 张过期（**安全培训已过期**） | 排班时被系统拦截，用于演示资质校验 |
| 员工 | `emp_li` | 李磊 HX1001（华星） | 预约、查看考勤、发起申诉、员工代表双确认 |
| 员工 | `emp_xu` `emp_wang` | 徐静 HX1002 / 王敏 HX1003（华星） | 员工 |
| 员工 | `emp_zhao` `emp_qian` `emp_sun` | 赵强 RF2001 / 钱多多 RF2002（带行李）/ 孙丽 RF2003（瑞丰） | 员工 |
| 员工 | `emp_zhou` `emp_wu` | 周婷 WL3001 / 吴刚 WL3002（恒信） | 员工 |
| 夜班员工 | `emp_night` | 高源 RF2099 | 已提交夜班接驳 + 临时加班 + 行李预约 |

其它演示数据：

- **多企业共线**：东线（L-EAST）由华星/瑞丰/恒信三家共乘，名单生成后按各企业乘车人数比例分摊车费。
- **今日数据**：8 条早班预约待生成名单（其中东湖路口站点容量仅 3，可演示容量约束）、晚班/夜班/西线各有预约；一辆 45 座车在保养；一名访客码 `V-DEMO20260915`（若当日非 2026-09-15，访客码会按“非今日”被门禁拒绝，可用 HR 重新登记当日访客）。
- **昨日档案**：driver01 执乘的早班因拥堵晚点 30 分钟，3 条考勤档案（迟到/补车费）、1 条待审申诉（李磊）、1 条未处理拥堵事件、1 条司机绩效。
- **日历**：今日为“国庆调休上班”示例；3 天后为“台风预警停运”示例（该日预约会被拒绝）。
- **线路提案**：东线增设站点并提前发车的提案，状态“待确认”，需要 HR 与员工代表双方确认后由运营发布。
- **员工工牌**：HX1001 等可在“访客与门禁”页直接刷工牌入园；访客用 `V-` 开头码。

## 三、推荐业务流验证脚本（浏览器点一遍）

1. 用 `dispatcher` 登录 → **调度派车**：对“东线早班”点“生成名单”（可先不选车，系统自动匹配座位；指派 `driver01`）。
   观察：按站点排座、多企业费用分摊、超载 overflow 分流提示；员工与司机均收到站内通知。
2. 用 `driver01` 登录 → **司机控制台**：勾选车辆/路线检查 → 开放签到；
   用“扫码/工牌”输入 `HX1001`、`HX1002` 签到；对某乘客做“改站”“代刷登记”；留 1 人不签到直接“发车”（自动记未到）→ “到厂确认”。
3. 到厂后：系统按企业宽限规则生成考勤（实际到达/迟到分钟/迟到原因/补车费）、司机绩效（晚点扣分、满载奖、故障/绕行罚则），并推送通知。
4. 用任意角色在 **途中事件协同** 上报“道路拥堵/车辆故障/极端天气…”，调度或运营处理时选择“考勤豁免/补车费园区承担/退费”，相关考勤档案自动联动改写，员工与 HR 收到结果通知。
5. 用 `emp_li` 登录 → **我的考勤/申诉** 对迟到记录发起申诉；用 `hr_huaxing` 在 **迟到申诉** 页“成立 + 豁免 + 退费”或“升级运营”，考勤与费用自动更新。
6. **线路调整双确认**：运营发起提案 → `hr_huaxing` 代表企业确认 → `emp_li`（员工代表）确认 → 运营“发布执行”；单方无法落地。
7. **访客与门禁**：HR 登记访客生成 `V-` 码 → 访客乘车核验 → 门禁页刷访客码/工牌入园、离园；错误凭证、过期访客码会被拒绝并留痕。
8. **极端天气停运**：调度对车次“停运”→ 全车员工/司机/HR/运营收到停运通知，考勤统一豁免。
9. **基础数据**：维护企业考勤规则、线路站点（标记施工会通知调度）、夜班/接驳班次、车辆状态、节假日调休/停运日。

## 四、需求点对照

| 需求 | 实现位置 |
|---|---|
| 按企业/班次/站点/上下班时间/行李/临时加班预约 | 员工「班车预约」、`POST /api/reservations`（含站点容量、停运日、重复预约校验） |
| 车辆座位/线路/司机/站点容量/企业考勤规则生成名单 | 调度「生成名单」`POST /api/trips/generate`：自动匹配座位、按站点排座、overflow 分流、安全培训资质校验、多企业费用分摊 |
| 发车前确认车辆/路线/签到/临时空座 | 司机控制台四步流程；`emptySeats` 实时更新 |
| 扫码/刷工牌、迟到/未到/改站/代刷记录 | `POST /api/driver/trips/:id/board`、`no-show`；代刷生成安全事件并通知员工 |
| 拥堵/故障/施工/错过班车/加班/绕行/晚点五方协同 | 「途中事件」模块，一次上报通知车次全部员工+司机+对应企业 HR+调度+运营 |
| 到厂实际到达/迟到原因/豁免/补车费/绩效/申诉入档 | `arrive` 事务：AttendanceRecord + DriverPerformance；申诉成立联动豁免/退费 |
| 多企业共线 | `line_companies` 关联 + 名单按人数分摊车费（feeSplit） |
| 节假日调休 / 极端天气停运 | 节假日日历；停运日禁止预约；车次停运考勤自动豁免 |
| 夜班员工 / 多班倒 / 跨区接驳 | 班次支持 shiftLabel（早/白/夜/接驳）、双向 direction；演示含 19:00 夜班接驳 |
| 临时访客 / 园区门禁 | VisitorPass 二维码 + GateLog 闸机记录（员工工牌/访客码，放行/拒绝留痕） |
| 司机安全培训 | 派车/排班校验 `safetyTrainingExpiry`，过期司机不可派车（driver03 演示拦截） |
| 临时安检 / 企业搬迁 | 事件类型 `security_check` / `relocation`；提案类型含搬迁配套，落地后更新线路状态 |
| 线路调整持续影响车辆/司机/企业费用 | 提案含影响评估、预计月节省、生效日期；执行后线路状态联动 |
| 企业负责人 + 员工代表双确认 | LineProposal 双侧 confirmation 数组，双方齐确认后运营才能发布 |

## 五、技术结构

```
.
├── docker-compose.yml        # db(postgres:16-alpine) + web(本镜像)，仅 web 发布端口
├── Dockerfile                # 三阶段：前端构建 → 后端构建(含前端产物) → 非 root 运行时 + HEALTHCHECK
├── .env.example
├── backend/                  # NestJS 10 + TypeORM + PostgreSQL + JWT
│   └── src/
│       ├── entities.ts       # 18 张表：企业/用户/线路/站点/班次/车辆/车次/预约/考勤/事件/申诉/绩效/提案/访客/门禁/日历/通知
│       ├── auth/             # JWT、角色守卫
│       ├── business/         # 全部业务服务与 REST 接口
│       ├── seed.ts           # 幂等演示数据
│       └── main.ts           # API + SPA 静态托管
└── frontend/                 # Vue 3 + Vite + Element Plus + Pinia + ECharts
    └── src/pages/            # 登录/总览/预约/我的考勤/司机控制台/调度/事件/考勤/申诉/绩效/双确认/访客门禁/基础数据
```

主要 API（均在 `/api` 前缀下，JWT Bearer 鉴权）：

```
POST /auth/login
GET  /dashboard | /notifications
GET  /companies /lines /schedules /vehicles /drivers /employees /holidays      # 基础数据（部分带写接口）
GET  /booking-view?date=
POST /reservations | /reservations/:id/cancel | /reservations/:id/change-station
GET  /my/reservations | /my/attendance | /my/appeals
POST /trips/generate | /trips/:id/assign | /trips/:id/suspend
GET  /driver/trips | /driver/trips/:id/manifest
POST /driver/trips/:id/confirm|depart|arrive|board | /no-show/:rid
GET  /events ; POST /events | /events/:id/resolve
GET  /attendance ; POST /attendance/:id/adjust
POST /appeals | /appeals/:id/review
GET  /performances | /proposals ; POST /proposals | /proposals/:id/confirm/:side | /apply | /reject
POST /visitors | /visitors/board/:code ; POST /gate/scan ; GET /gate-logs
```

## 六、本地开发（可选，非部署必需）

```bash
# 后端（需要可访问的 PostgreSQL）
cd backend && npm install && npx tsc -p tsconfig.json && DB_HOST=localhost node dist/main.js
# 前端
cd frontend && npm install && npx vite   # 已配置 /api 代理到 localhost:3000
```

验证方式以「宿主 `docker compose up -d` 健康检查通过 + 浏览器走通上述业务流」为准。

仓库另附 `e2e-check.js`（Node 内置模块，无需安装依赖），在 compose 启动后对 `http://host.docker.internal:<CC_PUBLISH_PORT>` 跑 59 项接口级业务断言（覆盖六角色鉴权、名单、签到、改站、代刷、事件五方协同、考勤豁免、申诉、双确认、访客门禁、停运通知等）：

```bash
BASE=http://host.docker.internal:3081/api node e2e-check.js
```
