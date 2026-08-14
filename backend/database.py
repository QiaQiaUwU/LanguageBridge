# -*- coding: utf-8 -*-
"""
SQLite 连接与建表。

参照 MyLibrary 的 database.py 用同样的思路：WAL 模式 + check_same_thread=False，
因为 FastAPI 默认用线程池处理请求，多个请求可能并发读写同一个连接，WAL 模式下
读不会被写阻塞，配 busy_timeout 让偶尔的写锁冲突自动重试而不是直接报错。

全局只开一个连接，不是每次请求都开关——SQLite 单文件场景下频繁开关连接反而更容易
撞上锁，一个长连接 + WAL 是更稳的做法。
"""
import sqlite3
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).resolve().parent / "languagebridge.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  raw_english TEXT NOT NULL DEFAULT '',
  sentences TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  notes TEXT NOT NULL DEFAULT '',
  recite_draft TEXT NOT NULL DEFAULT '',
  needs_cleanup INTEGER NOT NULL DEFAULT 0,
  group_id TEXT,
  bookmarked INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  marks TEXT NOT NULL DEFAULT '[]',
  chapters TEXT NOT NULL DEFAULT '[]',
  audio_file_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_group ON articles(group_id);
CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  due TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  phonetic TEXT NOT NULL DEFAULT '',
  status TEXT,
  group_id TEXT,
  meanings TEXT NOT NULL DEFAULT '[]',
  level TEXT NOT NULL DEFAULT '',
  source TEXT,
  audio_url TEXT,
  learning_record TEXT,
  tags TEXT,
  is_custom INTEGER NOT NULL DEFAULT 0,
  morphology TEXT,
  etymology TEXT,
  memory_tips TEXT,
  common_phrases TEXT,
  synonyms TEXT,
  antonyms TEXT,
  word_family TEXT,
  example_sentences TEXT,
  detailed_explanation TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  word_ids TEXT NOT NULL DEFAULT '[]',
  color TEXT,
  parent_id TEXT,
  sort_order INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_words_updated ON words(updated_at);
CREATE INDEX IF NOT EXISTS idx_words_group ON words(group_id);
CREATE INDEX IF NOT EXISTS idx_word_groups_parent ON word_groups(parent_id);

CREATE TABLE IF NOT EXISTS activity (
  date TEXT PRIMARY KEY,
  new_words INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  minutes_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  goal INTEGER NOT NULL DEFAULT 21,
  medal_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  UNIQUE(habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_habit_log_habit ON habit_log(habit_id);
"""

_conn: "sqlite3.Connection | None" = None


def _migrate(conn: sqlite3.Connection) -> None:
    """`CREATE TABLE IF NOT EXISTS` 只对全新数据库有效——如果 articles 表在旧版本代码下已经
    建过（这台机器之前跑过没有 chapters 字段的版本），SCHEMA 里新加的这一列不会自动补上去，
    第一次真正 SELECT/INSERT 到这一列时会报 `no such column`。这里用 PRAGMA table_info 查一下
    实际列有没有，缺了就用 ALTER TABLE 补一列，全新数据库（本来就有这一列）这段直接跳过。"""
    existing_cols = {row["name"] for row in conn.execute("PRAGMA table_info(articles)").fetchall()}
    if existing_cols and "chapters" not in existing_cols:
        conn.execute("ALTER TABLE articles ADD COLUMN chapters TEXT NOT NULL DEFAULT '[]'")
    conn.commit()


def get_conn() -> sqlite3.Connection:
    """拿全局共享连接，第一次调用时顺便建表。"""
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=30)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode = WAL")
        _conn.execute("PRAGMA synchronous = NORMAL")
        _conn.execute("PRAGMA busy_timeout = 30000")
        _conn.executescript(SCHEMA)
        _conn.commit()
        _migrate(_conn)
    return _conn


@contextmanager
def tx():
    """小事务上下文管理器：正常退出就 commit，抛异常就 rollback。
    路由里 `with tx() as conn:` 就不用每个路由自己写 try/except/commit。"""
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
