<script setup lang="ts">
// Personal is never shared; a page leaves it for a project instead (design/collaboration-and-sharing.md §6.1).
import { computed, ref, onMounted } from 'vue';
import { useNotesStore } from '@/stores/notes.store';
import BaseButton from '@/components/primitives/BaseButton.vue';
import AppIcon from '@/components/primitives/AppIcon.vue';

defineProps<{ noteTitle: string }>();
const emit = defineEmits<{ move: [target: { id: string } | { name: string }]; close: [] }>();

const notesStore = useNotesStore();
const projects = computed(() => notesStore.targetWorkspaces.filter((ws) => ws.kind !== 'personal'));

const creating = ref(projects.value.length === 0);
const picked = ref(projects.value[0]?.id ?? '');
const newName = ref('');
const nameField = ref<HTMLInputElement | null>(null);
const busy = ref(false);

const ready = computed(() => (creating.value ? !!newName.value.trim() : !!picked.value));

function startNew() {
  creating.value = true;
  setTimeout(() => nameField.value?.focus(), 0);
}

function submit() {
  if (!ready.value || busy.value) return;
  busy.value = true;
  emit('move', creating.value ? { name: newName.value.trim() } : { id: picked.value });
}

onMounted(() => { if (creating.value) nameField.value?.focus(); });
</script>

<template>
  <div class="scrim" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Move page to a project">
      <header class="head">
        <div>
          <h2>Share “{{ noteTitle }}”</h2>
          <p>It is in your Personal space, which stays private. Move it to a project, then share the project.</p>
        </div>
        <button class="x" aria-label="Close" @click="emit('close')"><AppIcon name="close" /></button>
      </header>

      <div class="body">
        <label class="lbl">Move it to a project</label>
        <div v-if="!creating" class="row">
          <select v-model="picked" class="pick" :disabled="busy">
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <button type="button" class="new" :disabled="busy" @click="startNew">+ New project</button>
        </div>
        <div v-else class="row">
          <input
            ref="nameField"
            v-model="newName"
            class="pick"
            type="text"
            placeholder="New project name"
            :disabled="busy"
            @keydown.enter.prevent="submit"
          />
          <button v-if="projects.length" type="button" class="new" :disabled="busy" @click="creating = false">
            Pick existing
          </button>
        </div>
        <p class="hint">Everyone you share the project with will be able to open this page.</p>
      </div>

      <footer class="foot">
        <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="!ready || busy" @click="submit">Move page</BaseButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(480px, 100%); background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); }
.head { display: flex; align-items: flex-start; gap: 12px; padding: 22px 24px 16px; border-bottom: 1px solid var(--border); }
.head h2 { font: 800 18px var(--font-ui); color: var(--ink); margin: 0; overflow-wrap: anywhere; }
.head p { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); margin: 5px 0 0; }
.x { margin-inline-start: auto; border: none; background: none; cursor: pointer; font-size: 14px; color: var(--ink-faint); padding: 4px; }
.x:hover { color: var(--ink-body); }

.body { padding: 16px 24px 6px; }
.lbl { display: block; font: 700 10px var(--font-ui); letter-spacing: 0.5px; text-transform: uppercase; color: var(--ink-faint); margin-bottom: 8px; }
.row { display: flex; align-items: center; gap: 8px; }
.pick { flex: 1; min-inline-size: 0; border: 1px solid var(--border-strong); border-radius: var(--r-control); padding: 8px 10px; font: 500 13px var(--font-ui); color: var(--ink-body); background: var(--surface); }
.pick:focus { outline: none; border-color: var(--accent); }
.new { border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 8px 10px; font: 600 12px var(--font-ui); color: var(--ink-muted); white-space: nowrap; }
.new:hover:not(:disabled) { border-color: var(--border-hover); color: var(--ink-body); }
.hint { margin: 8px 0 0; font: 500 11.5px/1.5 var(--font-ui); color: var(--ink-faint); }

.foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px 20px; }

@media (max-width: 900px) {
  .scrim { padding: 12px; align-items: end; }
  .row { flex-wrap: wrap; }
  .pick { flex-basis: 100%; }
  .foot { flex-direction: column-reverse; padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
  .foot :deep(button) { inline-size: 100%; justify-content: center; }
}
</style>
