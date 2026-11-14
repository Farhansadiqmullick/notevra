<script setup lang="ts">
/**
 * BaseCheckbox — the checkbox primitive.
 * Spec: design_skiil.md §"Checkbox spec (all sizes)".
 *
 * Boundary: this is ONLY the box. The task title, its line-through and opacity .45
 * when checked, are the parent row's job (see scope note in the build turn) — a primitive
 * takes props in and emits intent out, it never knows what it's labelling.
 *
 * Sizes used in the design: 16, 18 (default), 19, 22. radius = size / 3.
 */
withDefaults(
  defineProps<{
    size?: number;
    disabled?: boolean;
    /** dashed outline — the "Add item / Add task" affordance, never a real checked state */
    dashed?: boolean;
    ariaLabel?: string;
  }>(),
  { size: 18, disabled: false, dashed: false, ariaLabel: 'Toggle' },
);

/** two-way boolean; parent owns the truth, we only request the flip */
const checked = defineModel<boolean>({ default: false });

const emit = defineEmits<{ change: [value: boolean] }>();

function toggle() {
  checked.value = !checked.value;
  emit('change', checked.value); // lets a row log activity / queue an op without watching the model
}
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="checked"
    :aria-label="ariaLabel"
    :disabled="disabled"
    class="cbx tap-target"
    :class="{ 'is-checked': checked, 'is-dashed': dashed, 'is-disabled': disabled }"
    :style="{ '--sz': size + 'px' }"
    @click="toggle"
    @keydown.space.prevent="toggle"
    @keydown.enter.prevent="toggle"
  >
    <span class="tick" aria-hidden="true" />
  </button>
</template>

<style scoped>
.cbx {
  --sz: 18px;
  inline-size: var(--sz);
  block-size: var(--sz);
  /*
   * Never shrink. As a flex item the default `flex: 0 1 auto` let a tight row squeeze the box
   * horizontally but not vertically, so on a narrow screen an 18×18 checkbox rendered 14×18 — a
   * lopsided pill that reads as a rendering fault. It is a fixed-size control; the text beside it
   * is what should give way.
   */
  flex: none;
  padding: 0;
  display: inline-grid;
  place-items: center;
  border-radius: calc(var(--sz) / 3);
  border: 1.7px solid var(--ink-ghost);        /* #a7adc2-family, per spec */
  background: transparent;
  cursor: pointer;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}
.cbx:hover:not(.is-disabled) { border-color: var(--border-hover); }

.is-dashed { border-style: dashed; }

.is-checked {
  background: var(--success);                   /* #23a87e */
  border-color: var(--success);
}

.is-disabled { cursor: not-allowed; opacity: 0.5; }

/* the tick: a box with right+bottom borders, rotated +45° → a correctly-oriented ✓.
 * (design_skiil.md wrote "left+bottom / -45°", which renders mirrored — corrected here.) */
.tick {
  inline-size: calc(var(--sz) * 0.32);
  block-size: calc(var(--sz) * 0.56);
  border-right: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: translateY(-9%) rotate(45deg);
  opacity: 0;
  transition: opacity 90ms ease-out;
}
.is-checked .tick { opacity: 1; }

/* keyboard focus ring uses the active accent so it matches every palette */
.cbx:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
