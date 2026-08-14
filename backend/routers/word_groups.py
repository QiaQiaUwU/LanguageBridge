# -*- coding: utf-8 -*-
"""
词书（WordGroup）CRUD。跟 article_groups.py 是同一个模式——包括那个"改成真正 upsert"
的教训：前端 id 是自己生成的字符串（book-... 或 book-<时间戳>-<随机串>），PUT 直接拿这个
id 插入或更新，不用后端另外生成 id 再维护一张映射表。parentId 支持树形（一本词书下面
挂章节，章节的 parentId 指回词书自己的 id），这是词书编辑器/阅读页自动分类那一套依赖的
同一个字段，后端原样存、原样吐回去，不在这一层解释"谁是谁的章节"这层语义。
"""
import json
from fastapi import APIRouter, HTTPException

from database import tx
from models import WordGroupSave, WordGroupOut

router = APIRouter(prefix="/api/word-groups", tags=["word-groups"])


def _row_to_out(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "wordIds": json.loads(row["word_ids"]),
        "color": row["color"],
        "parentId": row["parent_id"],
        "order": row["sort_order"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@router.get("", response_model=list[WordGroupOut])
def list_word_groups(parent_id: str | None = None):
    """不传 parent_id 就返回全部；传了就只返回挂在那本词书下面的章节——
    词书编辑器打开一本书时用这个拿它的章节列表。"""
    with tx() as conn:
        if parent_id:
            rows = conn.execute(
                "SELECT * FROM word_groups WHERE parent_id = ? ORDER BY sort_order, created_at", (parent_id,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM word_groups ORDER BY created_at").fetchall()
        return [_row_to_out(r) for r in rows]


@router.get("/{group_id}", response_model=WordGroupOut)
def get_word_group(group_id: str):
    with tx() as conn:
        row = conn.execute("SELECT * FROM word_groups WHERE id = ?", (group_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="词书不存在")
        return _row_to_out(row)


@router.put("/{group_id}", response_model=WordGroupOut)
def save_word_group(group_id: str, payload: WordGroupSave):
    if group_id != payload.id:
        raise HTTPException(status_code=400, detail="URL 里的 id 跟 body 里的 id 对不上")
    with tx() as conn:
        conn.execute(
            """INSERT INTO word_groups
               (id, name, description, word_ids, color, parent_id, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, description=excluded.description, word_ids=excluded.word_ids,
                 color=excluded.color, parent_id=excluded.parent_id, sort_order=excluded.sort_order,
                 updated_at=excluded.updated_at""",
            (
                payload.id,
                payload.name,
                payload.description,
                json.dumps(payload.wordIds, ensure_ascii=False),
                payload.color,
                payload.parentId,
                payload.order,
                payload.createdAt,
                payload.updatedAt,
            ),
        )
        row = conn.execute("SELECT * FROM word_groups WHERE id = ?", (group_id,)).fetchone()
        return _row_to_out(row)


@router.delete("/{group_id}")
def delete_word_group(group_id: str):
    with tx() as conn:
        cur = conn.execute("DELETE FROM word_groups WHERE id = ?", (group_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="词书不存在")
    return {"ok": True}
