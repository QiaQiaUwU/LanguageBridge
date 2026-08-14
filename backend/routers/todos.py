# -*- coding: utf-8 -*-
"""
待办事项 CRUD。对齐前端 shared/core/studyTodos.ts 的 getTodos/addTodo/toggleTodo/deleteTodo。
id 是数据库自增的整数（前端原来用 IndexedDB 的 autoIncrement），不是前端生成——
这点跟 articles/article_groups 不一样，那两个是前端自己生成字符串 id。
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

from database import tx
from models import TodoCreate, TodoSave, TodoPatch, TodoOut

router = APIRouter(prefix="/api/todos", tags=["todos"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_out(row) -> dict:
    return {"id": row["id"], "text": row["text"], "due": row["due"], "done": bool(row["done"]), "createdAt": row["created_at"]}


@router.get("", response_model=list[TodoOut])
def list_todos():
    """排序对齐前端 getTodos() 的逻辑：没做完的排前面，同状态内按截止日期排序（没有 due 的排最后）。"""
    with tx() as conn:
        rows = conn.execute(
            "SELECT * FROM todos ORDER BY done ASC, CASE WHEN due = '' THEN '9999' ELSE due END ASC"
        ).fetchall()
        return [_row_to_out(r) for r in rows]


@router.post("", response_model=TodoOut)
def create_todo(payload: TodoCreate):
    text = payload.text.strip()[:200]
    if not text:
        raise HTTPException(status_code=400, detail="待办内容不能为空")
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO todos (text, due, done, created_at) VALUES (?, ?, 0, ?)",
            (text, payload.due, _now()),
        )
        row = conn.execute("SELECT * FROM todos WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_out(row)


@router.put("/{todo_id}", response_model=TodoOut)
def save_todo(todo_id: int, payload: TodoSave):
    """给前端双写用：前端待办的 id 来自 IndexedDB 自增（wordDB.addTodo 的返回值），
    这里直接拿这个 id 插入或更新，两边就不会各算各的 id 了。跟 POST 的区别：POST 不关心
    id 是什么、由后端自己生成；这个接口反过来，id 必须由调用方给定。"""
    if todo_id != payload.id:
        raise HTTPException(status_code=400, detail="URL 里的 id 跟 body 里的 id 对不上")
    with tx() as conn:
        existing = conn.execute("SELECT created_at FROM todos WHERE id = ?", (todo_id,)).fetchone()
        created_at = existing["created_at"] if existing else payload.createdAt
        conn.execute(
            """INSERT INTO todos (id, text, due, done, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 text=excluded.text, due=excluded.due, done=excluded.done""",
            (todo_id, payload.text.strip()[:200], payload.due, int(payload.done), created_at),
        )
        row = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
        return _row_to_out(row)


@router.patch("/{todo_id}", response_model=TodoOut)
def patch_todo(todo_id: int, payload: TodoPatch):
    with tx() as conn:
        row = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="待办不存在")
        text = payload.text if payload.text is not None else row["text"]
        due = payload.due if payload.due is not None else row["due"]
        done = int(payload.done) if payload.done is not None else row["done"]
        conn.execute("UPDATE todos SET text = ?, due = ?, done = ? WHERE id = ?", (text, due, done, todo_id))
        row2 = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
        return _row_to_out(row2)


@router.delete("/{todo_id}")
def delete_todo(todo_id: int):
    with tx() as conn:
        cur = conn.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="待办不存在")
    return {"ok": True}
