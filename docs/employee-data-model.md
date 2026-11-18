# SIGMA ColorCare — 员工资料与邀请数据模型（设计稿）

> 状态：设计阶段；本文件不创建 Firestore 数据、不部署规则，也不改变线上行为。

## 1. 既定角色

- 负责人：沿用现有 `admins/{uid}`，字段 `role=admin`、`status=active`；不迁移、不重建。
- 普通员工：`employees/{uid}`，`roleType=1`。员工只能访问本人获授权部门范围内的数据。
- 特殊岗位：仍是普通员工，不提升为管理员或负责人；由负责人分配/撤销。权限包的具体动作尚未最终定义，因此本阶段不授予额外权限。

## 2. 部门编码（固定）

- 修色：`departmentIds` 包含 `1`；喷色子类型 `101`，手工描绘子类型 `102`。
- 清洗：`departmentIds` 包含 `2`。
- 修织：`departmentIds` 包含 `3`。

修色是独立部门，不属于生产部门。

## 3. 员工文档建议

路径：`employees/{uid}`，文档 ID 必须是 Firebase Authentication 的 UID。

建议字段：

```json
{
  "uid": "Firebase Authentication UID",
  "name": "员工姓名",
  "email": "员工 Google 账号邮箱",
  "roleType": 1,
  "status": "pending",
  "departmentIds": [1],
  "repairTypeIds": [101, 102],
  "specialRole": false,
  "createdAt": "server timestamp",
  "createdBy": "负责人 UID",
  "updatedAt": "server timestamp"
}
```

约束：
- `status` 只允许 `pending`、`active`、`disabled`。
- `departmentIds` 只能包含 1、2、3。
- `repairTypeIds` 只用于修色员工，值只能是 101、102。
- 员工不能自行更改 `roleType`、`status`、部门权限、特殊岗位标记或他人资料。
- 部门授权由负责人修改；历史工单应保留当时的员工 UID 和部门信息，不因后续权限变更而改写。

## 4. 员工业务数据归属

员工可创建/读取的个人业务记录必须包含：
- `employeeUid`：创建该记录的员工 UID；
- `departmentId`：1、2 或 3；
- `createdAt`：服务端时间戳；
- `createdBy`：与登录 UID 一致。

普通员工仅能读取本人记录，不能通过修改前端参数读取他人数据或整体利润。报废申请、QC 送检应以员工 UID 记录提交人；审核动作仅由具备明确审核权限的管理角色执行。

## 5. 邀请二维码/链接

员工使用自己的 Google 账号登录，不使用负责人账号或负责人邮箱密码。

推荐流程：
1. 负责人在管理页面生成限时、单次使用的邀请。
2. 员工扫描二维码/打开链接，使用自己的 Google 账号登录。
3. 服务端验证邀请有效期、使用状态和目标部门，建立 `employees/{uid}`。
4. 按已确认的审核策略，将员工设为 `pending` 或 `active`。

重要安全要求：
- 二维码不能包含管理员凭据、Firebase 私钥或可直接写入任意员工资料的长期密钥。
- 不能仅靠前端隐藏按钮保护邀请或部门权限。
- 单次使用邀请必须由可信服务端原子验证并消费，避免重复使用/竞态。
- 若采用 Cloud Functions，部署可能要求 Blaze 计费计划；在用户明确同意前不启用付费服务。
- 在没有可信服务端或经过严格验证的安全规则前，不开放自助员工建档入口。

## 6. 待最终确认的业务策略

- 新员工 Google 登录后：是否必须由负责人审核激活（建议默认 pending，负责人审核后 active）。
- 特殊岗位固定权限包包含哪些具体动作。
- 各部门工单、报废、QC 送检的最终字段结构及审核角色。

## 7. 实施顺序

1. 先核实 Firestore 当前集合和文档结构；不得覆盖或删除现有数据。
2. 完成员工资料与部门授权字段定稿。
3. 设计并模拟测试 Firestore Rules：管理员兼容现有 `admins/{uid}`；普通员工仅本人、仅授权部门。
4. 再开发员工页面与邀请流程。
5. 规则和邀请流程通过测试、用户明确确认后才部署到 Firebase。
