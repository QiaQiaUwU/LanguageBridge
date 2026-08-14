import { ref } from 'vue'

export const storagePersisted = ref<boolean | null>(null)
export const storagePersistDismissed = ref(false)

export async function requestPersistentStorage(): Promise<void> {
  if (!navigator.storage?.persist) {
    storagePersisted.value = null
    return
  }
  try {
    storagePersisted.value = await navigator.storage.persist()
  } catch {
    storagePersisted.value = null
  }
}
