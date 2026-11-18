# SIGMA ColorCare — 员工资料与邀请数据模型（设计稿）

> 状态：数据模型已实现为代码草案；GitHub 中的代码和规则尚未部署到 Firebase，线上行为未改变。

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
  "status": "active",
  "departmentIds": [1],
  "repairTypeIds": [101, 102],
  "specialRole": false,
  "createdAt": "server timestamp",
  "createdBy": "负责人 UID",
  "updatedAt": "server timestamp"
}
```

约束：
- `status` 只允许 `active`、`disabled`。通过有效邀请完成首次注册后自动设为 `active`；负责人可在管理端停用账号。
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
3. 验证邀请有效期、使用状态和目标部门后，建立 `employees/{uid}`。
4. 员工无需负责人二次审核，建档后自动设为 `active`。没有有效邀请的账号不得自动获得员工权限。

重要安全要求：
- 二维码只包含随机 256-bit 邀请标识的加入链接，不包含管理员凭据或 Firebase 私钥；邀请有效期 24 小时。
- 当前实现采用 Firestore Security Rules + 客户端 Firestore transaction：事务必须同时将邀请从 active 改为 used，并创建对应 employees/{uid}；规则使用 getAfter/existsAfter 验证两项写入必须成对发生。
- 邀请仅允许 Google 登录且邮箱已验证的账号领取；邀请文档只允许按随机 ID 精确读取，不能列出。
- 员工部门权限从邀请文档复制，客户端不能自行指定；同一邀请不能被第二个 UID 使用。
- 负责人创建邀请受 isAdmin() 规则保护；员工资料创建受 invitationId、UID、Google 邮箱、部门列表和状态字段约束。
- 当前流程不需要 Cloud Functions；仍须先在 Firebase Emulator 中测试规则，再由用户确认后部署。

## 6. 已确认与待确认事项

已确认：员工使用自己的 Google 账号，通过负责人提供的有效邀请加入；注册成功后自动激活，不需要负责人二次审核。

仍待确认：
- 特殊岗位固定权限包包含哪些具体动作。
- 各部门工单、报废、QC 送检的最终字段结构及审核角色。

## 7. 当前代码实现状态

- 登录页已增加负责人专用的员工邀请面板，可选择一个或多个部门并生成 24 小时有效的 QR 邀请链接。
- 邀请 ID 使用浏览器密码学安全随机数生成，长度为 256 bit。
- 员工扫描链接后使用自己的 Google 账号登录；登录回跳后以 Firestore transaction 原子消费邀请并创建 active 员工资料。
- 员工只能领取一次邀请；员工部门入口按 employees/{uid}.departmentIds 显示。
- Firestore Rules 已加入邀请创建、精确读取、一次性消费和员工资料原子创建的规则草案。
- 规则文件只提交到 GitHub，尚未部署到 Firebase；员工邀请目前不能在线上使用。

## 8. 下一步验证

1. 使用 Firebase Emulator 测试规则编译和权限：管理员创建邀请、有效 Google 员工领取、重复领取、过期邀请、非 Google 登录、员工伪造部门/角色、员工读取他人资料。
2. 验证 transaction 在 Firestore Rules 下通过，尤其是 getAfter/existsAfter 的双文档原子约束。
3. 测试通过后，向用户展示规则差异和部署步骤；只有用户明确确认后才部署线上 Firestore Rules。

## 9. 负责人端员工管理

负责人首页提供员工目录，可读取员工姓名、邮箱、部门和状态。负责人可以：
- 为员工增加或撤销部门授权；修色部门对应子类型固定为喷色 101、手工描绘 102。
- 停用或恢复员工在 ColorCare 系统中的访问状态。
- 不允许通过员工管理界面修改员工 UID、roleType、邮箱、邀请来源或创建信息。
- 特殊岗位标记暂不开放修改，固定权限包内容确认前不赋予特殊权限。

停用当前仅将 `employees/{uid}.status` 设置为 `disabled`，应用登录检查会拒绝该员工进入系统；这不等同于在 Firebase Authentication 中禁用账号。员工管理界面和对应规则尚需在用户确认后部署到线上 Firestore Rules，部署前不能在线上使用。

## 10. 修色工单第一版

### 录入粒度
采用“每批货物一张工单”，避免不同订单、款号、颜色或处理类型混在同一笔数据里。每日喷色/手工描绘数量由批次工单自动汇总，不再要求员工重复录入一份日总数。

### 集合与字段
路径：`repairWorkOrders/{autoId}`

- `employeeUid`、`createdBy`：必须等于当前登录员工 UID。
- `departmentId`：固定为修色部门 `1`。
- `repairTypeId`：喷色 `101` 或手工描绘 `102)，并且必须在员工当前授权的 `repairTypeIds` 中。
- `workDate`：越南当地作业日期，格式 `YYYY-MM-DD`。
- `orderNo`、`styleNo`、`color`：可选文字字段。
- `quantity`：正整数，最大 1,000,000。
- `note`：可选备注。
- `status`：提交后固定为 `submitted`。
- `createdAt`：必须使用服务端时间戳。

### 权限
- 员工只能为本人创建工单，且必须仍处于 active 状态并拥有修色部门及对应子类型权限。
- 员工只能查询本人修色工单；负责人可读取全部修色工单。
- 工单提交后员工不可修改或删除，避免事后篡改数量；更正流程需后续设计独立冲正/调整记录。
- 本阶段不自动扣减库存、不代表 QC 合格，也不开放 QC 审核；后续以独立 QC 送检记录衔接，避免把“已修色”误当成“已验收”。

### 页面
- 修色部门员工可按批次提交工单。
- 页面按作业日期及喷色/手工描绘类型汇总数量，并显示最近工单。
- 负责人可查看全部修色工单；员工只能查看自己的工单。
- 清洗与修织工单页面尚未开放。
