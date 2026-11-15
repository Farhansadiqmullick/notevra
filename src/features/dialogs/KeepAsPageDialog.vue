<script setup lang="ts">
// Turns the Temp note into a real page: name, type and where it goes. The parent does the write.
import { computed, ref, onMounted } from 'vue';
import BaseButton from '@/components/primitives/BaseButton.vue';
import { useNotesStore } from '@/stores/notes.store';
import type { PageType } from '@/types/models';

const props = withDefaults(defineProps<{ type?: PageType }>(), { type: 'planning' });
const emit = defineEmits<{ keep: [page: { title: string; type: PageType; workspaceId: string }]; close: [] }>();

const notesStore = useNotesStore();
const places = computed(() =>
  notesStore.targetWorkspaces.map((ws) => ({ id: ws.id, name: ws.kind === 'personal' ? 'Personal' : ws.name })),
);

const types: { id: PageType; name: string; desc: string }[] = [
  { id: 'planning', name: 'Planning', desc: 'Plan and write in one place; tasks live inline with prose. Keeps the layout it has now.' },
  { id: 'archive', name: 'Archive list', desc: 'A long, recurring list; read any item without leaving the list.' },
  { id: 'single', name: 'Blank page', desc: 'An empty page. Just start writing and add any block you need.' },
];

const title = ref('');
const type = ref<PageType>(props.type);
const workspaceId = ref(places.value[0]?.id ?? '');
const nameInput = ref<HTMLInputElement | null>(null);
onMounted(() => nameInput.value?.focus());

const typeName = computed(() => types.find((t) => t.id === type.value)?.name ?? 'page');
const ready = computed(() => title.value.trim() !== '' && workspaceId.value !== '');

function keep() {
  if (!ready.value) return;
  emit('keep', { title: title.value.trim(), type: type.value, workspaceId: workspaceId.value });
}
</script>

<template>
  <div class="scrim" @keydown.esc="emit('close')">
    <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="keep-title" @submit.prevent="keep">
      <header class="head">
        <h2 id="keep-title">Keep as a page</h2>
        <p>Everything in your Temp note moves to this page. The Temp note then starts empty again.</p>
      </header>

      <div class="body">
        <label class="field">
          <span class="lbl">Page name</span>
          <input ref="nameInput" v-model="title" class="input" type="text" placeholder="Name this page" />
        </label>

        <div class="field">
          <span class="lbl">Turn it into</span>
          <div class="grid">
            <button
              v-for="t in types"
              :key="t.id"
              type="button"
              class="card"
              :class="{ on: type === t.id }"
              :aria-pressed="type === t.id"
              @click="type = t.id"
            >
              <span class="name">{{ t.name }}</span>
              <span class="desc">{{ t.desc }}</span>
            </button>
          </div>
        </div>

        <label class="field">
          <span class="lbl">Put it in</span>
          <select v-model="workspaceId" class="input">
            <option v-for="p in places" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
      </div>

      <footer class="foot">
        <span class="hint">You can still change the type later from the page menu.</span>
        <div class="spacer" />
        <BaseButton type="button" variant="ghost" @click="emit('close')">Cancel</BaseButton>
        <BaseButton type="submit" variant="primary" :disabled="!ready">Keep as {{ typeName }}</BaseButton>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(720px, 100%); max-block-size: 90vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); margin: 0; }

.head { padding: 24px 28px 18px; border-bottom: 1px solid var(--border); }
.head h2 { font: 800 21px var(--font-ui); color: var(--ink); margin: 0; }
.head p { font: 400 13px/1.6 var(--font-ui); color: var(--ink-muted); margin: 6px 0 0; }

.body { display: grid; gap: 18px; padding: 20px 28px; }
.field { display: grid; gap: 6px; }
.lbl { font: 700 12px var(--font-ui); color: var(--ink-body); }
.input { block-size: 42px; box-sizing: border-box; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: var(--r-control); background: var(--surface); font: 400 15px var(--font-ui); color: var(--ink); }
.input:focus { outline: none; border-color: var(--accent); }

.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: start; padding: 14px; border: 1.5px solid var(--border); border-radius: var(--r-card); background: var(--surface); cursor: pointer; transition: border-color 120ms ease-out, background-color 120ms ease-out, box-shadow 120ms ease-out; }
.card:hover { border-color: var(--border-hover); background: var(--surface-sunken); }
.card.on { border-color: var(--accent); box-shadow: 0 10px 24px -14px color-mix(in srgb, var(--accent) 55%, transparent); }
.card .name { font: 700 14px var(--font-ui); color: var(--ink-body); }
.card .desc { font: 400 12px/1.5 var(--font-ui); color: var(--ink-muted); }

.foot { display: flex; align-items: center; gap: 10px; padding: 16px 28px 22px; border-top: 1px solid var(--border); }
.hint { font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.spacer { flex: 1; }

/* phones: a bottom sheet, one column, the buttons stay in reach */
@media (max-width: 900px) {
  .scrim { padding: 12px; align-items: end; }
  .dialog { max-block-size: min(92vh, 100%); }
  .head { padding: 20px 18px 16px; }
  .head h2 { font-size: 18px; }
  .body { padding: 16px 18px; }
  .grid { grid-template-columns: 1fr; gap: 10px; }
  .foot { position: sticky; inset-block-end: 0; flex-direction: column; align-items: stretch; padding: 14px 18px calc(16px + env(safe-area-inset-bottom)); background: var(--surface); }
  .hint { text-align: center; }
  .spacer { display: none; }
  .foot :deep(button) { inline-size: 100%; justify-content: center; }
}
</style>
