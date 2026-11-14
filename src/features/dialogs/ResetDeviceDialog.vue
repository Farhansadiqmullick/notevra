<script setup lang="ts">
import { ref } from 'vue';
import BaseButton from '@/components/primitives/BaseButton.vue';

defineProps<{ email: string; unsynced: number; images: number; exporting: boolean }>();
const emit = defineEmits<{ confirm: []; export: []; close: [] }>();

const busy = ref(false);

function confirm() {
  if (busy.value) return;
  busy.value = true;
  emit('confirm');
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="alertdialog" aria-modal="true" aria-label="Reset this device">
      <header class="head">
        <h2>Reset this device?</h2>
        <p>
          Everything stored in this browser is deleted, then your pages are downloaded again from
          <strong>{{ email }}</strong>. Use this when sync is stuck and trying again doesn’t help.
        </p>
      </header>

      <div class="body">
        <p class="lbl">Lost for good</p>
        <ul class="lost">
          <li v-if="unsynced > 0" class="bad">
            {{ unsynced }} change{{ unsynced === 1 ? '' : 's' }} that haven’t reached the server
          </li>
          <li>Pages in the Trash that were never synced</li>
          <li v-if="images > 0">{{ images }} image{{ images === 1 ? '' : 's' }} — images are only stored on this device</li>
          <li>Page history and the activity feed on this device</li>
        </ul>
        <div class="save">
          <span>Save a copy of everything first</span>
          <BaseButton size="sm" variant="bordered" :disabled="exporting || busy" @click="emit('export')">
            {{ exporting ? 'Preparing…' : 'Download JSON' }}
          </BaseButton>
        </div>
      </div>

      <footer class="foot">
        <BaseButton variant="ghost" :disabled="busy" @click="emit('close')">Cancel</BaseButton>
        <button type="button" class="danger" :disabled="busy" @click="confirm">
          {{ busy ? 'Resetting…' : 'Delete and re-download' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(480px, 100%); background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); }
.head { padding: 22px 24px 16px; border-bottom: 1px solid var(--border); }
.head h2 { font: 800 18px var(--font-ui); color: var(--ink); margin: 0; }
.head p { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); margin: 6px 0 0; overflow-wrap: anywhere; }

.body { padding: 16px 24px 4px; }
.lbl { font: 700 10px var(--font-ui); letter-spacing: 0.5px; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 8px; }
.lost { margin: 0; padding-inline-start: 18px; display: flex; flex-direction: column; gap: 5px; font: 500 12.5px/1.5 var(--font-ui); color: var(--ink-body); }
.lost .bad { color: var(--danger); font-weight: 700; }
.save { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; padding: 10px 12px; border-radius: var(--r-item); background: var(--surface-subtle); font: 500 12px var(--font-ui); color: var(--ink-muted); }

.foot { display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding: 16px 24px 20px; }
.danger { border: none; background: var(--danger); color: #fff; cursor: pointer; border-radius: var(--r-control); padding: 8px 14px; font: 700 12.5px var(--font-ui); }
.danger:disabled { opacity: 0.6; cursor: default; }

@media (max-width: 900px) {
  .scrim { padding: 12px; align-items: end; }
  .save { flex-direction: column; align-items: stretch; }
  .foot { flex-direction: column-reverse; align-items: stretch; padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
  .foot :deep(button), .danger { inline-size: 100%; justify-content: center; }
}
</style>
