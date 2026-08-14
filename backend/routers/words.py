# -*- coding: utf-8 -*-
"""
单词 CRUD。跟 articles.py 是同一个模式：前端 shared/stores/wordStore.ts 的 addWord/
updateWordFields/deleteWord 未来接后端时，这层是最直接能对上的——id 前端自己生成，
PUT 是 insert or replace，不用先查一次"存过没"。
"""
import json
from fastapi import APIRouter, HTTPException

from database import tx
from models import WordSave, WordOut

router = APIRouter(prefix="/api/words", tags=["words"])


def _row_to_out(row) -> dict:
    return {
        "id": row["id"],
        "word": row["word"],
        "phonetic": row["phonetic"],
        "status": row["status"],
        "groupId": row["group_id"],
        "meanings": json.loads(row["meanings"]),
        "level": row["level"],
        "source": row["source"],
        "audioUrl": row["audio_url"],
        "learningRecord": json.loads(row["learning_record"]) if row["learning_record"] else None,
        "tags": json.loads(row["tags"]) if row["tags"] else None,
        "isCustom": bool(row["is_custom"]) if row["is_custom"] is not None else None,
        "morphology": json.loads(row["morphology"]) if row["morphology"] else None,
        "etymology": row["etymology"],
        "memory_tips": row["memory_tips"],
        "common_phrases": json.loads(row["common_phrases"]) if row["common_phrases"] else None,
        "synonyms": json.loads(row["synonyms"]) if row["synonyms"] else None,
        "antonyms": json.loads(row["antonyms"]) if row["antonyms"] else None,
        "word_family": json.loads(row["word_family"]) if row["word_family"] else None,
        "example_sentences": json.loads(row["example_sentences"]) if row["example_sentences"] else None,
        "detailed_explanation": row["detailed_explanation"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@router.get("", response_model=list[WordOut])
def list_words(group_id: str | None = None):
    """不传 group_id 就返回全部；传了就只返回那个词书/章节 wordIds 里包含的词——
    但这里图简单直接用 group_id 这一列筛（单词自己"主要属于"的那个词书），一个词能同时
    挂在多个词书（wordIds 多对多）这件事，靠 word_groups 表自己的 word_ids 字段管理，
    不指望 words 表这一列覆盖"这个词还在其它哪些词书里"这种多对多查询——真要按某个
    词书查它包含哪些词，应该先查那个 word_group 拿 word_ids，再挨个查 words，
    或者前端本地已经有全量 words 时直接在内存里过滤（词汇中心现在就是这么做的）。
    """
    with tx() as conn:
        if group_id:
            rows = conn.execute(
                "SELECT * FROM words WHERE group_id = ? ORDER BY updated_at DESC", (group_id,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM words ORDER BY updated_at DESC").fetchall()
        return [_row_to_out(r) for r in rows]


@router.get("/{word_id}", response_model=WordOut)
def get_word(word_id: str):
    with tx() as conn:
        row = conn.execute("SELECT * FROM words WHERE id = ?", (word_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="单词不存在")
        return _row_to_out(row)


@router.put("/{word_id}", response_model=WordOut)
def save_word(word_id: str, payload: WordSave):
    """整条覆盖式保存，insert or replace——对齐前端 addWord（新增）和 updateWordFields（改字段）
    最终落盘时都是"存整条 WordItem"这个语义（wordStore 里 Object.assign 之后整个对象存一遍）。"""
    if word_id != payload.id:
        raise HTTPException(status_code=400, detail="URL 里的 id 跟 body 里的 id 对不上")
    with tx() as conn:
        conn.execute(
            """INSERT INTO words
               (id, word, phonetic, status, group_id, meanings, level, source, audio_url,
                learning_record, tags, is_custom, morphology, etymology, memory_tips,
                common_phrases, synonyms, antonyms, word_family, example_sentences,
                detailed_explanation, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 word=excluded.word, phonetic=excluded.phonetic, status=excluded.status,
                 group_id=excluded.group_id, meanings=excluded.meanings, level=excluded.level,
                 source=excluded.source, audio_url=excluded.audio_url,
                 learning_record=excluded.learning_record, tags=excluded.tags,
                 is_custom=excluded.is_custom, morphology=excluded.morphology,
                 etymology=excluded.etymology, memory_tips=excluded.memory_tips,
                 common_phrases=excluded.common_phrases, synonyms=excluded.synonyms,
                 antonyms=excluded.antonyms, word_family=excluded.word_family,
                 example_sentences=excluded.example_sentences,
                 detailed_explanation=excluded.detailed_explanation, updated_at=excluded.updated_at""",
            (
                payload.id,
                payload.word,
                payload.phonetic,
                payload.status,
                payload.groupId,
                json.dumps(payload.meanings, ensure_ascii=False),
                payload.level,
                payload.source,
                payload.audioUrl,
                json.dumps(payload.learningRecord, ensure_ascii=False) if payload.learningRecord else None,
                json.dumps(payload.tags, ensure_ascii=False) if payload.tags else None,
                int(payload.isCustom) if payload.isCustom is not None else None,
                json.dumps(payload.morphology, ensure_ascii=False) if payload.morphology else None,
                payload.etymology,
                payload.memory_tips,
                json.dumps(payload.common_phrases, ensure_ascii=False) if payload.common_phrases else None,
                json.dumps(payload.synonyms, ensure_ascii=False) if payload.synonyms else None,
                json.dumps(payload.antonyms, ensure_ascii=False) if payload.antonyms else None,
                json.dumps(payload.word_family, ensure_ascii=False) if payload.word_family else None,
                json.dumps(payload.example_sentences, ensure_ascii=False) if payload.example_sentences else None,
                payload.detailed_explanation,
                payload.createdAt,
                payload.updatedAt,
            ),
        )
        row = conn.execute("SELECT * FROM words WHERE id = ?", (word_id,)).fetchone()
        return _row_to_out(row)


@router.delete("/{word_id}")
def delete_word(word_id: str):
    with tx() as conn:
        cur = conn.execute("DELETE FROM words WHERE id = ?", (word_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="单词不存在")
    return {"ok": True}
