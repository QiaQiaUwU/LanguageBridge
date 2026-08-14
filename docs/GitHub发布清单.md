# GitHub 发布清单

## 一、仓库 About（右上角齿轮里填）

**Description**（255 字符以内，中英各给一版，选一个填）：

```
本地运行的英语学习工作台：3D 词汇关系图、整本书导入与逐句对照、打字与听写练习。数据全部在本地。
```

```
A local-first English learning workspace: 3D vocabulary graph, whole-book import with sentence alignment, typing and dictation practice. All data stays on your machine.
```

**Website**：留空，或填演示视频链接。

**Topics**（点 Description 下面的齿轮添加，建议这些）：

```
english-learning  vocabulary  spaced-repetition  fsrs  typing-practice
vue3  typescript  three-js  force-graph  indexeddb
local-first  offline-first  fastapi  language-learning
```

---

## 二、发布前检查

```bash
# 1. 确认个人数据没被带进去
git status --porcelain
git check-ignore -v resources data          # 应该都被忽略

# 2. 全文扫一遍 API key（应该没有任何输出）
grep -rInE "sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*['\"][^'\"]{16,}" \
  --include='*.ts' --include='*.vue' --include='*.js' --include='*.py' \
  apps shared src backend scripts

# 3. 构建能过
npm run check && npm run build
```

第 2 步如果有输出，先处理再提交。这个项目的 key 存在浏览器 localStorage，源码里不该出现。

---

## 三、首次上传

```bash
git init
git branch -M main
git add .
git commit -m "feat: LanguageBridge 初始提交"

# 在 GitHub 上新建空仓库（不要勾选 README / .gitignore / License），然后：
git remote add origin https://github.com/<你的用户名>/LanguageBridge.git
git push -u origin main
```

后续更新：

```bash
git add .
git commit -m "fix: 修复听写页快捷键吃掉字母输入"
git push
```

---

## 四、提交信息写法

用 Conventional Commits，好处是以后能自动生成变更日志：

| 前缀 | 用在什么改动 | 例子 |
| --- | --- | --- |
| `feat` | 新功能 | `feat: 词汇宇宙支持三层钻取` |
| `fix` | 修 bug | `fix: 快捷键 KeyR 吃掉字母输入` |
| `perf` | 性能 | `perf: 关系图只渲染核心词，节点数 5321 → 538` |
| `refactor` | 重构，行为不变 | `refactor: 数据库连接改为模块级单例` |
| `docs` | 文档 | `docs: 重写 README` |
| `chore` | 杂项、依赖 | `chore: 升级 vite 到 5.x` |

---

## 五、Release 说明模板

打 tag 发版时用：

```markdown
## v0.1.0

首个公开版本。

### 主要功能
- **词汇宇宙** — 3D 力导向关系图，大类 → 话题 → 词族三层钻取
- **阅读助手** — 整本书导入自动分章，中英逐句对照，影子跟读
- **学习 / 打字** — 逐字符判定，FSRS 排期
- **听写检测** — 单词 / 列表两种模式，错词本闭环

### 使用
Windows 用户下载 `LanguageBridge-win.zip`，解压后双击 `LanguageBridge.vbs`。
其他平台需要 Node.js 18+，`npm install && npm start`。

### 说明
词库与学习记录不包含在发布包里，首次使用需要自己导入。
```

```bash
git tag -a v0.1.0 -m "首个公开版本"
git push origin v0.1.0
```

---

## 六、建议补上的文件

| 文件 | 作用 | 优先级 |
| --- | --- | --- |
| `LICENSE` | 没有 License 的仓库默认保留所有权利，别人不能合法使用 | 高 |
| `docs/screenshots/` | README 里引用的截图，现在是空目录 | 高 |
| `.github/ISSUE_TEMPLATE/bug_report.md` | 让别人报 bug 时带上版本和复现步骤 | 中 |
| `CHANGELOG.md` | 版本变更记录 | 低 |

MIT License 全文可以直接从 <https://choosealicense.com/licenses/mit/> 复制，把年份和名字换成自己的。

---

## 七、截图清单

README 里现在引用了 `docs/screenshots/universe.png`。建议至少准备这几张：

| 文件名 | 拍什么 | 要点 |
| --- | --- | --- |
| `universe.png` | 词汇宇宙全景，最好有一团高亮着 | 这是最有辨识度的一张，放最前面 |
| `home.png` | 主页 | 能看到总词库数和当日任务 |
| `reading.png` | 阅读助手，左侧章节目录 + 右侧中英对照 | 体现「整本书」这个卖点 |
| `typing.png` | 打字练习，正在输入、有绿色已打字母 | 体现逐字符判定 |
| `dictation.png` | 听写页 | |

截图前把窗口调到 1440×900 左右，比 1920 宽的截图在 README 里会被压得看不清。
