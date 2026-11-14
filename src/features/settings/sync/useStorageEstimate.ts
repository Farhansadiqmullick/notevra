import { computed, ref } from 'vue';

// module-level so an import can refresh the figure the storage card shows
const storage = ref<{ usage: number; quota: number } | null>(null);
const storagePct = computed(() => (storage.value?.quota ? (storage.value.usage / storage.value.quota) * 100 : 0));

async function readStorage() {
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    storage.value = { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  }
}

export const mb = (b: number) => (b / 1024 / 1024).toFixed(1) + ' MB';

export function useStorageEstimate() {
  return { storage, storagePct, readStorage };
}
