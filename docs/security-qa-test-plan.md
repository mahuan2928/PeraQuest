# P0 security regression QA plan

基线：`origin/main=6d18d1c`。本 PR 只增加测试，不修改产品逻辑。

## 覆盖范围

- 伪造 `x-student-id`：未知/拼接身份不能读取 capabilities；学生 B 不能提交学生 A 的 trial answer。
- 跨用户 trial/consent：guardian B 不能替学生 A 授权；学生 A 的 consent 不会出现在学生 B 的 capabilities。
- guardian 冒充：minor 仅接受与已持久化 `guardianId` 完全匹配的 `x-guardian-id`。
- 重复/并发：同一 trial question 的并发提交只能成功一次；已有测试覆盖同一学生并发领取 trial 只能成功一次。
- consent guardian_id 持久化：保留为契约测试阻塞项，见下文。

## 阻塞项：consent guardian_id

当前 `StudentRepository.setVoiceConsent(studentId, status, version)` 没有 `guardianId` 参数；`POST/PUT /v1/me/consents/voice-processing` 也只把 student/status/version 写入 repository。虽然数据库 `consent_records.guardian_id` 列已存在，但当前后端接口无法证明它保存了已认证 guardian 身份。

因此本 PR 用 `it.todo` 保留明确的契约测试占位，不伪造通过条件。后端完成接口契约后，应将断言落到 PostgreSQL/PGlite repository：

1. minor A 使用 guardian A grant consent；
2. 查询最新 `consent_records`，断言 `student_id=A`、`guardian_id=A`；
3. guardian B 请求必须 403，且不得产生 consent record；
4. adult consent 的 `guardian_id` 应为 `NULL`（或由产品契约明确其他值）。

## 验证命令

```bash
npm run test -w @peraquest/api
npm run typecheck -w @peraquest/api
```
