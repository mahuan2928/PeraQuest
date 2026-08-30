# P1.3-6 Mastery / Due 规则确认

状态：服务端投影写入已落地。当前范围覆盖正式诊断提交后的 `student_knowledge` / `student_knowledge_applied_evidence` 更新、幂等 replay 保护和 Trial 隔离；只读 API、前端入口和后续复习任务仍不在本范围内。

## 1. 目标

P1.3-6 在正式诊断提交后，基于已落地的 `knowledge_evidence` 事实表更新学生知识点掌握度和下次复习时间。下列规则是当前服务端投影写入实现的验收依据，避免在运行时代码中临时发明算法。

## 2. 输入事实

唯一输入来源为正式流程生成的 `knowledge_evidence`：

- `student_id`
- `attempt_id`
- `exam_version_id`
- `item_snapshot_id`
- `answer_id`
- `source_item_id`
- `skill_ref`
- `knowledge_point_ref`
- `outcome`: `correct | incorrect | skipped`
- `earned_score`
- `max_score`
- `occurred_at`

禁止输入来源：

- Trial 流程。
- 客户端提交的 `score`、`passed`、`mastery`、`due`、`correctness`。
- 未写入 `knowledge_evidence` 的临时答题结果。

## 3. 投影表字段

P1.3-6 新增 `student_knowledge` 投影表：

- `student_id uuid NOT NULL`
- `knowledge_point_ref text NOT NULL`
- `raw_correct_total numeric(12,6) NOT NULL`
- `raw_attempt_total numeric(12,6) NOT NULL`
- `mastery_score numeric(7,6) NOT NULL`
- `state text NOT NULL`
- `last_occurred_at timestamptz NOT NULL`
- `due_at timestamptz NOT NULL`
- `created_at timestamptz NOT NULL`
- `updated_at timestamptz NOT NULL`
- 唯一键：`(student_id, knowledge_point_ref)`

不在 P1.3-6 落地的字段：

- `stability_days`
- FSRS 参数。
- XP、活动币、游戏解锁。
- 复习 session 排队。

这些字段等待后续规格，不在 P1.3-6 中推断。

## 4. 累计规则

对每条新 evidence：

- `raw_attempt_total += evidence.max_score`
- `raw_correct_total += evidence.earned_score`
- `correct` 的 `earned_score` 必须等于 `max_score`
- `incorrect` 的 `earned_score` 必须等于 `0`
- `skipped` 的 `earned_score` 必须等于 `0`
- `last_occurred_at = evidence.occurred_at`

`mastery_score`：

- 当 `raw_attempt_total > 0` 时，`mastery_score = round(raw_correct_total / raw_attempt_total, 6)`。
- 当 `raw_attempt_total = 0` 时，禁止生成投影。
- `mastery_score` 取值范围必须为 `0..1`。

## 5. 状态阈值

使用下列确定性阈值：

- `learning`: `mastery_score < 0.600000`
- `review`: `0.600000 <= mastery_score < 0.800000`
- `mastered`: `mastery_score >= 0.800000`

`new` 状态只用于尚未产生 evidence 的知识点，不写入 `student_knowledge` 投影行。

## 6. Due Interval

`due_at` 基于首次成功处理该 submit 事务内的数据库权威 `occurred_at` 计算。

间隔：

- `learning`: `occurred_at + interval '1 day'`
- `review`: `occurred_at + interval '3 days'`
- `mastered`: `occurred_at + interval '14 days'`

rounding：

- `mastery_score` 使用 PostgreSQL `round(..., 6)`。
- `due_at` 不做客户端或应用层 rounding，直接保存数据库计算出的 `timestamptz`。

## 7. 幂等与并发

P1.3-6 实现必须满足：

- 每个 `knowledge_evidence.id` 最多累计一次。
- 新增 `student_knowledge_applied_evidence` 或等价 ledger，唯一键为 `evidence_id`。
- 同一 submit replay 不重复累计 `raw_correct_total`、`raw_attempt_total` 或重算 `due_at`。
- 同一学生同一知识点更新时使用 PostgreSQL advisory transaction lock。
- 并发 submit 不允许 lost update。
- evidence、mastery、due、audit、attempt terminal 状态和 submit idempotency 必须在同一事务提交。
- 任一步失败时整体回滚。

## 8. 读取边界

P1.3-6 只允许 Student 读取自己的 mastery/due。

- Student A 不得读取 Student B。
- Guardian 不得从自身 token 推断 Student。
- 如需 Guardian 读取，必须另行实现显式、已验证的 guardian-student 授权上下文。

## 9. 测试门槛

实现 PR 至少覆盖：

- 全对：`mastery_score = 1.000000`，`state = mastered`，`due_at = occurred_at + 14 days`。
- 全错：`mastery_score = 0.000000`，`state = learning`，`due_at = occurred_at + 1 day`。
- skipped：计入 `raw_attempt_total`，不计入 `raw_correct_total`。
- 部分正确：按 `earned_score / max_score` 计算。
- threshold 边界：`0.600000` 进入 `review`，`0.800000` 进入 `mastered`。
- rounding：使用 6 位小数。
- replay：同一 submit/idempotency key 不重复累计。
- 并发：同一学生同一知识点无 lost update。
- rollback：mastery/due 写入失败时 answers、evidence、audit、attempt status、idempotency 全部回滚。
- Trial 隔离：Trial 对 `knowledge_evidence`、`student_knowledge` 和 applied ledger 零副作用。

## 10. 已落地范围

- 数据库迁移已新增 `student_knowledge` 和 `student_knowledge_applied_evidence`。
- 正式 submit 事务会先生成 `knowledge_evidence`，再应用 mastery/due 投影。
- 同一 submit/idempotency replay 不重复累计 evidence。
- 真实 PostgreSQL 回归测试覆盖同一学生同一知识点并发 apply 无 lost update。
- Trial 流程不写入 `knowledge_evidence`、`student_knowledge` 或 applied ledger。
- `GET /api/v1/student-knowledge` 已开放 Student-only 只读 API，只返回已物化的投影行。
- 共享契约新增当前投影 DTO 和列表响应 DTO。

## 11. 未解决问题

- 是否需要为 `knowledge_point_ref` 独立建 `knowledge_points` 目录表，或继续沿用 P1.3 snapshot 中的 text ref。
- 是否要把 `state = new` 物化为行，还是只在读取层按知识点目录补齐。
- 是否需要 Guardian 读取 mastery/due；如需读取，必须另行实现显式、已验证的 guardian-student 授权上下文。
- Demo 的学习任务、复习入口、进度页和游戏解锁不属于本规格 PR，需要在后续 Dev-only Demo 阶段单独实现。
