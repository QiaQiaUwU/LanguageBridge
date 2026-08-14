# -*- coding: utf-8 -*-
"""
文章 CRUD。这是前端 shared/core/database.ts（IndexedDB 里的 wordDB.saveArticle /
getAllArticles / deleteArticle）未来接后端时最直接能替换的那一层——
接口形状特意跟前端 readerStore.ts 现有的调用方式对齐，把 IndexedDB 换成打 /api/articles
基本不用改前端的业务逻辑，只用改数据存取那几行。
"""
import json
from fastapi import APIRouter, HTTPException

from database import tx
from models import ArticleSave, ArticleOut

router = APIRouter(prefix="/api/articles", tags=["articles"])


def _row_to_out(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "rawEnglish": row["raw_english"],
        "sentences": json.loads(row["sentences"]),
        "source": row["source"],
        "sourceUrl": row["source_url"],
        "notes": row["notes"],
        "reciteDraft": row["recite_draft"],
        "needsCleanup": bool(row["needs_cleanup"]),
        "groupId": row["group_id"],
        "bookmarked": bool(row["bookmarked"]),
        "completed": bool(row["completed"]),
        "marks": json.loads(row["marks"]),
        "chapters": json.loads(row["chapters"]),
        "audioFileName": row["audio_file_name"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@router.get("", response_model=list[ArticleOut])
def list_articles(group_id: str | None = None):
    """不传 group_id 就返回全部；传了就只返回那个分组下的（列表页按分组筛选用得到）。"""
    with tx() as conn:
        if group_id:
            rows = conn.execute(
                "SELECT * FROM articles WHERE group_id = ? ORDER BY updated_at DESC", (group_id,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM articles ORDER BY updated_at DESC").fetchall()
        return [_row_to_out(r) for r in rows]


@router.get("/{article_id}", response_model=ArticleOut)
def get_article(article_id: str):
    with tx() as conn:
        row = conn.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="文章不存在")
        return _row_to_out(row)


@router.put("/{article_id}", response_model=ArticleOut)
def save_article(article_id: str, payload: ArticleSave):
    """整篇覆盖式保存，insert or replace：id 不存在就当新建，存在就整体更新。
    对齐前端 readerStore.saveArticle() 的语义——那边每次都传完整对象，不是局部 patch，
    这里也不用先查一次"存过没"再决定 insert 还是 update。"""
    if article_id != payload.id:
        raise HTTPException(status_code=400, detail="URL 里的 id 跟 body 里的 id 对不上")
    with tx() as conn:
        conn.execute(
            """INSERT INTO articles
               (id, title, raw_english, sentences, source, source_url, notes, recite_draft,
                needs_cleanup, group_id, bookmarked, completed, marks, chapters, audio_file_name, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 title=excluded.title, raw_english=excluded.raw_english, sentences=excluded.sentences,
                 source=excluded.source, source_url=excluded.source_url, notes=excluded.notes,
                 recite_draft=excluded.recite_draft, needs_cleanup=excluded.needs_cleanup,
                 group_id=excluded.group_id, bookmarked=excluded.bookmarked, completed=excluded.completed,
                 marks=excluded.marks, chapters=excluded.chapters, audio_file_name=excluded.audio_file_name,
                 updated_at=excluded.updated_at""",
            (
                payload.id,
                payload.title,
                payload.rawEnglish,
                json.dumps([s.model_dump() for s in payload.sentences], ensure_ascii=False),
                payload.source,
                payload.sourceUrl,
                payload.notes,
                payload.reciteDraft,
                int(payload.needsCleanup),
                payload.groupId,
                int(payload.bookmarked),
                int(payload.completed),
                json.dumps([m.model_dump() for m in payload.marks], ensure_ascii=False),
                json.dumps([c.model_dump() for c in payload.chapters], ensure_ascii=False),
                payload.audioFileName,
                payload.createdAt,
                payload.updatedAt,
            ),
        )
        row = conn.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
        return _row_to_out(row)


@router.delete("/{article_id}")
def delete_article(article_id: str):
    with tx() as conn:
        cur = conn.execute("DELETE FROM articles WHERE id = ?", (article_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="文章不存在")
    return {"ok": True}
