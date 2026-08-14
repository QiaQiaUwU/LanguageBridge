# -*- coding: utf-8 -*-
"""文章分组 CRUD，对齐前端 readerStore.ts 的 createGroup / renameGroup / deleteGroup。"""
import time
import random
import string
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

from database import tx
from models import ArticleGroupCreate, ArticleGroupOut

router = APIRouter(prefix="/api/article-groups", tags=["article-groups"])


def _gen_id() -> str:
    return f"ag-{int(time.time() * 1000)}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=4))}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_out(row) -> dict:
    return {"id": row["id"], "name": row["name"], "createdAt": row["created_at"], "updatedAt": row["updated_at"]}


@router.get("", response_model=list[ArticleGroupOut])
def list_groups():
    with tx() as conn:
        rows = conn.execute("SELECT * FROM article_groups ORDER BY created_at").fetchall()
        return [_row_to_out(r) for r in rows]


@router.post("", response_model=ArticleGroupOut)
def create_group(payload: ArticleGroupCreate):
    now = _now()
    gid = _gen_id()
    with tx() as conn:
        conn.execute(
            "INSERT INTO article_groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (gid, payload.name.strip() or "未命名分组", now, now),
        )
        row = conn.execute("SELECT * FROM article_groups WHERE id = ?", (gid,)).fetchone()
        return _row_to_out(row)


@router.put("/{group_id}", response_model=ArticleGroupOut)
def upsert_group(group_id: str, payload: ArticleGroupCreate):
    """插入或更新（insert or update），不要求这个 id 已经存在——这跟 articles.py 的 PUT
    是同一个模式。之所以从"只能改名"（要求已存在，不存在就 404）改成真正的 upsert：
    前端 readerStore.createGroup() 的 id 是前端自己生成的（`ag-${Date.now()}-...`），
    不是后端生成的；如果前端想把这个分组同步到后端，用它自己已经生成的 id 直接 PUT
    过来最省事——不然还要另外维护一套"前端 id ↔ 后端 id"的映射表，没必要的复杂度。
    POST 那个接口（后端自己生成 id）还留着，给不在乎具体 id 是什么的调用方用。"""
    now = _now()
    with tx() as conn:
        existing = conn.execute("SELECT created_at FROM article_groups WHERE id = ?", (group_id,)).fetchone()
        created_at = existing["created_at"] if existing else now
        conn.execute(
            """INSERT INTO article_groups (id, name, created_at, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at""",
            (group_id, payload.name.strip() or "未命名分组", created_at, now),
        )
        row = conn.execute("SELECT * FROM article_groups WHERE id = ?", (group_id,)).fetchone()
        return _row_to_out(row)


@router.delete("/{group_id}")
def delete_group(group_id: str):
    """删分组不连带删文章：文章的 group_id 清空，退回"未分组"，避免误删一整批内容。"""
    with tx() as conn:
        conn.execute("UPDATE articles SET group_id = NULL WHERE group_id = ?", (group_id,))
        cur = conn.execute("DELETE FROM article_groups WHERE id = ?", (group_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="分组不存在")
    return {"ok": True}
