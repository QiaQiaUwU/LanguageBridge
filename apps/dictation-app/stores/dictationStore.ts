import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useDictationStore = defineStore('dictation', () => {

  const currentWord = ref<any>(null)
  const mistakes = ref<Array<{ word: string; userInput: string; correct: string }>>([])
  const correctCount = ref<number>(0)
  const totalCount = ref<number>(0)
  const currentMode = ref<'word' | 'definition' | 'sentence'>('word')
  const learningHistory = ref<Array<{
    word: string
    timestamp: string
    correctness: boolean
    responseTime: number
  }>>([])

  function recordAnswer(word: string, userInput: string, isCorrect: boolean) {
    totalCount.value++
    if (isCorrect) {
      correctCount.value++
    } else {
      mistakes.value.push({
        word,
        userInput,
        correct: word
      })
    }

    learningHistory.value.push({
      word,
      timestamp: new Date().toISOString(),
      correctness: isCorrect,
      responseTime: Date.now()
    })
  }

  function clearMistakes() {
    mistakes.value = []
  }

  function setMode(mode: 'word' | 'definition' | 'sentence') {
    currentMode.value = mode
  }

  function resetStats() {
    correctCount.value = 0
    mistakes.value = []
    totalCount.value = 0
  }

  return {
    currentWord,
    currentMode,
    mistakes,
    correctCount,
    totalCount,
    learningHistory,

    recordAnswer,
    clearMistakes,
    setMode,
    resetStats
  }
})
