# -*- coding: utf-8 -*-
"""
每日学习活动（打卡/热力图/今日统计）。对齐前端 shared/core/activityLog.ts 的
recordWordLearned/recordReview/recordActiveMinute —— 这几个函数在 IndexedDB 里都是
"读今天这条 -> 改一个字段 -> 整条 put 回去"，所以这里也是整条 upsert，不是 todos 那种
局部 PATCH。date（YYYY-MM-DD）本身就是主键，不需要单独的自增 id。
"""
from fastapi import APIRouter, HTTPException

from database import tx
from models import ActivitySave, ActivityOut

router = APIRouter(prefix="/api/activity", tags=["activity"])


def _row_to_out(row) -> dict:
    return {
        "date": row["date"],
        "newWords": row["new_words"],
        "reviewCount": row["review_count"],
        "correctCount": row["correct_count"],
        "minutesActive": row["minutes_active"],
    }


@router.get("", response_model=list[ActivityOut])
def list_activity():
    """给以后做"从后端恢复"用；目前前端还没接这个读接口，先跟 articles/words 一样把
    列表接口备好，双写这一半（PUT）是当前唯一实际会被调用的。"""
    with tx() as conn:
        rows = conn.execute("SELECT * FROM activity ORDER BY date ASC").fetchall()
        return [_row_to_out(r) for r in rows]


@router.put("/{date}", response_model=ActivityOut)
def save_activity(date: str, payload: ActivitySave):
    if date != payload.date:
        raise HTTPException(status_code=400, detail="URL 里的日期跟 body 里的日期对不上")
    with tx() as conn:
        conn.execute(
            """INSERT INTO activity (date, new_words, review_count, correct_count, minutes_active)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(date) DO UPDATE SET
                 new_words=excluded.new_words,
                 review_count=excluded.review_count,
                 correct_count=excluded.correct_count,
                 minutes_active=excluded.minutes_active""",
            (date, payload.newWords, payload.reviewCount, payload.correctCount, payload.minutesActive),
        )
        row = conn.execute("SELECT * FROM activity WHERE date = ?", (date,)).fetchone()
        return _row_to_out(row)
