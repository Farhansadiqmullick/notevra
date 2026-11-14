<script setup lang="ts">
/**
 * LibraryHandoverDialog — the one question a sign-in is allowed to interrupt with.
 *
 * This device already holds notes, and the account signing in has a library of its own. There is no
 * answer the app can work out on its own: the notes here might be this person's own work waiting to
 * be uploaded, or they might belong to whoever used this browser before. Both readings are common
 * and getting it wrong is expensive in opposite directions.
 *
 * ── What it deliberately is not ──────────────────────────────────────────────────────────────────
 * Not a warning, and not a merge wizard. **Neither answer deletes anything**, which is the whole
 * reason this can be a single calm question rather than a confirmation with a red button: whatever
 * is set aside goes to a shelf in Settings and can be brought back, exported, or discarded later,
 * by someone who has had time to look at it.
 *
 * It appears only above a threshold (`ASK_ABOVE_NOTES` in App.vue). Interrupting a sign-in to
 * discuss six demo pages is how a correct rule becomes an irritating one.
 */
import BaseButton from '@/components/primitives/BaseButton.vue';
import type { LibraryChoice } from '@/stores/ui.store';

defineProps<{ noteCount: number }>();
const emit = defineEmits<{ choose: [keep: LibraryChoice] }>();
</script>

<template>
  <!--
    No `@click.self` close and no escape route, unlike every other dialog here. Sign-in is waiting
    on the answer, and a dismissal would have to mean one of the two options anyway — better to ask
    plainly than to pick on someone's behalf and call it a cancel.
  -->
  <div class="scrim">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Which notes come first">
      <header class="head">
        <h2>Which notes come first?</h2>
        <p>
          There {{ noteCount === 1 ? 'is' : 'are' }} <strong>{{ noteCount }}</strong>
          {{ noteCount === 1 ? 'note' : 'notes' }} on this device, and the account you just signed
          into has its own. Nothing is deleted either way.
        </p>
      </header>

      <div class="choices">
        <button class="choice" @click="emit('choose', 'account')">
          <span class="name">This account’s notes</span>
          <span class="desc">
            Download the account’s library. The {{ noteCount }} notes here are set aside on a shelf
            in Settings — you can restore, export or remove them whenever you like. Syncing stays
            paused until you deal with them.
          </span>
          <span class="tag safe">Recommended · nothing leaves this device</span>
        </button>

        <button class="choice" @click="emit('choose', 'device')">
          <span class="name">The notes on this device</span>
          <span class="desc">
            Keep them where they are and upload them to this account. The account’s own library
            arrives alongside, so you will see both sets together.
          </span>
          <span class="tag">Uploads {{ noteCount }} notes to this account</span>
        </button>
      </div>

      <footer class="foot">
        <span class="hint">You can change your mind afterwards in Settings → Sync &amp; Storage.</span>
        <BaseButton size="sm" variant="bordered" @click="emit('choose', 'account')">
          Decide later
        </BaseButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  display: grid;
  place-items: center;
  padding: 24px;
  z-index: 60;
}
.dialog {
  inline-size: min(560px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-modal);
  box-shadow: var(--sh-modal);
  padding: 26px 26px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.head { display: flex; flex-direction: column; gap: 8px; }
.head h2 { margin: 0; font: 700 19px var(--font-ui); color: var(--ink); letter-spacing: -0.01em; }
.head p { margin: 0; font: 400 13px/1.65 var(--font-ui); color: var(--ink-muted); }
.head strong { color: var(--ink-body); font-weight: 700; }

.choices { display: flex; flex-direction: column; gap: 10px; }
.choice {
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: start;
  padding: 14px 16px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-card);
  background: var(--surface-subtle);
  cursor: pointer;
  font-family: inherit;
}
.choice:hover { border-color: var(--accent); }
.choice:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.name { font: 700 14px var(--font-ui); color: var(--ink); }
.desc { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); }
.tag {
  margin-top: 3px;
  font: 700 10px var(--font-ui);
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.tag.safe { color: var(--success-deep); }

.foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hint { font: 400 11.5px var(--font-ui); color: var(--ink-faint); }

@media (max-width: 520px) {
  .foot { flex-direction: column; align-items: stretch; }
}
</style>
