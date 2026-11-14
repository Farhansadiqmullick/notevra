// Copy, duplicate and paste for BlockDocument.
import { ref, nextTick, onMounted, onUnmounted, type ComputedRef } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { blockService } from '@/services/block.service';
import {
  toPlainText, toHtml, envelopeFromHtml, parseEnvelope, fromPlainText, CLIP_FORMAT, CLIP_VERSION, type ClipEnvelope,
} from '@/core/editor/clipboard';
import { markdownToBlocks, isMultiLine, isMarkdownLine } from '@/core/editor/pasteMarkdown';
import { logger } from '@/core/logging/logger';
import { detectPastedMedia, type PastedMedia } from '@/core/media/pastedMedia';
import { probeImageUrl } from '@/core/media/imageUrl';
import { useNoticeStore } from '@/stores/notice.store';
import { attachmentService } from '@/services/attachment.service';
import { storage } from '@/core/media/storage';
import { toPngBlob } from '@/core/media/toPng';
import { PROVIDER_LABEL } from '@/core/media/videoUrl';
import { db, type BlockRow } from '@/core/db/schema';

/**
 * @param props the document's props, read at call time so they stay live
 * @param selectedInOrder the marked blocks in document order
 */
export function useDocClipboard(
  props: { readonly noteId: string; readonly blocks: BlockRow[] },
  selectedInOrder: ComputedRef<string[]>,
) {
  const ui = useUiStore();
  const notices = useNoticeStore();
  const log = logger.scoped('BlockDocument');
  const copied = ref(false);

  async function copySelection() {
    const ids = selectedInOrder.value.length ? selectedInOrder.value : [];
    if (!ids.length) return;
    const envelope = await blockService.copyBlocks(ids);
    const text = toPlainText(envelope.blocks);
    // one image block also goes up as a picture, so it pastes into other apps
    const png = ids.length === 1 ? await imagePng(ids[0]!) : null;
    try {
      // envelope rides on text/html so text/plain stays readable when the browser pastes it itself
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        const items: Record<string, Blob> = {
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([toHtml(envelope)], { type: 'text/html' }),
        };
        if (png) items['image/png'] = png;
        await navigator.clipboard.write([new ClipboardItem(items)]);
        if (png) notices.info('Image copied');
      } else {
        await navigator.clipboard.writeText(text); // no ClipboardItem: readable text only
      }
      copied.value = true;
      setTimeout(() => (copied.value = false), 1400);
    } catch (e) {
      log.warn('clipboard write failed', { e });
    }
  }

  async function imagePng(id: string): Promise<Blob | null> {
    const row = await db.blocks.get(id);
    if (row?.type !== 'image') return null;
    try {
      const checksum = row.props?.attachmentId as string | undefined;
      const src = row.props?.src as string | undefined;
      const blob = checksum ? (await storage.get(checksum))?.blob : src ? await (await fetch(src)).blob() : undefined;
      return blob ? await toPngBlob(blob) : null;
    } catch (e) {
      // a remote image whose server refuses cross-origin reads: the link still copies as text
      log.debug('image copy skipped', { e });
      return null;
    }
  }

  async function duplicateSelection() {
    const ids = selectedInOrder.value;
    if (!ids.length) return;
    const envelope = await blockService.copyBlocks(ids);
    await blockService.pasteBlocks(props.noteId, envelope, { after: ids[ids.length - 1] });
    ui.clearSelection();
  }

  // copied blocks paste as blocks even with the caret in a block; foreign text there pastes as text
  async function onPaste(e: ClipboardEvent) {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.closest('.scrim')) return;

    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain');
    const imageFile = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    const plain = plainNext;
    plainNext = false;
    if (!html && !text && !imageFile) return;

    // our own copy → envelope on text/html (the JSON tail keeps older clipboards working)
    let envelope = html ? envelopeFromHtml(html) : null;
    if (!envelope && text) {
      const brace = text.indexOf(`{"format":"${CLIP_FORMAT}"`);
      envelope = brace >= 0 ? parseEnvelope(text.slice(brace)) : parseEnvelope(text);
    }
    // a screenshot or copied picture becomes an image block
    if (!envelope && imageFile) {
      e.preventDefault();
      return pasteImageFile(imageFile, target);
    }
    // a lone image or video link becomes that block (Ctrl+Shift+V keeps it as text)
    const media = envelope || plain ? null : (detectPastedMedia(text ?? '') ?? imageFromHtml(html, text));
    if (media) {
      e.preventDefault();
      return embedPasted(media, target);
    }

    if (!envelope && target?.isContentEditable) {
      const into = text ? markdownTarget(target, text) : undefined;
      if (!into) return; // foreign text into a block → plain paste
      e.preventDefault(); // before any await, or the browser has already pasted
      return pasteMarkdownInto(into, text!);
    }

    const payload = envelope ?? { format: CLIP_FORMAT, version: CLIP_VERSION, blocks: fromPlainText(text ?? '') };
    if (!payload.blocks.length) return;
    e.preventDefault();

    // land right after the block you're in, else after the marked ones, else at the end
    const caretBlock = (target?.closest('.blk') as HTMLElement | null)?.dataset.blockId;
    const after =
      caretBlock ??
      selectedInOrder.value[selectedInOrder.value.length - 1] ??
      props.blocks[props.blocks.length - 1]?.id;

    const ids = await blockService.pasteBlocks(props.noteId, payload as never, { after });
    ui.clearSelection();
    if (ids[0]) ui.setFocus(ids[0]);
  }

  async function embedPasted(media: PastedMedia, target: HTMLElement | null) {
    let mediaProps: Record<string, unknown>;
    if (media.kind === 'video') {
      mediaProps = { provider: media.video.provider, videoId: media.video.videoId, url: media.video.url };
    } else {
      try {
        const { width, height } = await probeImageUrl(media.url, 8000);
        mediaProps = { src: media.url, width, height };
      } catch {
        // it does not load as an image, so it lands as the text that was pasted
        await placeBlock('paragraph', {}, target, media.url);
        notices.info('That link didn’t load as an image, so it was pasted as text');
        return;
      }
    }
    const id = await placeBlock(media.kind, mediaProps, target);
    if (id) void openPasteMenu(id, media);
  }

  /** an empty Text line becomes the new block; otherwise it lands right after the caret's block */
  async function placeBlock(type: string, p: Record<string, unknown>, target: HTMLElement | null, text = ''): Promise<string | undefined> {
    const caretId = (target?.closest('.blk') as HTMLElement | null)?.dataset.blockId;
    const caret = caretId ? props.blocks.find((b) => b.id === caretId) : undefined;
    const after = caret?.id ?? selectedInOrder.value[selectedInOrder.value.length - 1] ?? props.blocks[props.blocks.length - 1]?.id;
    const emptyLine = caret?.type === 'paragraph' && !(caret.text ?? '').trim() && !(target?.textContent ?? '').trim();
    ui.clearSelection();
    if (emptyLine) {
      await blockService.convertBlock(caret!.id, type, { props: p, text });
      return caret!.id;
    }
    const env: ClipEnvelope = { format: CLIP_FORMAT, version: CLIP_VERSION, blocks: [{ type, text, checked: 0, props: p, children: [] }] };
    return (await blockService.pasteBlocks(props.noteId, env, { after }))[0];
  }

  async function pasteImageFile(file: File, target: HTMLElement | null) {
    const id = await placeBlock('image', { caption: '' }, target);
    if (!id) return;
    try {
      const r = await attachmentService.attachImage(file, { noteId: props.noteId, blockId: id });
      const row = await db.blocks.get(id);
      await blockService.updateBlock(id, { props: { ...(row?.props ?? {}), attachmentId: r.checksum, width: r.width, height: r.height } });
    } catch (err) {
      await blockService.deleteBlock(id);
      notices.danger(err instanceof Error && err.message ? err.message : 'Could not paste that image');
    }
  }

  // --- the small "Paste as" menu shown after a link is embedded ---
  const pasteMenu = ref<{ id: string; media: PastedMedia; x: number; y: number } | null>(null);

  async function openPasteMenu(id: string, media: PastedMedia) {
    // the block appears once the live query catches up, so wait a few frames for it
    let el: Element | null = null;
    for (let i = 0; i < 30 && !el; i++) {
      await nextTick();
      await new Promise((r) => requestAnimationFrame(r));
      el = document.querySelector(`.blk[data-block-id="${id}"]`);
    }
    if (!el) return;
    const r = el.getBoundingClientRect();
    pasteMenu.value = { id, media, x: r.left + 8, y: Math.min(Math.max(r.top + 8, 64), window.innerHeight - 56) };
    document.addEventListener('mousedown', closePasteMenu);
    document.addEventListener('keydown', onMenuKey);
    window.addEventListener('scroll', closePasteMenu, true);
  }

  function closePasteMenu() {
    pasteMenu.value = null;
    document.removeEventListener('mousedown', closePasteMenu);
    document.removeEventListener('keydown', onMenuKey);
    window.removeEventListener('scroll', closePasteMenu, true);
  }
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closePasteMenu();
  };

  async function choosePaste(kind: 'embed' | 'link' | 'bookmark') {
    const m = pasteMenu.value;
    closePasteMenu();
    if (!m || kind === 'embed') return;
    const { url } = m.media;
    if (kind === 'link') {
      await blockService.convertBlock(m.id, 'paragraph', { text: url });
      return;
    }
    const u = new URL(url);
    const title = m.media.kind === 'video'
      ? `${PROVIDER_LABEL[m.media.video.provider]} video`
      : decodeURIComponent(u.pathname.split('/').pop() || u.hostname);
    await blockService.convertBlock(m.id, 'bookmark', { props: { url: url.replace(/^https?:\/\//, ''), title } });
  }

  // Ctrl/⌘+Shift+V is the usual "paste as plain text"; the paste event itself cannot tell
  let plainNext = false;
  function onKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
      plainNext = true;
      setTimeout(() => (plainNext = false), 1000);
    }
  }

  /** a picture copied from a web page often arrives as HTML holding one <img>, with no text */
  function imageFromHtml(html?: string, text?: string): PastedMedia | null {
    if (!html || (text ?? '').trim()) return null;
    const src = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
    return src?.startsWith('https://') ? { kind: 'image', url: src } : null;
  }

  /** the empty Text block a markdown paste should split into, if that's where the caret is */
  function markdownTarget(target: HTMLElement, text: string): BlockRow | undefined {
    const id = (target.closest('.blk') as HTMLElement | null)?.dataset.blockId;
    const into = id ? props.blocks.find((b) => b.id === id) : undefined;
    if (into?.type !== 'paragraph' || (into.text ?? '').trim() || (target.textContent ?? '').trim()) return undefined;
    return isMultiLine(text) || isMarkdownLine(text) ? into : undefined;
  }

  async function pasteMarkdownInto(into: BlockRow, text: string) {
    const blocks = markdownToBlocks(text);
    const ids = await blockService.pasteBlocks(props.noteId, { format: CLIP_FORMAT, version: CLIP_VERSION, blocks }, { after: into.id });
    // deleted rather than reused: its own debounced save could still land and wipe the first pasted line
    await blockService.deleteBlock(into.id);
    ui.clearSelection();
    if (ids[0]) ui.setFocus(ids[0]);
  }

  // on the document, not the list: with nothing focused the event never reaches the list
  onMounted(() => {
    document.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown, true);
  });
  onUnmounted(() => {
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('keydown', onKeyDown, true);
    closePasteMenu();
  });

  return { copied, copySelection, duplicateSelection, pasteMenu, choosePaste };
}
