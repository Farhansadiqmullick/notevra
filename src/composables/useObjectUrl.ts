/**
 * useObjectUrl — resolve a stored blob's checksum to a renderable object URL, and REVOKE it when
 * the checksum changes or the component unmounts. Object URLs pin their blob in memory until
 * revoked, so leaking them leaks megabytes; keeping that discipline in one composable means no
 * block component has to remember it.
 */
import { ref, watch, onScopeDispose, type Ref } from 'vue';
import { storage } from '@/core/media/storage';

export function useObjectUrl(checksum: Ref<string | undefined>): Ref<string | null> {
  const url = ref<string | null>(null);

  function release() {
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = null;
  }

  watch(
    checksum,
    async (cs) => {
      release();
      if (!cs) return;
      const next = await storage.url(cs);
      // guard against a race: the checksum may have changed while we awaited
      if (checksum.value === cs) url.value = next;
      else if (next) URL.revokeObjectURL(next);
    },
    { immediate: true },
  );

  onScopeDispose(release);
  return url;
}
