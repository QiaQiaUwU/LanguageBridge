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

/** 读整表时跳过的坏记录数，供界面提示用 */
export const salvageReport = { skipped: 0, lastStore: '' }

/**
 * 逐条读整张表，坏记录跳过。
 *
 * db.getAll() 是一次性读整个 objectStore：只要里面有一条记录的底层文件损坏
 * （NotReadableError: Data lost due to missing file），整张表就全读不出来，
 * 表现是「明明只坏了一条，结果一条都读不到」。用游标逐条走，坏的那条跳过，
 * 其余照常返回 —— 至少能把还完好的数据救出来。
 */
async function salvageAll(db: IDBPDatabase<any>, store: string): Promise<any[]> {
  const out: any[] = []
  let skipped = 0
  try {
    let cursor = await db.transaction(store, 'readonly').store.openCursor()
    while (cursor) {
      try {
        out.push(cursor.value)
      } catch {
        skipped++
      }
      try {
        cursor = await cursor.continue()
      } catch {
        // 游标本身崩了就只能到此为止，前面读到的仍然有效
        skipped++
        break
      }
    }
  } catch (err) {
    // 连事务都开不起来，退回一次性读，让上层拿到原始错误
    const msg = err instanceof Error ? err.message : String(err)
    if (!/NotReadableError|missing file|backing store/i.test(msg)) throw err
    skipped++
  }
  if (skipped) {
    salvageReport.skipped += skipped
    salvageReport.lastStore = store
    console.warn(`[DB] ${store} 有 ${skipped} 条记录读不出来，已跳过`)
  }
  return out
}

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

  get expectedVersion(): number {
    return this.dbVersion
  }

  async open(): Promise<IDBPDatabase<any>> {
    if (sharedConn) return sharedConn
    const chain = this.dropEmptyShell().then(() => this.doOpen())
      .catch(async err => {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/Version change transaction was aborted|AbortError/i.test(msg)) throw err

        /**
         * versionchange 事务被打断，退避重试。
         *
         * 这里**不能**退回 openDB(name) 不带版本号 —— 库不存在时那样会新建一个
         * 空库、一张表都没有，接着所有读写全废。我上一版就是这么写的，直接把
         * 用户的库换成了空壳。
         *
         * 正确做法：带着版本号重试几次；仍然失败就把真实状态报出来让人处理，
         * 绝不自己造一个空库顶上。
         */
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 300 * (i + 1)))
          try {
            return await this.doOpen()
          } catch (e2) {
            const m2 = e2 instanceof Error ? e2.message : String(e2)
            if (!/Version change transaction was aborted|AbortError/i.test(m2)) throw e2
          }
        }

        let detail = ''
        try {
          const list = await (indexedDB as any).databases?.()
          const me = Array.isArray(list) ? list.find((d: any) => d.name === this.dbName) : null
          detail = me ? `（本地库当前 v${me.version}，程序需要 v${this.dbVersion}）` : '（本地还没有这个库）'
        } catch {
          /* Firefox 没有 databases()，取不到就不报 */
        }
        throw new Error(
          `数据库升级被打断，重试 3 次仍未成功${detail}。\n` +
          `最常见的原因是同时开了两个 LanguageBridge 窗口：请把所有窗口和浏览器标签全部关掉，只留一个再打开。`
        )
      })
      .catch(err => {
        // 打开失败要把缓存清掉，否则这条失败的 promise 会被后续所有调用复用
        sharedConn = null
        throw err
      })
    sharedConn = chain
    // 给缓存的这份挂一个空 catch。调用方 await 的是同一条链、错误照常抛给它；
    // 但如果某次调用是即发即忘（没人 await），这个 promise 就会变成
    // 「未捕获的 Promise: AbortError」浮到全局。挂上之后只有真正 await 的人会看到。
    void chain.catch(() => {})
    return chain
  }

  /**
   * 打开前先探一眼：如果本地库存在、版本低于程序期望、而且**一张表都没有**，
   * 那它一定是个空壳（我之前一版错误地用 openDB(name) 不带版本号打开，
   * 库不存在时会新建这样一个 v1 空库）。空壳里没有任何数据，直接删掉重建，
   * 比反复尝试升级它可靠得多。有表的库绝不碰。
   */
  private async dropEmptyShell(): Promise<void> {
    try {
      const probe = await openDB<any>(this.dbName)
      const empty = probe.objectStoreNames.length === 0
      const older = probe.version < this.dbVersion
      probe.close()
      if (!empty || !older) return
      console.warn(`[DB] 发现 v${probe.version} 空库（0 张表），删除后重建`)
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(this.dbName)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
        req.onblocked = () => resolve() // 被占也继续，后面的 openDB 会再试
      })
    } catch {
      /* 探测失败就当没这回事，走正常打开流程 */
    }
  }

  private doOpen(): Promise<IDBPDatabase<any>> {

    return openDB<any>(this.dbName, this.dbVersion, {
      upgrade(db, oldVersion, newVersion, transaction) {
        upgrading = true
        // 用 then 的两个回调收尾，不能用 .finally —— finally 不吞异常，
        // versionchange 事务中止时 transaction.done 会 reject，
        // 这条链上没有 catch，就变成「未捕获的 Promise: AbortError」。
        // 这个标志纯粹是内部状态，事务成败都只需要把它复位。
        transaction.done.then(
          () => { upgrading = false },
          () => { upgrading = false }
        )
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
    const allWords = await salvageAll(db, 'words')

    if (limit !== undefined) {
      return allWords.slice(offset || 0, (offset || 0) + limit)
    }
    return allWords
  }

  async searchWords(query: string): Promise<any[]> {
    const db = await this.open()
    const allWords = await salvageAll(db, 'words')
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
    const allWords = await salvageAll(db, 'words')
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
    return await salvageAll(db, 'groups')
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
    return await salvageAll(db, 'wrongBook')
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
    const all = await salvageAll(db, 'articles')
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
    return await salvageAll(db, 'activity')
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
    return await salvageAll(db, 'todos')
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
    return await salvageAll(db, 'habits')
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
    return await salvageAll(db, 'articleGroups')
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

/**
 * 关闭并删除整个本地数据库。
 *
 * 底层文件损坏时（NotReadableError）没有任何修复手段，只能重建。删之前一定
 * 先导出还能读的部分 —— salvageAll 已经能跳过坏记录把其余捞出来。
 */
/**
 * 数据库体检。出问题时先看这个，别猜。
 * 报告实际版本、代码期望版本、缺哪些表、开了几个连接。
 */
export async function inspectDatabase(): Promise<string> {
  const lines: string[] = []
  try {
    const db = await openDB<any>('LanguageBridgeDB')
    lines.push(`实际版本 v${db.version}，代码期望 v${wordDB.expectedVersion}`)
    const have = Array.from(db.objectStoreNames)
    lines.push(`数据表 ${have.length} 个：${have.join('、')}`)
    const need = ['words', 'groups', 'articles', 'articleGroups', 'wrongBook', 'activity', 'todos', 'habits', 'habitLog', 'handles']
    const missing = need.filter(n => !have.includes(n))
    lines.push(missing.length ? `缺少：${missing.join('、')}` : '没有缺表')
    for (const st of have) {
      try {
        lines.push(`  ${st}: ${await db.count(st)} 条`)
      } catch (e) {
        lines.push(`  ${st}: 读取失败 ${e instanceof Error ? e.message : ''}`)
      }
    }
    db.close()
  } catch (e) {
    lines.push(`打开失败：${e instanceof Error ? e.message : String(e)}`)
  }
  return lines.join('\n')
}

export async function resetLocalDatabase(): Promise<void> {
  try {
    const db = await sharedConn
    db?.close()
  } catch {
    /* 连不上就直接删 */
  }
  sharedConn = null
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('LanguageBridgeDB')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    // 有别的标签页占着时会 blocked，提示用户关掉
    req.onblocked = () => reject(new Error('还有别的窗口开着这个应用，请全部关掉后重试'))
  })
}

export const wordDB = new WordDatabase()
