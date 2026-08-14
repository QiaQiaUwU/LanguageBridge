import { wordDB } from './database'
import * as be from './backendClient'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface Todo {
  id: number
  text: string
  due: string
  done: boolean
  createdAt: string
}

export async function getTodos(): Promise<Todo[]> {
  const all = await wordDB.getAllTodos()
  return all.sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999'))
}

export async function addTodo(text: string, due = ''): Promise<void> {
  const t = text.trim().slice(0, 200)
  if (!t) return
  const createdAt = new Date().toISOString()
  const id = await wordDB.addTodo({ text: t, due, done: false, createdAt })
  be.beSaveTodo({ id, text: t, due, done: false, createdAt })
}

export async function toggleTodo(id: number, done: boolean): Promise<void> {
  await wordDB.updateTodo(id, { done })
  be.bePatchTodoDone(id, done)
}

export async function deleteTodo(id: number): Promise<void> {
  await wordDB.deleteTodo(id)
  be.beDeleteTodo(id)
}

export interface Habit {
  id: number
  name: string
  goal: number
  medalAt: string
  createdAt: string
  streak: number
  total: number
  today: boolean
}

function computeStreak(dates: Set<string>): number {
  const today = new Date()
  const t_iso = todayStr()
  let streak = 0
  const cur = new Date(today)
  if (!dates.has(t_iso)) cur.setDate(cur.getDate() - 1)
  while (true) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    if (!dates.has(key)) break
    streak++
    cur.setDate(cur.getDate() - 1)
  }
  return streak
}

export async function getHabits(): Promise<Habit[]> {
  const habits = await wordDB.getAllHabits()
  const out: Habit[] = []
  for (const h of habits) {
    const log = await wordDB.getHabitLog(h.id)
    const dates = new Set(log.map((l: any) => l.date))
    out.push({
      id: h.id,
      name: h.name,
      goal: h.goal || 21,
      medalAt: h.medalAt || '',
      createdAt: h.createdAt,
      streak: computeStreak(dates),
      total: dates.size,
      today: dates.has(todayStr())
    })
  }
  return out
}

export async function addHabit(name: string, goal = 21): Promise<{ ok: boolean; error?: string }> {
  const n = name.trim().slice(0, 40)
  if (!n) return { ok: false, error: '需要习惯名' }
  const existing = await wordDB.getAllHabits()
  if (existing.some((h: any) => h.name === n)) return { ok: false, error: '已有同名习惯' }
  const createdAt = new Date().toISOString()
  const id = await wordDB.addHabit({ name: n, goal: Math.max(1, goal || 21), medalAt: '', createdAt })
  be.beSaveHabit({ id, name: n, goal: Math.max(1, goal || 21), medalAt: '', createdAt })
  return { ok: true }
}

export async function deleteHabit(id: number): Promise<void> {
  await wordDB.deleteHabit(id)
  be.beDeleteHabit(id)
}

export async function checkinHabit(id: number): Promise<{ ok: boolean; reachedGoal: boolean }> {
  const inserted = await wordDB.checkinHabit(id, todayStr())
  if (!inserted) return { ok: false, reachedGoal: false }
  be.beCheckinHabit(id, todayStr())
  const habits = await wordDB.getAllHabits()
  const h = habits.find((x: any) => x.id === id)
  if (!h) return { ok: true, reachedGoal: false }
  const log = await wordDB.getHabitLog(id)
  const dates = new Set(log.map((l: any) => l.date))
  const streak = computeStreak(dates)
  let reachedGoal = false
  if (streak >= (h.goal || 21) && !h.medalAt) {
    const medalAt = new Date().toISOString()
    await wordDB.updateHabit(id, { medalAt })
    be.beSaveHabit({ id, name: h.name, goal: h.goal || 21, medalAt, createdAt: h.createdAt })
    reachedGoal = true
  }
  return { ok: true, reachedGoal }
}
