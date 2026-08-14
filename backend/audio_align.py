# -*- coding: utf-8 -*-
"""
音频存储 + 强制对齐（Montreal Forced Aligner, MFA）。

选型说明（跟聊天记录里核实过的结论对齐，写在这里方便以后回来看）：
MFA 是目前学术验证最充分的强制对齐工具（2026 年 Interspeech 论文：平均边界误差 <15ms），
但它不是一个 pip 包——要通过 conda/mamba 安装（会一并装 Kaldi），还要单独下载预训练的
声学模型和发音词典。这些步骤全部要在"部署这个后端的机器"上手动做一次，本模块假设
`mfa` 命令已经在 PATH 上、`english_us_arpa` 声学模型和词典已经下载好，不负责替用户装。

装好之后大概是这样一条命令验证：
    conda create -n aligner -c conda-forge montreal-forced-aligner
    conda activate aligner
    mfa model download acoustic english_us_arpa
    mfa model download dictionary english_us_arpa
    mfa align --help   # 能跑出帮助文本就说明装对了

我们的场景比"语音识别+对齐"简单一层：文章原文已经是准的，不需要 MFA 去猜文本，
只需要它把这段已知文本"钉"到音频的时间轴上——这正是 MFA `align` 命令的本职工作，
不是它的附加功能，所以不需要碰 MFA 的语言模型/训练相关的那一半功能。

流程：
  1) 把上传的音频转成 MFA 喜欢的 16kHz 单声道 wav（用 ffmpeg，机器上要有 ffmpeg 可执行文件）
  2) 把文章全部句子拼成一份 .lab 文本，跟音频文件同名放进一个"语料目录"
  3) 跑 `mfa align <语料目录> english_us_arpa english_us_arpa <输出目录>`
  4) MFA 吐出一份 TextGrid，里面有 "words" 这个分层(tier)，每个词一个时间区间
  5) 按顺序把这些词的时间区间，按我们句子原来的分词个数切回句子，
     每句的 audioStart = 这句第一个词的开始时间，audioEnd = 这句最后一个词的结束时间

这个环境没有网络、没装 conda/mfa，这份代码写完之后没有被真实跑过一次 `mfa align`，
TextGrid 解析是照着 Praat TextGrid 的"long/full"文本格式手写的，格式本身很稳定
（Praat 从很早的版本到现在没怎么变过），但没有真实样本对照解析结果，第一次接入后
务必自己跑一次，看解析出来的词和时间对不对，不要假设它一定精确。
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
AUDIO_DIR = BACKEND_DIR / "data" / "audio"
MFA_CORPUS_DIR = BACKEND_DIR / "data" / "mfa_corpus"
MFA_OUTPUT_DIR = BACKEND_DIR / "data" / "mfa_output"

for d in (AUDIO_DIR, MFA_CORPUS_DIR, MFA_OUTPUT_DIR):
    d.mkdir(parents=True, exist_ok=True)

# MFA 对齐时会把词转小写、去掉大部分标点，这里做同样的归一化，
# 这样才能把 MFA 吐出来的词序列跟我们自己句子里切出来的词对上号。
_WORD_RE = re.compile(r"[a-zA-Z']+")


def normalize_words(text: str) -> list[str]:
    return [w.lower() for w in _WORD_RE.findall(text)]


class AlignError(Exception):
    """对齐流程任何一步失败（找不到 mfa/ffmpeg、转码失败、MFA 报错、词对不上）都抛这个，
    路由层统一接住转成 HTTP 500 加一句人话提示，不是让调用方去猜是哪层出的错。"""


def _require_executable(name: str) -> None:
    if shutil.which(name) is None:
        raise AlignError(
            f"找不到可执行文件 `{name}`。这一步需要你在部署这个后端的机器上装好它并加进 PATH，"
            f"这个环境（写代码的沙盒）没有网络，没法替你装、也没法替你验证装对了没有。"
        )


def save_audio_file(article_id: str, filename: str, data: bytes) -> str:
    """存一份上传的原始音频（不做转码，转码只在对齐那一步临时做），返回存到磁盘的文件名。"""
    ext = Path(filename).suffix.lower() or ".mp3"
    dest = AUDIO_DIR / f"{article_id}{ext}"
    # 换一个文件的话，先把旧的（不同后缀的）清掉，避免同一篇文章底下堆着好几个音频文件
    for old in AUDIO_DIR.glob(f"{article_id}.*"):
        old.unlink(missing_ok=True)
    dest.write_bytes(data)
    return dest.name


def get_audio_path(article_id: str) -> Path | None:
    matches = list(AUDIO_DIR.glob(f"{article_id}.*"))
    return matches[0] if matches else None


def delete_audio_file(article_id: str) -> None:
    for f in AUDIO_DIR.glob(f"{article_id}.*"):
        f.unlink(missing_ok=True)


def _transcode_to_wav(src: Path, dest: Path) -> None:
    """MFA 认 16kHz 单声道 wav 最省心，其他格式/采样率有时候能跑但容易踩坑，统一转一遍。"""
    _require_executable("ffmpeg")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-ac", "1", "-ar", "16000", str(dest)],
        check=True, capture_output=True,
    )


def _parse_textgrid_words(path: Path) -> list[tuple[str, float, float]]:
    """解析 Praat TextGrid（long/full 文本格式），只取名字叫 "words" 的那个 IntervalTier，
    返回按时间顺序排列的 (词, 起, 止)，跳过静音/空白区间（text 是空字符串或 sp/sil/spn 这类占位符）。
    这是手写的正则解析，不是官方库，前提是 MFA 输出的是标准 long TextGrid 格式（默认就是）。"""
    content = path.read_text(encoding="utf-8", errors="replace")

    # 先找到 "words" 这个 tier 的起止范围（用下一个 item [N]: 或文件结尾当边界）
    tier_start = re.search(r'item\s*\[\d+\]:\s*[\s\S]*?name\s*=\s*"words"', content)
    if not tier_start:
        raise AlignError("TextGrid 里没找到名字叫 words 的分层，MFA 输出格式可能跟预期不一样，需要人工核对一次。")
    tier_body_start = tier_start.end()
    next_item = re.search(r'item\s*\[\d+\]:', content[tier_body_start:])
    tier_body = content[tier_body_start: tier_body_start + next_item.start()] if next_item else content[tier_body_start:]

    words: list[tuple[str, float, float]] = []
    for m in re.finditer(
        r'intervals\s*\[\d+\]:\s*xmin\s*=\s*([\d.]+)\s*xmax\s*=\s*([\d.]+)\s*text\s*=\s*"([^"]*)"',
        tier_body,
    ):
        xmin, xmax, text = float(m.group(1)), float(m.group(2)), m.group(3).strip()
        if not text or text.lower() in ("sp", "sil", "spn", "<unk>"):
            continue
        words.append((text, xmin, xmax))
    return words


def align_article_audio(article_id: str, sentences: list[dict]) -> list[dict]:
    """主流程：给定文章 id 和它的 sentences（每个至少有 en 字段），跑一遍 MFA 对齐，
    返回补上了 audioStart/audioEnd 的新 sentences 列表（跟前端 ArticleSentence 的字段名一致，
    这样存回 DB 之后前端能直接拿去用，不用再转一层）。"""
    _require_executable("mfa")

    audio_src = get_audio_path(article_id)
    if not audio_src:
        raise AlignError("这篇文章还没有关联音频文件，先调用上传音频的接口。")

    corpus_dir = MFA_CORPUS_DIR / article_id
    if corpus_dir.exists():
        shutil.rmtree(corpus_dir)
    corpus_dir.mkdir(parents=True)

    wav_path = corpus_dir / f"{article_id}.wav"
    _transcode_to_wav(audio_src, wav_path)

    full_text = " ".join(s.get("en", "") for s in sentences)
    (corpus_dir / f"{article_id}.lab").write_text(full_text, encoding="utf-8")

    output_dir = MFA_OUTPUT_DIR / article_id
    if output_dir.exists():
        shutil.rmtree(output_dir)

    # --clean 避免复用上一次可能存在的缓存目录导致的奇怪状态；这条命令跑起来可能要几十秒到几分钟，
    # 取决于音频长度，目前是同步阻塞调用，文章很长的话调用方那边的 HTTP 请求会等比较久。
    result = subprocess.run(
        ["mfa", "align", "--clean", str(corpus_dir), "english_us_arpa", "english_us_arpa", str(output_dir)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise AlignError(
            f"`mfa align` 执行失败（退出码 {result.returncode}）。常见原因：声学模型/词典没下载"
            f"（先跑 `mfa model download acoustic english_us_arpa` 和 `mfa model download dictionary english_us_arpa`），"
            f"或者音频里有很长一段跟文本完全对不上。原始报错：\n{result.stderr[-2000:]}"
        )

    textgrid_path = output_dir / f"{article_id}.TextGrid"
    if not textgrid_path.exists():
        raise AlignError(f"MFA 执行完了但没找到预期的输出文件 {textgrid_path}，需要人工去输出目录看一眼实际生成了什么。")

    aligned_words = _parse_textgrid_words(textgrid_path)

    # 按句子原来的分词个数，从对齐结果里顺序切回每一句的时间区间
    updated: list[dict] = []
    cursor = 0
    mismatch_from: int | None = None
    for s in sentences:
        s = dict(s)
        needed = len(normalize_words(s.get("en", "")))
        if needed == 0:
            updated.append(s)
            continue
        chunk = aligned_words[cursor: cursor + needed]
        if len(chunk) < needed and mismatch_from is None:
            # 对齐出来的词比这句该有的少，说明前面某处已经对不上了（常见于音频缺一段/多一段、
            # 或者转录跟音频本身不完全一致）；不报硬错误，从这句开始 audioStart/audioEnd 留空，
            # 前面已经对上的句子该有的时间戳还是保留，调用方能看出"对到第几句就断了"
            mismatch_from = len(updated)
        if len(chunk) == needed:
            s["audioStart"] = chunk[0][1]
            s["audioEnd"] = chunk[-1][2]
        cursor += needed
        updated.append(s)

    if mismatch_from is not None:
        # 附带一点诊断信息，不是静默把后面的句子都留空不说明原因
        updated[mismatch_from]["_alignNote"] = (
            f"从这句开始词对不上了（MFA 对齐结果在这里只剩 {len(aligned_words) - cursor} 个词可用），"
            f"这句之后的 audioStart/audioEnd 没能生成，需要人工检查音频和文本是否完全一致。"
        )

    return updated
