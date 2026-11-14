<script setup lang="ts">
/**
 * NoticeHost — where the `.notice` bars float. Mounted once, in App.vue.
 *
 * The bar itself is a global class (theme/base.css); this component only decides WHERE it sits and
 * when it goes away, which is the part that changes with the viewport:
 *
 *   ≥ 901px  top-right, under the header — a mouse is already up there, and the bottom-right corner
 *            is taken by the conflict banner and the update prompt, which are permanent.
 *   ≤ 900px  along the bottom, above the tab bar and the safe area, where a thumb can reach the ✕
 *            without a stretch to the top of the screen.
 *
 * The 900px switch is the same one that turns the sidebar into a drawer and puts the tab bar up
 * (useBreakpoint.isMobile), so a tablet gets the bottom placement too — it has the tab bar, so it
 * has the same reachable corner a phone does. Done in CSS rather than with the composable so it is
 * correct mid-resize with no reactive round-trip.
 */
import { onUnmounted } from 'vue';
import { useNoticeStore, type Notice } from '@/stores/notice.store';

const notices = useNoticeStore();

// timers outlive the component otherwise; nothing else owns them
onUnmounted(() => notices.clear());

// run first: the action may check that its own bar is still showing
function runAction(n: Notice) {
  void n.action?.run();
  notices.dismiss(n.id);
}
</script>

<template>
  <!--
    `aria-live="polite"` on the CONTAINER, which must exist in the DOM before anything is announced
    — a live region that appears at the same moment as its first message is not reliably read out.
    That is why there is no `v-if` on the wrapper, only on what it holds.
  -->
  <div class="notice-host" role="status" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="notice">
      <div v-for="n in notices.notices" :key="n.id" class="notice" :class="`notice--${n.variant}`">
        <span class="notice__dot" aria-hidden="true" />
        <span class="notice__text">{{ n.message }}</span>
        <button v-if="n.action" class="notice__action" type="button" @click="runAction(n)">{{ n.action.label }}</button>
        <button
          class="notice__close tap-target"
          type="button"
          aria-label="Dismiss"
          @click="notices.dismiss(n.id)"
        >
          ✕
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.notice-host {
  position: fixed;
  z-index: 120; /* above the conflict banner (110) and the update prompt (111) */
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* the empty column must not swallow clicks meant for the page under it */
  pointer-events: none;

  /* desktop: top-right, clear of the 52px header bar */
  inset-block-start: 64px;
  inset-inline-end: 18px;
  inline-size: min(360px, calc(100vw - 36px));
}

.notice-host :deep(.notice) {
  pointer-events: auto;
  box-shadow: var(--sh-modal);

  /*
   * An OPAQUE version of the same fill.
   *
   * In dark mode the state tints are `color-mix(… , transparent)` — correct for a chip, which sits
   * on a known surface, and wrong for a bar floating over the document: the task text underneath
   * showed straight through the message. Painting the tint as a flat gradient over `--surface`
   * gives exactly the intended colour with nothing behind it, in both modes, without changing what
   * the token means anywhere else.
   */
  background-color: var(--surface);
  background-image: linear-gradient(var(--notice-fill), var(--notice-fill));
}

/*
 * Phone and tablet: along the bottom, in the thumb's reach.
 *
 * The offset clears the whole bottom stack, not just the tab bar: 64px of tab bar, then the FAB
 * sitting 80px up and 56px tall (MobileFab.vue). Anchoring to the tab bar alone put a full-width
 * bar straight through the middle of the FAB — the notice won on z-index, so a transient message
 * covered the one permanent action on the screen. 146px starts just above it.
 *
 * `column-reverse` with the newest-first list puts the newest bar closest to the bottom edge, so a
 * second message pushes the older one UP rather than shifting the one being read.
 *
 * For its few seconds this can still cover the conflict banner in the same corner. That one is the
 * right trade: the banner is permanent and will be there after the notice goes, while a notice that
 * had to dodge every floating element in the app would need to know about all of them.
 */
@media (max-width: 900px) {
  .notice-host {
    flex-direction: column-reverse;
    inset-block-start: auto;
    inset-block-end: calc(146px + env(safe-area-inset-bottom));
    inset-inline: 12px;
    inline-size: auto;
  }
}

/* enter/leave: from the edge the bar lives on, so it reads as arriving rather than appearing */
.notice-enter-active,
.notice-leave-active {
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}
.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
/* leaving must not drag the survivors with it */
.notice-leave-active {
  position: absolute;
  inline-size: 100%;
}
.notice-move {
  transition: transform 180ms ease-out;
}

@media (max-width: 900px) {
  .notice-enter-from,
  .notice-leave-to {
    transform: translateY(8px); /* it comes from the bottom down here */
  }
}

@media (prefers-reduced-motion: reduce) {
  .notice-enter-active,
  .notice-leave-active,
  .notice-move {
    transition: opacity 100ms linear;
  }
  .notice-enter-from,
  .notice-leave-to {
    transform: none;
  }
}

.notice__action {
  flex: none; border: none; cursor: pointer; border-radius: var(--r-row);
  padding: 4px 10px; margin-block: -4px;
  font-family: inherit; font-size: 12px; font-weight: 700; line-height: 1.2;
  color: var(--accent-deep); background: color-mix(in srgb, var(--accent) 12%, transparent);
  transition: background-color 120ms ease-out;
}
.notice__action:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
</style>
