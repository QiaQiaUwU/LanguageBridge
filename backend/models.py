# -*- coding: utf-8 -*-
"""
Pydantic 模型。字段跟前端 shared/types/Article.ts 里的
Article / ArticleSentence / ArticleMark / ArticleGroup 逐字段对齐（同样用 camelCase），
这样前端存/取的时候不用在这一层再写一遍字段名转换（那是多余的出错机会）。
数据库列名是 snake_case，转换只发生在 routers/ 里读写 SQLite 那一小段。
"""
from __future__ import annotations
from typing import Optional, List, Any
from pydantic import BaseModel, ConfigDict, Field


class ArticleSentence(BaseModel):
    en: str
    zh: str = ""
    audioStart: Optional[float] = None
    audioEnd: Optional[float] = None


class ArticleMark(BaseModel):
    id: str
    text: str
    start: int
    end: int
    color: str
    note: Optional[str] = None
    zhText: Optional[str] = None
    createdAt: str


class ArticleChapter(BaseModel):
    """对齐前端 ArticleChapter：章节标题 + 这一章从 sentences 数组第几句开始，
    docx 整篇导入识别到多个章节标题时生成，给侧栏"目录"跳转用。"""
    title: str
    sentenceIndex: int


class ArticleBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str
    rawEnglish: str = ""
    sentences: List[ArticleSentence] = Field(default_factory=list)
    source: str = ""
    sourceUrl: Optional[str] = None
    notes: str = ""
    reciteDraft: str = ""
    needsCleanup: bool = False
    groupId: Optional[str] = None
    bookmarked: bool = False
    completed: bool = False
    marks: List[ArticleMark] = Field(default_factory=list)
    chapters: List[ArticleChapter] = Field(default_factory=list)
    audioFileName: Optional[str] = None


class ArticleSave(ArticleBase):
    """前端 readerStore.saveArticle() 传的完整对象：id/createdAt/updatedAt 都是前端自己生成好的，
    后端负责的只是"存下去"，不是"生成 id"——保存新文章和更新已有文章走的是同一个结构。"""
    id: str
    createdAt: str
    updatedAt: str


class ArticleOut(ArticleBase):
    id: str
    createdAt: str
    updatedAt: str


class ArticleGroupCreate(BaseModel):
    name: str


class ArticleGroupOut(BaseModel):
    id: str
    name: str
    createdAt: str
    updatedAt: str


class TodoCreate(BaseModel):
    text: str
    due: str = ""


class TodoSave(BaseModel):
    """给"用前端已经生成好的 id 直接写"这条路用（配合 studyTodos.ts 的双写）。
    id 在这里是必填的，跟 TodoCreate 的区别只在这一点——TodoCreate 是"我不关心 id 是什么，
    你（后端）随便生成一个"，TodoSave 是"必须用这个 id，不存在就插入，存在就更新"。"""
    id: int
    text: str
    due: str = ""
    done: bool = False
    createdAt: str


class TodoPatch(BaseModel):
    """局部更新用：前端目前只会改 done（打勾）或者删除，不会整体重传。三个字段都可选，
    只传要改的那个，None 表示这次不改。"""
    text: Optional[str] = None
    due: Optional[str] = None
    done: Optional[bool] = None


class TodoOut(BaseModel):
    id: int
    text: str
    due: str
    done: bool
    createdAt: str


class WordBase(BaseModel):
    """WordItem 字段对齐 shared/types/WordItem.ts。嵌套的那些（meanings/common_phrases/
    synonyms/antonyms/example_sentences/morphology/learningRecord）故意用松散的 dict/Any，
    不逐层建模——这些嵌套结构字段多、可选项多，前端那边以后调整细节形状的概率不低，
    这里严格建模反而容易因为漏了某个可选字段就把整条数据存丢；后端在这几块只是"原样存、
    原样吐回去"的角色，不需要替前端把这些嵌套形状的校验也做一遍。"""
    model_config = ConfigDict(populate_by_name=True)

    word: str
    phonetic: str = ""
    status: Optional[str] = None
    groupId: Optional[str] = None
    meanings: List[dict] = Field(default_factory=list)
    level: str = ""
    source: Optional[str] = None
    audioUrl: Optional[str] = None
    learningRecord: Optional[dict] = None
    tags: Optional[List[str]] = None
    isCustom: Optional[bool] = None
    morphology: Optional[dict] = None
    etymology: Optional[str] = None
    memory_tips: Optional[str] = None
    common_phrases: Optional[List[dict]] = None
    synonyms: Optional[List[dict]] = None
    antonyms: Optional[List[dict]] = None
    word_family: Optional[List[str]] = None
    example_sentences: Optional[List[dict]] = None
    detailed_explanation: Optional[str] = None


class WordSave(WordBase):
    """对齐 wordStore.addWord/updateWordFields：id 是前端生成的字符串，保存新词和更新已有词走同一个结构，
    跟 ArticleSave 是同一个思路。"""
    id: str
    createdAt: str
    updatedAt: str


class WordOut(WordBase):
    id: str
    createdAt: str
    updatedAt: str


class WordGroupSave(BaseModel):
    """对齐 WordGroup：id 前端生成，parentId 支持树形（词书下面挂章节），order 是排序权重
    （数据库列叫 sort_order，因为 order 是 SQL 保留字，字段名到列名的转换只在 routers/words.py 里做一次）。"""
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    description: str = ""
    wordIds: List[str] = Field(default_factory=list)
    createdAt: str
    updatedAt: str
    color: Optional[str] = None
    parentId: Optional[str] = None
    order: Optional[int] = None


class WordGroupOut(WordGroupSave):
    pass


class ActivitySave(BaseModel):
    """对齐前端 shared/core/activityLog.ts 的 DayActivity：这几个字段每次都是整条读出来改一个
    字段再整条存回去（不是局部字段更新），所以后端也是整条 upsert，跟 TodoPatch 那种局部更新是两回事。"""
    model_config = ConfigDict(populate_by_name=True)

    date: str
    newWords: int = 0
    reviewCount: int = 0
    correctCount: int = 0
    minutesActive: int = 0


class ActivityOut(ActivitySave):
    pass


class HabitSave(BaseModel):
    """对齐 studyTodos.ts 的 Habit：id 是前端 IndexedDB 自增分配的整数（wordDB.addHabit 的返回值），
    跟 TodoSave 是同一个思路——前端先在本地插入拿到 id，再拿这个 id 来 PUT，两边就用同一个 id。"""
    id: int
    name: str
    goal: int = 21
    medalAt: str = ""
    createdAt: str


class HabitOut(HabitSave):
    pass


class HabitCheckin(BaseModel):
    date: str
