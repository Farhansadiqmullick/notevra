<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import { isDesktopApp } from '@/core/auth/desktopAuthLink';

const emit = defineEmits<{ error: [message: string]; waiting: [] }>();
const auth = useAuthStore();
const busy = ref(false);
// desktop stays open while the browser does the sign-in, so say where to look
const waiting = ref(false);

async function go() {
  busy.value = true;
  const res = await auth.signInWithGoogle();
  busy.value = false;
  if (!res.ok) return emit('error', res.error ?? 'Google sign-in didn’t start.');
  if (!isDesktopApp()) return;
  waiting.value = true;
  emit('waiting');
}
</script>

<template>
  <div class="google">
    <button type="button" class="gbtn" :disabled="busy" @click="go">
      <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      <span>{{ busy ? 'Opening Google…' : 'Continue with Google' }}</span>
    </button>
    <p v-if="waiting" class="hint">Finish signing in in your browser — Notevra will pick it up when you’re done.</p>
    <div class="or" aria-hidden="true"><span>or with email</span></div>
  </div>
</template>

<style scoped>
.google { padding: 18px 26px 0; }
.gbtn {
  inline-size: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  padding: 11px 14px; border: 1.5px solid var(--border-strong); border-radius: var(--r-control);
  background: var(--surface); color: var(--ink-body); cursor: pointer;
  font: 700 13.5px var(--font-ui), system-ui, sans-serif;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}
.gbtn:hover:not(:disabled) { background: var(--surface-sunken); border-color: var(--border-hover); }
.gbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.gbtn:disabled { opacity: 0.6; cursor: default; }
.hint { margin: 8px 0 0; font: 500 11.5px/1.5 var(--font-ui); color: var(--ink-muted); text-align: center; }
.or { display: flex; align-items: center; gap: 10px; margin-top: 16px; font: 600 10.5px var(--font-ui); letter-spacing: 0.4px; color: var(--ink-faint); text-transform: uppercase; }
.or::before, .or::after { content: ''; flex: 1; block-size: 1px; background: var(--border); }
@media (max-width: 900px) { .google { padding: 16px 18px 0; } }
</style>
