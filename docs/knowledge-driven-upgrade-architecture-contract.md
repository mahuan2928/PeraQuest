# 知识驱动升级系统架构契约 v0.1

状态：提案（本 PR 仅增加契约与迁移蓝图，不接入运行时）
适用分支：`main` 当前 MVP 基础
目标：在不改动现有试用、监护人同意、语音安全闸门的前提下，为长期学习进度建立可演进的服务契约。

## 1. 现状与边界

仓库当前是 TypeScript monorepo：`apps/api` 为 Fastify 模块化单体，`packages/contracts` 为共享契约，持久化实现同时存在 PostgreSQL 与内存仓储。现有试用明确是 30 分钟的短期运营状态，答题原文、分数和长期学习进度不会持久化；本文不改变这一行为。

本契约只覆盖以下新域：知识点掌握度、阶段考试、每日复习 XP、跨阶挑战、活动币、角色外观，以及后期 PVP 的数据预留。首个实现阶段仍只允许 `eiken_grade_3`，所有写接口必须经过既有学生身份与未成年人/监护人权限边界；语音上传和支付边界不因本域放宽。

## 2. 领域模型（PostgreSQL 为事实来源）

所有表均建议使用 `gen_random_uuid()`、`created_at`/`updated_at`，并保留 `tenant_id`（当前固定为默认租户）以便未来隔离。客户端只接收 DTO，不直接依赖表结构。

### 2.1 内容与掌握度

- `knowledge_nodes(id, exam_level, skill, code, title, version, status, prerequisite_ids jsonb)`：知识点内容目录；`code` 在同一 `exam_level + version` 下唯一；内容发布后不可原地改写。
- `student_knowledge(student_id, knowledge_node_id, mastery_score numeric(5,4), state, stability_days numeric, due_at timestamptz, attempt_count int, correct_count int, last_attempt_at, version, updated_at)`：当前投影。`state` 为 `new | learning | review | mastered | suspended`，`mastery_score` 范围 0..1。
- `knowledge_events(id, student_id, knowledge_node_id, source, outcome, difficulty numeric, occurred_at, idempotency_key unique, payload jsonb)`：追加式事实日志；`source` 为 `lesson | daily_review | stage_exam | cross_stage_challenge`，不保存语音原文。

掌握度更新由服务端基于事件计算（可采用 FSRS-compatible 参数）；客户端不能提交 `mastery_score`。事件写入与投影更新必须在同一事务内完成，重复 `idempotency_key` 返回原结果而不重复发奖。

### 2.2 阶段考试与跨阶挑战

- `stage_exams(id, exam_level, stage, version, status, blueprint jsonb, pass_score numeric(5,4), published_at)`：阶段考试蓝图与版本。
- `stage_attempts(id, student_id, exam_id, status, started_at, submitted_at, score numeric(5,4), passed boolean, idempotency_key unique)`：`created | in_progress | submitted | passed | failed | expired`；考试答案仅保留满足审计所需的脱敏摘要，题目原文由内容服务按版本重建。
- `cross_stage_challenges(id, from_exam_level, to_exam_level, version, status, rules jsonb)`：跨阶规则；当前只允许配置，不开放跨级写入。
- `challenge_attempts(id, challenge_id, student_id, status, score, started_at, submitted_at, result jsonb)`：`created | in_progress | submitted | passed | failed | expired`。

通过阶段考试或跨阶挑战只产生领域事件，由规则服务决定掌握度与奖励，不直接修改钱包余额。

### 2.3 每日复习 XP、活动币与外观

- `daily_review_sessions(id, student_id, review_date date, status, target_count, completed_count, xp_awarded, idempotency_key unique)`：`open | completed | expired`；同一学生同一自然日只允许一个有效 session。日期按服务端用户时区计算，服务端存 UTC。
- `xp_ledger(id, student_id, source, amount int, source_ref, idempotency_key unique, created_at)`：XP 只增不减的账本；等级/总 XP 是可重建投影。
- `activity_coin_ledger(id, student_id, reason, delta int, source_ref, idempotency_key unique, created_at)`：活动币正负变更均记账；余额由账本求和或缓存投影得到，禁止客户端直接写余额。
- `avatar_catalog(id, asset_key, kind, price_coins int, exam_level, status, version)`：角色外观目录；资源 key 不等于可执行代码。
- `student_avatar_state(student_id, avatar_id, equipped_item_ids jsonb, updated_at)`：当前装备；更新时校验目录状态、兼容性与拥有权。
- `student_entitlements(student_id, avatar_id, granted_by, source_ref, granted_at, revoked_at)`：已获得外观，唯一键为学生与 avatar。

奖励规则必须是服务端版本化配置：一次业务事实最多一个 `idempotency_key`；XP、活动币、外观授予要么全部成功，要么全部回滚。

### 2.4 后期 PVP 预留（不在本 PR 开放）

- `pvp_seasons(id, exam_level, starts_at, ends_at, status, rules_version)`。
- `pvp_profiles(student_id, season_id, rating int, wins int, losses int, placement_status)`。
- `pvp_matches(id, season_id, mode, status, participant_snapshot jsonb, started_at, ended_at)`：`queued | matched | in_progress | completed | cancelled`。
- `pvp_match_results(match_id, participant_id, score, outcome, evidence_hash, created_at)`。

PVP 只引用发布后的知识点/考试版本快照；未成年人可见性、聊天/语音和反作弊策略需另行评审。未有授权和风控实现前，不创建 PVP API 路由，不写入 rating。

## 3. 状态机与不变量

### 3.1 学习与奖励

`new → learning → review → mastered`; 任意非终态可因内容下架进入 `suspended`，`suspended` 只能由服务端恢复到 `learning`。一次复习提交：校验 session 状态 → 写 `knowledge_event` → 更新投影 → 结算 XP/活动币 ledger → 返回新状态。所有步骤事务化。

`daily_review: open → completed`（达到目标数）；`open → expired`（跨日或超时）。`completed/expired` 不可再次结算。客户端重试使用 `Idempotency-Key`。

`stage_attempt: created → in_progress → submitted → passed|failed`；超时从 `created/in_progress` 到 `expired`。提交接口幂等，已提交状态只返回原结果。

### 3.2 关键不变量

1. 任何掌握度、XP、活动币、rating 都由服务端计算；客户端只能提交答案/动作。
2. 一个事实的奖励不超过一次；幂等键按学生、业务来源和客户端请求共同约束。
3. `knowledge_node.version`、考试 blueprint 和挑战 rules 发布后不可变；迁移通过新版本与映射完成。
4. 现有 `canLearn`、监护人、同意和能力接口继续是前置条件；本域不绕过它们。
5. 试用仍不产生长期进度或奖励。

## 4. REST API 契约（`/v1`）

认证沿用现有 `x-student-id`（生产实现应替换为认证主体）；写请求要求 `Idempotency-Key`。错误沿用 `{ code, details? }`，并新增 `IDEMPOTENCY_REPLAY`（可选说明字段，不改变 HTTP 语义）。

### 掌握度与每日复习

- `GET /v1/me/knowledge?examLevel=eiken_grade_3&state=&dueBefore=` → `{ items: [{ knowledgeNodeId, code, state, masteryScore, dueAt, attemptCount }] }`
- `POST /v1/me/review-sessions` body `{ examLevel, reviewDate }` → `201 { sessionId, targetCount, items[] }`
- `POST /v1/me/review-sessions/:sessionId/answers` body `{ knowledgeNodeId, outcome: 'correct'|'incorrect'|'skipped', durationMs }` → `{ accepted, mastery, nextDueAt, xpAwarded, activityCoinsAwarded, session }`
- `GET /v1/me/progress/summary?examLevel=` → `{ mastery, dueCount, xp, level, activityCoins, streak }`

### 阶段考试与跨阶挑战

- `GET /v1/stage-exams?examLevel=&stage=` → `{ items: [{ examId, stage, version, passScore, status }] }`
- `POST /v1/stage-exams/:examId/attempts` → `201 { attemptId, status, questionCount, expiresAt }`
- `POST /v1/stage-attempts/:attemptId/submit` body `{ answers: [{ questionId, answer }] }` → `{ attemptId, status, score, passed, masteryUpdates, rewards }`
- `GET /v1/cross-stage-challenges?from=&to=` → `{ items: [...] }`
- `POST /v1/cross-stage-challenges/:challengeId/attempts` / `POST /v1/challenge-attempts/:attemptId/submit`：形状与阶段考试一致；未发布规则返回 `404` 或 `409 CHALLENGE_NOT_AVAILABLE`。

### 活动币与角色外观

- `GET /v1/me/wallet` → `{ xp, level, activityCoins, ledgerVersion }`
- `GET /v1/avatar-catalog?examLevel=` → `{ items: [{ avatarId, assetKey, priceCoins, owned, equipped }] }`
- `POST /v1/me/avatar-purchases` body `{ avatarId }` → `201 { entitlement, wallet }`
- `PUT /v1/me/avatar-state` body `{ avatarId, equippedItemIds }` → `{ avatarId, equippedItemIds }`

购买必须使用服务端活动币账本事务；余额不足返回 `409 INSUFFICIENT_ACTIVITY_COINS`。未成年人能力/监护人策略沿用产品合规评审结果，不在此契约中默认为可购买。

### PVP（保留，不实现）

预留 `GET /v1/pvp/seasons`、`POST /v1/pvp/queue`、`DELETE /v1/pvp/queue`、`GET /v1/pvp/matches/:matchId`，在 feature flag 关闭时统一返回 `404 PVP_NOT_AVAILABLE`；本阶段不将它们加入 OpenAPI 或路由注册。

## 5. 分阶段迁移策略

1. **Expand（本 PR 后）**：新增上述表、索引、约束和 feature flags；不改现有表，不回填用户进度；双写开关默认关闭。迁移脚本可重复执行并支持回滚未使用对象。
2. **Backfill（独立 PR）**：只从上线后的新学习事件构建投影；历史 trial 数据明确不回填。按学生分批、可暂停，校验 ledger 总额与事件数。
3. **Read shadow**：服务端在 flag 下读取新投影，与现有响应并行记录差异，不改变客户端响应；监控幂等冲突、事务失败、延迟和负余额。
4. **Enable**：先内部 QA，再小流量启用每日复习；考试、挑战、商城分别开关。客户端先读取能力/版本，不假设新字段存在。
5. **Contract cleanup**：稳定一个版本周期后，才在独立 PR 移除 shadow 代码和旧投影。任何考试/钱包/外观迁移失败必须可通过账本重放恢复。

迁移要求：每个 schema 变更带前向/后向兼容说明；生产发布先迁移再部署代码；旧客户端收到未知字段可安全忽略，新客户端对缺失字段使用关闭态。

## 6. 验收与测试门槛

本契约 PR 的验收是文档可审阅、字段和状态命名稳定、与现有安全边界一致，不声称已实现上述 API。实现 PR 必须补齐：共享 TypeScript contracts、OpenAPI、PostgreSQL migration、Memory repository 对等语义、状态机/幂等/奖励事务测试，以及现有质量门禁 `npm run lint && npm run typecheck && npm test && npm run build`。

当前仓库的既有试用测试继续作为回归基线：试用答题仍不写长期进度，未成年人仍不能绕过监护人验证或语音同意闸门。
