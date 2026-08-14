# -*- coding: utf-8 -*-
"""
LanguageBridge 后端入口。

启动：
    pip install -r requirements.txt
    python main.py

默认监听 0.0.0.0:8787（同一局域网内的手机也能连，不止本机）。前端要接这个后端的话，
最简单是在 vite.config.ts 里加一条 /api 的 proxy 转发到这个端口（跟 dev server 同源，
不用处理 CORS），或者前端直接 fetch('http://127.0.0.1:8787/api/...')（本机访问用
127.0.0.1 就够，手机访问要换成这台电脑的局域网 IP，那就要靠下面这段 CORSMiddleware 放行）。

这个对话的沙盒环境没有网络，装不了 fastapi/uvicorn/pydantic，所以这份代码没有被
实际启动测试过——写的时候尽量对齐 MyLibrary 已经跑通的模式（WAL 模式的 SQLite、
sqlite3.Row、单个线程安全长连接），但落地之后第一件事应该是真的跑一次
`python main.py`，再照 README.md 里的验收步骤走一遍，不要假设它一定是对的。
"""
import sys

try:
    import uvicorn
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
except ImportError:
    print("需要先安装依赖: pip install -r requirements.txt")
    print("（包含 fastapi、uvicorn、pydantic、python-multipart——最后这个容易漏，"
          "音频上传接口运行时需要它，不装的话平时看不出问题，一调那个接口才报错）")
    sys.exit(1)

from database import get_conn
from routers import articles, article_groups, todos, audio, words, word_groups, activity, habits

app = FastAPI(title="LanguageBridge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本地单机/局域网用，先放开；真要收紧再改成具体的前端地址
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(articles.router)
app.include_router(article_groups.router)
app.include_router(todos.router)
app.include_router(audio.router)
app.include_router(words.router)
app.include_router(word_groups.router)
app.include_router(activity.router)
app.include_router(habits.router)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.on_event("startup")
def on_startup():
    get_conn()  # 启动时就建好表，不等第一个请求进来才建


if __name__ == "__main__":
    # 绑定 0.0.0.0（不是 127.0.0.1）——参照 MyLibrary 的做法，默认监听所有网卡，
    # 这样手机在同一个 WiFi 下访问这台电脑的局域网 IP（比如 http://192.168.x.x:8787）才连得上；
    # 只绑 127.0.0.1 的话只有这台电脑自己能连，手机连不上，"手机连接"这个一直在提的
    # 使用场景就直接断了。前端目前写死的是 127.0.0.1:8787，这条不受影响——0.0.0.0
    # 本来就包含 127.0.0.1，只是同时多开放了局域网 IP 这条路，不是二选一。
    uvicorn.run(app, host="0.0.0.0", port=8787)
