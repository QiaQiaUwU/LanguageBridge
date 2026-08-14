import { openDB, type IDBPDatabase } from 'idb'

/**
 * 全模块共用一条连接。
 *
 * 之前把它放在实例字段上，而 wordStore 里 new 了一个 WordDatabase、
 * database.ts 又导出一个 wordDB —— 两个实例各自持有一条连接，版本升级时
 * 互相顶掉对方的 versionchange 事务，就是那句
 *   AbortError: Version change transaction was aborted in upgradeneeded event handler
 * 数据库名和版本号是写死的，本来就只该有一条连接。
 */
let sharedConn: Promise<IDBPDatabase<any>> | null = null
/** 正在跑版本升级。升级期间不能因为 blocking 回调把自己关掉。 */
let upgrading = false

function plain<T>(v: T): T {
  return v == null ? v : (JSON.parse(JSON.stringify(v)) as T)
}

export class WordDatabase {
  private dbName: string
  private dbVersion: number
  /**
   * 连接单例（模块级，不是实例级）。
   *
   * 原来每个 saveWord / getWord / getAll 都各自 openDB 一次。批量整理时几百次
   * 并发写，就是几百条连接同时开着；只要其中一条触发版本升级，其余连接会把
   * versionchange 事务顶掉，抛出
   *   AbortError: Version change transaction was aborted in upgradeneeded event handler
   * 全应用共用一条连接就不会出现这种互相打架。
   */
  constructor() {
    this.dbName = 'LanguageBridgeDB'
    this.dbVersion = 7
  }

  async open(): Promise<IDBPDatabase<any>> {
    if (sharedConn) return sharedConn
    sharedConn = this.doOpen()
      .catch(async err => {
        const msg = err instanceof Error ? err.message : String(err)
        // versionchange 事务被别的连接顶掉。等对方释放后重试一次通常就成了；
        // 直接把错抛给调用方会让整批写入白跑。
        if (/Version change transaction was aborted|AbortError/i.test(msg)) {
          await new Promise(r => setTimeout(r, 400))
          return this.doOpen()
        }
        throw err
      })
      .catch(err => {
      // 打开失败要把缓存清掉，否则这条失败的 promise 会被后续所有调用复用
      sharedConn = null
      throw err
    })
    return sharedConn
  }

  private doOpen(): Promise<IDBPDatabase<any>> {

    return openDB<any>(this.dbName, this.dbVersion, {
      upgrade(db, oldVersion, newVersion, transaction) {
        upgrading = true
        transaction.done.finally(() => { upgrading = false })
        console.log(`DB upgrade: ${oldVersion} → ${newVersion}`)

        if (!db.objectStoreNames.contains('words')) {
          const wordsStore = db.createObjectStore('words', {
            keyPath: 'id',
            autoIncrement: false
          })
          wordsStore.createIndex('byWord', 'word', { unique: false })
          wordsStore.createIndex('byLevel', 'level', { unique: false })
          wordsStore.createIndex('needReview', 'learningRecord.nextReview', { unique: false })
        }

        if (!db.objectStoreNames.contains('groups')) {
          const groupStore = db.createObjectStore('groups', {
            keyPath: 'id'
          })
          groupStore.createIndex('byName', 'name', { unique: false })
        }

        if (!db.objectStoreNames.contains('articles')) {
          const articleStore = db.createObjectStore('articles', {
            keyPath: 'id'
          })
          articleStore.createIndex('byUpdatedAt', 'updatedAt', { unique: false })
        }

        if (!db.objectStoreNames.contains('activity')) {
          db.createObjectStore('activity', { keyPath: 'date' })
        }

        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'key' })
        }

        if (!db.objectStoreNames.contains('todos')) {
          db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
        }

        if (!db.objectStoreNames.contains('habits')) {
          db.createObjectStore('habits', { keyPath: 'id', autoIncrement: true })
        }

        if (!db.objectStoreNames.contains('habitLog')) {
          const logStore = db.createObjectStore('habitLog', { keyPath: 'id', autoIncrement: true })
          logStore.createIndex('byHabit', 'habitId', { unique: false })
        }

        if (!db.objectStoreNames.contains('articleGroups')) {
          db.createObjectStore('articleGroups', { keyPath: 'id' })
        }

        if (!db.objectStoreNames.contains('wrongBook')) {
          const wrongBookStore = db.createObjectStore('wrongBook', { keyPath: 'wordId' })
          wrongBookStore.createIndex('byLastWrongDate', 'lastWrongDate', { unique: false })
        }
      },
      blocked() {
        console.warn('[DB] 有旧连接占着，等它关闭')
      },
      blocking() {
        // 别的标签页要升级：主动让路，否则对方会一直卡在 blocked
        console.warn('[DB] 让出连接以便升级')
        // 只在自己不是升级发起方时让路；升级中关掉自己会把 versionchange
        // 事务打断，正好抛出 "Version change transaction was aborted"
        if (!upgrading) {
          sharedConn?.then(db => db.close()).catch(() => {})
          sharedConn = null
        }
      },
      terminated() {
        console.warn('[DB] 连接被浏览器关闭，下次访问会重连')
        sharedConn = null
      }
    })
  }

  async saveWord(word: any): Promise<void> {
    const db = await this.open()
    await db.put('words', plain(word))
  }

  async getWord(id: string): Promise<any | undefined> {
    const db = await this.open()
    return await db.get('words', id)
  }

  async getAllWords(limit?: number, offset?: number): Promise<any[]> {
    const db = await this.open()
    const allWords = await db.getAll('words')

    if (limit !== undefined) {
      return allWords.slice(offset || 0, (offset || 0) + limit)
    }
    return allWords
  }

  async searchWords(query: string): Promise<any[]> {
    const db = await this.open()
    const allWords = await db.getAll('words')
    const q = query.toLowerCase()

    return allWords.filter(word =>
      word.word.toLowerCase().includes(q) ||
      word.meanings.some((m: any) => m.chinese.toLowerCase().includes(q))
    )
  }

  async saveBatch(words: any[]): Promise<void> {
    const db = await this.open()
    for (const word of words) {
      await db.put('words', plain(word))
    }
  }

  async deleteWord(id: string): Promise<void> {
    const db = await this.open()
    await db.delete('words', id)
  }

  async saveWordsBulk(words: any[]): Promise<void> {
    const db = await this.open()
    const tx = db.transaction('words', 'readwrite')
    for (const w of words) tx.store.put(plain(w))
    await tx.done
  }

  async saveGroupsBulk(groups: any[]): Promise<void> {
    const db = await this.open()
    const tx = db.transaction('groups', 'readwrite')
    for (const g of groups) tx.store.put(plain(g))
    await tx.done
  }

  async clearWords(): Promise<void> {
    const db = await this.open()
    await db.clear('words')
  }

  async getWordsToReview(): Promise<any[]> {
    const db = await this.open()
    const allWords = await db.getAll('words')
    const now = new Date()

    return allWords.filter(word => {
      const nextReview = new Date(word.learningRecord?.nextReview)
      return nextReview <= now && word.learningRecord?.familiarity < 80
    })
  }

  async saveGroup(group: any): Promise<void> {
    const db = await this.open()
    await db.put('groups', plain(group))
  }

  async getGroup(id: string): Promise<any | undefined> {
    const db = await this.open()
    return await db.get('groups', id)
  }

  async getAllGroups(): Promise<any[]> {
    const db = await this.open()
    return await db.getAll('groups')
  }

  async deleteGroup(id: string): Promise<void> {
    const db = await this.open()
    await db.delete('groups', id)
  }

  async recordWrongWord(entry: { wordId: string; word: string; input: string; date: string }): Promise<void> {
    const db = await this.open()
    const existing = await db.get('wrongBook', entry.wordId)
    const rec = existing
      ? { ...existing, lastWrongInput: entry.input, wrongCount: (existing.wrongCount || 0) + 1, lastWrongDate: entry.date }
      : { wordId: entry.wordId, word: entry.word, lastWrongInput: entry.input, wrongCount: 1, firstWrongDate: entry.date, lastWrongDate: entry.date }
    await db.put('wrongBook', plain(rec))
  }

  async getAllWrongBook(): Promise<any[]> {
    const db = await this.open()
    return await db.getAll('wrongBook')
  }

  async removeFromWrongBook(wordId: string): Promise<void> {
    const db = await this.open()
    await db.delete('wrongBook', wordId)
  }

  async removeManyFromWrongBook(wordIds: string[]): Promise<void> {
    const db = await this.open()
    const tx = db.transaction('wrongBook', 'readwrite')
    for (const id of wordIds) await tx.store.delete(id)
    await tx.done
  }

  async saveArticle(article: any): Promise<void> {
    const db = await this.open()
    await db.put('articles', plain(article))
  }

  async getArticle(id: string): Promise<any | undefined> {
    const db = await this.open()
    return await db.get('articles', id)
  }

  async getAllArticles(): Promise<any[]> {
    const db = await this.open()
    const all = await db.getAll('articles')
    return all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  }

  async deleteArticle(id: string): Promise<void> {
    const db = await this.open()
    await db.delete('articles', id)
  }

  async getActivity(date: string): Promise<any | undefined> {
    const db = await this.open()
    return await db.get('activity', date)
  }

  async saveActivity(record: any): Promise<void> {
    const db = await this.open()
    await db.put('activity', plain(record))
  }

  async getAllActivity(): Promise<any[]> {
    const db = await this.open()
    return await db.getAll('activity')
  }

  async saveHandle(key: string, handle: unknown): Promise<void> {
    const db = await this.open()
    await db.put('handles', { key, handle })
  }

  async getHandle(key: string): Promise<any | undefined> {
    const db = await this.open()
    const rec = await db.get('handles', key)
    return rec?.handle
  }

  async deleteHandle(key: string): Promise<void> {
    const db = await this.open()
    await db.delete('handles', key)
  }

  async addTodo(todo: { text: string; due: string; done: boolean; createdAt: string }): Promise<number> {
    const db = await this.open()
    return (await db.add('todos', todo)) as number
  }

  async getAllTodos(): Promise<any[]> {
    const db = await this.open()
    return await db.getAll('todos')
  }

  async updateTodo(id: number, patch: any): Promise<void> {
    const db = await this.open()
    const t = await db.get('todos', id)
    if (!t) return
    await db.put('todos', { ...t, ...patch })
  }

  async deleteTodo(id: number): Promise<void> {
    const db = await this.open()
    await db.delete('todos', id)
  }

  async addHabit(habit: { name: string; goal: number; medalAt: string; createdAt: string }): Promise<number> {
    const db = await this.open()
    return (await db.add('habits', habit)) as number
  }

  async getAllHabits(): Promise<any[]> {
    const db = await this.open()
    return await db.getAll('habits')
  }

  async updateHabit(id: number, patch: any): Promise<void> {
    const db = await this.open()
    const h = await db.get('habits', id)
    if (!h) return
    await db.put('habits', { ...h, ...patch })
  }

  async deleteHabit(id: number): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(['habits', 'habitLog'], 'readwrite')
    await tx.objectStore('habits').delete(id)
    const idx = tx.objectStore('habitLog').index('byHabit')
    for (const key of await idx.getAllKeys(id)) {
      await tx.objectStore('habitLog').delete(key)
    }
    await tx.done
  }

  async checkinHabit(habitId: number, date: string): Promise<boolean> {
    const db = await this.open()
    const idx = db.transaction('habitLog').store.index('byHabit')
    const existing = await idx.getAll(habitId)
    if (existing.some((l: any) => l.date === date)) return false // 当天已打卡，幂等
    await db.add('habitLog', { habitId, date })
    return true
  }

  async getHabitLog(habitId: number): Promise<any[]> {
    const db = await this.open()
    const idx = db.transaction('habitLog').store.index('byHabit')
    return await idx.getAll(habitId)
  }

  async saveArticleGroup(group: any): Promise<void> {
    const db = await this.open()
    await db.put('articleGroups', plain(group))
  }

  async getAllArticleGroups(): Promise<any[]> {
    const db = await this.open()
    return await db.getAll('articleGroups')
  }

  async deleteArticleGroup(id: string): Promise<void> {
    const db = await this.open()
    await db.delete('articleGroups', id)
  }

  async close(): Promise<void> {
    console.log('IndexedDB connection closed')
  }

  async check(): Promise<boolean> {
    try {
      const db = await this.open()
      return true
    } catch (e) {
      console.error('IndexedDB check failed:', e)
      return false
    }
  }
}

export const wordDB = new WordDatabase()
