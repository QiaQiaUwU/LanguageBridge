# -*- coding: utf-8 -*-
"""
学习习惯 + 打卡记录。对齐前端 shared/core/studyTodos.ts 的 Habit 部分：
habits 表存习惯本身（名字/目标天数/达标时间），habit_log 存每一次打卡——同一习惯同一天
只记一次，靠 UNIQUE(habit_id, date) 约束保证幂等，重复打卡直接吃 IntegrityError 当作
"今天已经打过卡了"处理，不当错误抛出去。

id 是前端 IndexedDB 自增分配的，思路跟 todos 一致：前端先在本地插入拿到 id，再拿这个 id
来 PUT，两边就不会各算各的 id。
"""
import sqlite3
from fastapi import APIRouter, HTTPException

from database import tx
from models import HabitSave, HabitOut, HabitCheckin

router = APIRouter(prefix="/api/habits", tags=["habits"])


def _row_to_out(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "goal": row["goal"],
        "medalAt": row["medal_at"],
        "createdAt": row["created_at"],
    }


@router.get("", response_model=list[HabitOut])
def list_habits():
    with tx() as conn:
        rows = conn.execute("SELECT * FROM habits ORDER BY created_at ASC").fetchall()
        return [_row_to_out(r) for r in rows]


@router.put("/{habit_id}", response_model=HabitOut)
def save_habit(habit_id: int, payload: HabitSave):
    if habit_id != payload.id:
        raise HTTPException(status_code=400, detail="URL 里的 id 跟 body 里的 id 对不上")
    with tx() as conn:
        conn.execute(
            """INSERT INTO habits (id, name, goal, medal_at, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, goal=excluded.goal, medal_at=excluded.medal_at""",
            (habit_id, payload.name.strip()[:40], payload.goal, payload.medalAt, payload.createdAt),
        )
        row = conn.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone()
        return _row_to_out(row)


@router.delete("/{habit_id}")
def delete_habit(habit_id: int):
    with tx() as conn:
        conn.execute("DELETE FROM habit_log WHERE habit_id = ?", (habit_id,))
        cur = conn.execute("DELETE FROM habits WHERE id = ?", (habit_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="习惯不存在")
    return {"ok": True}


@router.post("/{habit_id}/checkin")
def checkin_habit(habit_id: int, payload: HabitCheckin):
    """同一习惯同一天重复打卡不报错，返回 inserted:false 表示这次是幂等命中，不是失败。"""
    with tx() as conn:
        exists = conn.execute("SELECT 1 FROM habits WHERE id = ?", (habit_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="习惯不存在")
        try:
            conn.execute("INSERT INTO habit_log (habit_id, date) VALUES (?, ?)", (habit_id, payload.date))
        except sqlite3.IntegrityError:
            return {"ok": True, "inserted": False}
    return {"ok": True, "inserted": True}
