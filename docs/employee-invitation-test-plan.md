# SIGMA ColorCare — 员工邀请与自动激活测试计划

> 状态：已加入 Firebase Emulator 自动化测试工程；测试尚未执行，不能视为规则已验证或线上已启用。

## 本地测试方式

需要安装 Node.js 与 npm。进入仓库根目录后执行：

```bash
npm install
npm run test:rules
```

脚本会启动 Firestore Emulator，加载仓库根目录的 `firestore.rules`，执行 `tests/firestore.rules.test.mjs`，结束后关闭模拟器。测试项目 ID 使用 `demo-sigma-colorcare`，不会连接真实 Firebase 项目。

## 已编写的自动化用例

| 编号 | 操作 | 预期结果 |
|---|---|---|
| AUTO-01 | 有效管理员创建有效邀请 | 允许 |
| AUTO-02 | 普通 Google 员工创建邀请 | 拒绝 |
| AUTO-03 | Google 员工原子消费邀请并创建 active 员工资料 | 两项写入同时成功 |
| AUTO-04 | 第二个 UID 使用已消费邀请 | 拒绝 |
| AUTO-05 | 非 Google 登录读取邀请 | 拒绝 |
| AUTO-06 | 员工读取本人和他人资料 | 本人允许，他人拒绝 |
| AUTO-07 | 员工尝试修改自己的员工资料 | 拒绝 |

## 必须继续补测的安全场景

| 编号 | 操作 | 预期结果 |
|---|---|---|
| MAN-01 | 使用过期邀请 | 拒绝 |
| MAN-02 | 使用不存在或随机猜测的邀请 ID | 拒绝 |
| MAN-03 | 员工伪造 roleType=0 或 specialRole=true | 拒绝 |
| MAN-04 | 员工把邀请部门改成其他部门 | 拒绝 |
| MAN-05 | 员工删除自己的员工资料 | 拒绝 |
| MAN-06 | 管理员 UID 打开员工邀请链接 | 不消费邀请、不创建员工资料 |
| MAN-07 | 只获授权部门 1 的员工尝试访问部门 2/3 数据 | 拒绝（相关业务集合规则完成后执行） |
| MAN-08 | 事务只写邀请、不创建员工，或只创建员工、不消费邀请 | 拒绝 |

## 测试环境要求

- 使用 Firebase Emulator Suite 的 Firestore；不要连接生产项目。
- 使用独立测试管理员身份和多个独立 Google 测试身份。
- 不使用真实员工资料，不修改线上 Firestore。
- 每次规则变更后重新运行全部自动化用例。
- 并发领取测试应确保同一邀请最多只能被一个 UID 消费。

## 通过标准

- 自动化用例全部通过。
- Firebase Emulator 中 Rules 编译无错误。
- 上述待补测场景完成验证。
- 线上部署前，先向负责人展示最终规则文件和变更内容，并取得明确确认。

## 当前限制

- 本次只建立测试工程，尚未运行 `npm install` 或 `npm run test:rules`，因此没有测试通过结果。
- GitHub 中的 `firestore.rules` 是候选规则，不代表 Firebase Console 中线上规则已经改变。
- 员工邀请目前不能在生产环境使用；必须先在 Emulator 测试并经负责人明确确认部署。
