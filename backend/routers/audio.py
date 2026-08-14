# -*- coding: utf-8 -*-
"""
文章音频：上传/下载/删除，以及触发 MFA 强制对齐。
真正的存储和对齐逻辑在 audio_align.py 里，这个文件只是把它们接成 HTTP 接口、
顺带同步 articles 表里的 audio_file_name 和 sentences 字段。
"""
import json
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from database import tx
import audio_align

router = APIRouter(prefix="/api/articles", tags=["audio"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_article(conn, article_id: str):
    row = conn.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="文章不存在")
    return row


@router.post("/{article_id}/audio")
async def upload_audio(article_id: str, file: UploadFile = File(...)):
    """上传/替换这篇文章关联的原始音频（mp3/m4a/wav/ogg/aac 都行，对齐那一步会自己转码）。"""
    with tx() as conn:
        _require_article(conn, article_id)
        data = await file.read()
        filename = audio_align.save_audio_file(article_id, file.filename or "audio", data)
        conn.execute(
            "UPDATE articles SET audio_file_name = ?, updated_at = ? WHERE id = ?",
            (filename, _now(), article_id),
        )
    return {"audioFileName": filename}


@router.get("/{article_id}/audio")
def download_audio(article_id: str):
    """给前端 <audio> 播放器用的直链，跟手动对轴那个播放器是同一份文件。"""
    path = audio_align.get_audio_path(article_id)
    if not path:
        raise HTTPException(status_code=404, detail="这篇文章还没有关联音频")
    return FileResponse(str(path))


@router.delete("/{article_id}/audio")
def delete_audio(article_id: str):
    with tx() as conn:
        _require_article(conn, article_id)
        audio_align.delete_audio_file(article_id)
        conn.execute(
            "UPDATE articles SET audio_file_name = NULL, updated_at = ? WHERE id = ?",
            (_now(), article_id),
        )
    return {"ok": True}


@router.post("/{article_id}/align")
def align_audio(article_id: str):
    """触发一次强制对齐：读这篇文章当前的 sentences，跑 MFA，把算出来的 audioStart/audioEnd
    写回每一句，存回 DB。这是同步阻塞调用——文章长、机器性能一般的话可能要等几十秒到几分钟，
    调用方（前端）那边要有个"对齐中…"的等待态，不要当成秒回的接口来处理超时时间。

    返回体里如果某句带了 `_alignNote` 字段，说明从那句开始词对不上了，之后的句子没有
    audioStart/audioEnd，需要人工核对音频和文本是否一致——这不是接口报错，是部分成功。
    """
    with tx() as conn:
        row = _require_article(conn, article_id)
        sentences = json.loads(row["sentences"])

        try:
            updated_sentences = audio_align.align_article_audio(article_id, sentences)
        except audio_align.AlignError as e:
            raise HTTPException(status_code=500, detail=str(e))

        # 注意：这里故意不经过 ArticleSentence 这个 Pydantic 模型再存一遍——那样会把
        # 诊断用的 _alignNote 字段悄悄丢掉（Pydantic 默认忽略未声明字段），直接存原始 dict，
        # 前端读到多出来的 _alignNote 字段也不会出问题，只是它的类型里没声明这个字段。
        conn.execute(
            "UPDATE articles SET sentences = ?, updated_at = ? WHERE id = ?",
            (
                json.dumps(updated_sentences, ensure_ascii=False),
                _now(),
                article_id,
            ),
        )
        return {"sentences": updated_sentences}
