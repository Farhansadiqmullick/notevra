import { ref, watch, type Ref } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import type { AuthMode } from './authCopy';

// Advisory only: handle_new_user() suffixes a clash server-side, so a taken name still signs up.
export function useDisplayNameCheck(mode: Ref<AuthMode>) {
  const auth = useAuthStore();
  const displayName = ref('');
  const nameState = ref<'idle' | 'checking' | 'free' | 'taken'>('idle');
  const suggestion = ref('');
  let nameTimer: ReturnType<typeof setTimeout> | undefined;

  watch(displayName, (raw) => {
    const wanted = raw.trim();
    clearTimeout(nameTimer);
    suggestion.value = '';
    if (mode.value !== 'signup' || !wanted) return (nameState.value = 'idle');
    nameState.value = 'checking';
    nameTimer = setTimeout(async () => {
      const free = await auth.isDisplayNameFree(wanted);
      // a slower answer for a name they have since edited must not overwrite the current one
      if (displayName.value.trim() !== wanted) return;
      if (free === null) return (nameState.value = 'idle'); // offline, or no server — let it through
      nameState.value = free ? 'free' : 'taken';
      if (!free) suggestion.value = await auth.suggestDisplayName(wanted);
    }, 400);
  });

  return { displayName, nameState, suggestion };
}
