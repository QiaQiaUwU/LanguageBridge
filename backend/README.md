# LanguageBridge 后端（第一版：文章 + 分组）

独立后端，不跟 MyLibrary 共用数据库/服务进程。Python + FastAPI + SQLite，单文件数据库
`languagebridge.db`（第一次启动自动建在 `backend/` 目录下）。

## 现状老实说

这份代码是在一个没有网络、装不了 `fastapi`/`uvicorn`/`pydantic`/`mfa`/`ffmpeg` 的沙盒环境里
写的，**没有被真的启动过**。做了几层能力范围内的验证：

1. `python3 -m py_compile` 过了每个文件，排除了缩进/语法错误这类低级问题。
2. 建表 SQL 和 `articles.py`/`article_groups.py` 里的核心 SQL 语句（insert、upsert 的
   update 分支、删分组联动清空文章的 group_id）用标准库 `sqlite3` 单独跑通过了一遍
   （脱离 FastAPI/Pydantic，纯数据层），确认建表不报错、upsert 真的是"更新"不是"插入
   重复行"、JSON 字段（含中文）能正确序列化/反序列化。
3. `audio_align.py` 里解析 TextGrid 的正则、按句子切回时间区间的逻辑，用手造的样例数据
   （一份手写的 Praat TextGrid 文本 + 一组模拟的对齐结果）真跑了一遍，包括"词对不上"那条
   兜底分支——这两块逻辑本身是对的，**但没有拿真实 MFA 跑出来的文件验证过**，MFA 实际
   输出格式跟我照着 Praat 标准格式手写的解析器如果有细节出入，第一次真跑的时候会看出来。

FastAPI 路由本身的写法（`@router.get/put/delete`、`UploadFile`、`FileResponse`、依赖注入）
没有实际跑起来验证过——用的都是很标准的 FastAPI 基础用法，不是什么冷门特性，但你落地后
第一件事应该是真的跑一次，不要假设它一定没问题。`mfa align` 这个外部命令行工具本身完全
没有被调用过一次，它跑不跑得起来、装的模型对不对、参数对不对，都要等你自己装好环境之后
第一次真实调用才知道。

## 安装 & 启动

```bash
cd backend
pip install -r requirements.txt
python main.py
```

监听 `127.0.0.1:8787`。

## 验收步骤（按顺序做一遍）

```bash
# 1. 健康检查
curl http://127.0.0.1:8787/api/health
# 期望: {"ok":true}

# 2. 建一个分组
curl -X POST http://127.0.0.1:8787/api/article-groups \
  -H "Content-Type: application/json" \
  -d '{"name":"测试分组"}'
# 期望: 返回 {"id":"ag-...","name":"测试分组",...}，记下这个 id

# 3. 存一篇文章（把上一步的分组 id 填进 groupId，article-1 是自己起的id，随便起）
curl -X PUT http://127.0.0.1:8787/api/articles/article-1 \
  -H "Content-Type: application/json" \
  -d '{
    "id": "article-1",
    "title": "测试文章",
    "sentences": [{"en": "Hello world.", "zh": "你好，世界。"}],
    "groupId": "上一步返回的id",
    "createdAt": "2026-07-19T00:00:00Z",
    "updatedAt": "2026-07-19T00:00:00Z"
  }'
# 期望: 返回刚存的文章完整内容

# 4. 查列表
curl http://127.0.0.1:8787/api/articles
# 期望: 数组里能看到刚才那篇

# 5. 再 PUT 一次同样的 id、改一下 title，验证是更新不是重复插入
curl -X PUT http://127.0.0.1:8787/api/articles/article-1 -H "Content-Type: application/json" -d '{...改了title...}'
curl http://127.0.0.1:8787/api/articles
# 期望: 列表里还是只有一条，title 是改过的

# 6. 删除
curl -X DELETE http://127.0.0.1:8787/api/articles/article-1
curl http://127.0.0.1:8787/api/articles
# 期望: 列表空了
```

如果要验收音频上传/对齐这块（前提是按下面「强制对齐」那节把 MFA/ffmpeg 装好了）：

```bash
# 0. 先按上面 1-3 步存一篇有内容的文章，比如 sentences 是 [{"en":"Hello world."},{"en":"Nice to meet you."}]
#    这篇文章要配一段真实录音，句子文本必须跟录音内容完全一致（哪怕差一个词，对齐都可能从那开始跑偏）

# 1. 上传音频（换成你自己的音频文件路径）
curl -X POST http://127.0.0.1:8787/api/articles/article-1/audio \
  -F "file=@/path/to/your-audio.mp3"
# 期望: {"audioFileName": "article-1.mp3"}

# 2. 触发对齐（这一步会真的跑 ffmpeg 转码 + mfa align，视音频长度可能要等几十秒到几分钟）
curl -X POST http://127.0.0.1:8787/api/articles/article-1/align
# 期望: 返回 {"sentences": [...]}，每句都带上了 audioStart/audioEnd（单位秒）
#       如果某句多了个 _alignNote 字段，说明从那句起词对不上了，需要人工核对音频和文本

# 3. 确认真的存进 DB 了
curl http://127.0.0.1:8787/api/articles/article-1
# 期望: sentences 里的 audioStart/audioEnd 还在（不是只在上一步的返回体里昙花一现）
```

也可以直接打开 `http://127.0.0.1:8787/docs`——FastAPI 自带 Swagger 交互式文档，比敲
curl 更直观，能在网页上直接试每个接口。

## 接口列表

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/articles` | 文章列表，可选 `?group_id=xxx` 筛选 |
| GET | `/api/articles/{id}` | 单篇文章 |
| PUT | `/api/articles/{id}` | 保存文章（insert or update，前端 `readerStore.saveArticle` 对应这个） |
| DELETE | `/api/articles/{id}` | 删文章 |
| GET | `/api/article-groups` | 分组列表 |
| POST | `/api/article-groups` | 新建分组 |
| PUT | `/api/article-groups/{id}` | 改分组名 |
| DELETE | `/api/article-groups/{id}` | 删分组（文章不会被连带删除，group_id 会清空） |
| POST | `/api/articles/{id}/audio` | 上传/替换这篇文章的音频（multipart，字段名 `file`） |
| GET | `/api/articles/{id}/audio` | 下载/播放这篇文章存的音频 |
| DELETE | `/api/articles/{id}/audio` | 删掉这篇文章关联的音频文件 |
| POST | `/api/articles/{id}/align` | 触发一次 MFA 强制对齐，把结果写回 `sentences[].audioStart/audioEnd` |
| GET | `/api/todos` | 待办列表 |
| POST | `/api/todos` | 新建待办（`text` + 可选 `due`） |
| PATCH | `/api/todos/{id}` | 局部更新（改文字/日期/打勾状态） |
| DELETE | `/api/todos/{id}` | 删待办 |
| GET | `/api/words` | 单词列表，可选 `?group_id=xxx` 筛选 |
| GET | `/api/words/{id}` | 单个单词 |
| PUT | `/api/words/{id}` | 保存单词（insert or update，前端 `wordStore.addWord`/`updateWordFields` 对应这个） |
| DELETE | `/api/words/{id}` | 删单词 |
| GET | `/api/word-groups` | 词书列表，可选 `?parent_id=xxx` 只看某本词书下面的章节 |
| GET | `/api/word-groups/{id}` | 单本词书 |
| PUT | `/api/word-groups/{id}` | 保存词书（insert or update，`parentId` 支持章节挂在词书下面） |
| DELETE | `/api/word-groups/{id}` | 删词书（词本身不会被连带删除） |
| GET | `/api/activity` | 每日活动列表（打卡/热力图数据），备着给以后"从后端恢复"用 |
| PUT | `/api/activity/{date}` | 保存某天的活动记录（insert or update，整条覆盖，不是局部字段更新） |
| GET | `/api/habits` | 习惯列表 |
| PUT | `/api/habits/{id}` | 保存习惯（insert or update，id 前端生成） |
| DELETE | `/api/habits/{id}` | 删习惯（连带清空这个习惯的打卡记录） |
| POST | `/api/habits/{id}/checkin` | 打卡（同一习惯同一天重复打卡是幂等的，不报错） |

## 强制对齐：装好 MFA 才能用 `/align` 这个接口

`/api/articles/{id}/align` 依赖 **Montreal Forced Aligner (MFA)**，这是目前学术验证最
充分的强制对齐方案（2026 年 Interspeech 论文：平均边界误差 <15ms），但它**不是 pip 包**，
装的地方也不在 `requirements.txt` 里——要单独通过 conda/mamba 装：

```bash
# 1. 装 MFA（会连带装 Kaldi），装完新开一个 conda 环境专门放它，别跟别的 conda 环境混
conda create -n aligner -c conda-forge montreal-forced-aligner
conda activate aligner

# 2. 下载英语声学模型 + 发音词典（第一次要联网下载，几百MB）
mfa model download acoustic english_us_arpa
mfa model download dictionary english_us_arpa

# 3. 验证装对了
mfa align --help
```

跑 `python main.py` 的时候，要在**装了 MFA 的那个 conda 环境里**（`conda activate aligner`
之后），`mfa` 这个命令得能在 PATH 里直接找到，`/align` 接口内部是拿 `subprocess` 去调
`mfa align` 这个命令行工具，不是当 Python 库导入的。

另外还需要 **ffmpeg** 在 PATH 上（对齐前会把音频统一转成 16kHz 单声道 wav），Windows 上
没装过的话去 ffmpeg 官网下二进制解压加到 PATH，或者 `conda install ffmpeg` 装在同一个
环境里最省事。

这两个依赖这个写代码的沙盒环境都没有、也没法安装/验证，`audio_align.py` 里的 TextGrid
解析逻辑是照着 Praat TextGrid 的标准文本格式手写的正则，**用手造的样例数据测过解析逻辑本身
是对的**，但没有拿真实 MFA 跑出来的文件验证过——第一次真正跑通 `/align` 之后，
最值得看一眼的是返回体里每句有没有正常出现 `audioStart`/`audioEnd`，如果某句开始
多出一个 `_alignNote` 字段，说明从那句起词对不上了（常见原因是音频和文本本身有出入），
不是接口报错，是它老实告诉你"对到这就断了"。

## 前端接了到什么程度

**文章 + 分组：接了，双写模式。** `readerStore.ts` 现在存/删文章和分组时，IndexedDB 还是
照旧先写（这个必须成功，是保底），成功之后再"顺手"往这个后端也写一份（`shared/core/
backendClient.ts`），后端连不上/没启动就静默失败，不会让 IndexedDB 那次写也跟着失败——
本地优先，后端是加分项不是必需依赖。**读取现在还是只认 IndexedDB**，没有做"从后端合并
数据"这一步，避免一上来就处理两份数据谁为准的冲突逻辑。

这意味着：现在这一版，后端更多是"每次改动顺手留一份备份"，还不是真正意义上换设备能同步
的跨端存储——要做到那样，还需要"打开 app 时从后端拉一次、跟本地 IndexedDB 合并/对比更新
时间"这一层，这次没做，先把最容易出问题的双向合并逻辑放一放，只做单向的"能连上就往后端
写一份"。

分组这块为了让前端自己生成的 id 能直接同步过去，把 `PUT /api/article-groups/{id}` 从
"必须已存在，否则 404"改成了真正的 upsert（不存在就插入，存在就更新）——这个改动同时用
标准库 `sqlite3` 单独验证过（新建/改名两种情况，确认不会插入重复行，`created_at` 保留、
`updated_at` 刷新）。

**待办事项：接了。** 一开始故意没接是因为后端 `todos` 表用的是数据库自增 id、前端
IndexedDB 里的待办 id 是 IndexedDB 自己的自增机制，两边各算各的会对不上号——后来把
`TodoSave`/`PUT /api/todos/{id}` 改成接受前端指定 id（前端先在 IndexedDB 插入拿到 id，
再拿这个 id 去 PUT，两边用同一个 id），这条就通了，`studyTodos.ts` 现在双写。

**打卡记录（activity）+ 学习习惯（habits）：接了，双写模式，id 方案跟待办同一个思路。**
`activity` 表以日期字符串为主键，`shared/core/activityLog.ts` 的 `recordWordLearned`/
`recordReview`/`recordActiveMinute` 每次都是"整条读出来改一个字段再整条存回去"，所以
`PUT /api/activity/{date}` 也是整条 upsert，不是局部字段更新。`habits`/`habit_log` 两张
表则是照 `todos` 的思路：id 用 IndexedDB 自增分配的那个，`studyTodos.ts` 里
`addHabit`/`deleteHabit`/`checkinHabit` 都已经双写；打卡本身天然要求"同一习惯同一天只记
一次"，后端靠 `UNIQUE(habit_id, date)` 约束保证幂等，重复打卡不报错、只是告诉调用方这次
没有新插入。

**单词/词书：接了，双写模式，跟文章/分组同一套逻辑。** `wordStore.ts` 的 `addWord`/
`updateWordFields`/`deleteWord`/`memorizeWord`/`updateLearningRecord`/`setWordStatus`
和 `createGroup`/`updateGroup`/`deleteGroup`/`addWordToGroup`/`removeWordFromGroup`
这些单条操作都已经双写了。**故意没接的是批量导入**（`importWordsAsGroup`/
`importFullLibrary`/`dedupeWords`）——这几个一次可能涉及几十到几千个词，真要每条都单独
打一次后端请求，后端不在线时几千次 fetch 超时排队会让导入卡很久，后端在线的话一股脑塞
几千个请求也可能把 SQLite 写爆。要接的话应该给后端加一个专门的批量 upsert 接口（一次
请求传一整个数组），不是在前端循环里调用单条写入的函数——这次没做，批量导入的词目前
只会进 IndexedDB，不会同步到后端，等你下次单条编辑那个词（比如改个释义）才会补一份过去。

对应的 `words`/`word_groups` 两张表和路由是照 `articles`/`article_groups` 一样的模式写的
（PUT 是 insert or update，id 前端生成），SQL 层面的 upsert 逻辑同样用 `sqlite3` 单独
验证过（新增/编辑不重复插入、JSON 字段能正确读写、`word_groups` 的 `parent_id` 章节
查询能正确返回）。嵌套字段（`meanings`/`common_phrases`/`synonyms` 等）在后端故意没有
逐层建模，用的是松散的 dict 透传——这些字段形状复杂、可选项多，后端只是原样存、原样吐
回去，不当这些嵌套形状的校验守门员。

## 后面要扩的（这版没做）

- 批量导入接后端（需要先加一个批量 upsert 接口，见上面「前端接了到什么程度」那节）
- 读取时的双向合并（现在只有"写"这一侧同步了，换设备/换浏览器打开还是只看 IndexedDB，
  看不到只存在后端那份的数据——这个需要处理"两边都改过、听谁的"这类冲突，比单向写麻烦不少）
- AI 工具调用做在后端这一层（让 agent 能直接建带日期的待办，参照
  `MyLibrary_v4_7_4_patched/mylib/agents/quill_agent.py` 里 `_tool_todo_add` 的写法）。
  注意这跟前端 `shared/core/aiClient.ts` 里已经做的工具调用不是一回事——那个是浏览器直接
  调 AI 服务商的 API，不经过这个 Python 后端，两条线独立存在。

`routers/todos.py`、`routers/audio.py` + `audio_align.py`、`routers/activity.py`、
`routers/habits.py` 都已经在这份代码里了，见上面的接口列表——这份文档之前有过几次\"没跟上
代码\"的情况（写着某项没做，其实早接完了），发现的时候都在这份文档里当场改掉，不留旧的
\"没做\"说法在旁边跟新代码打架。

