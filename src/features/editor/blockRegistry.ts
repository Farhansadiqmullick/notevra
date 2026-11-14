/**
 * blockRegistry — maps a block's `type` to the component that renders it (FRONTEND_WORKFLOW §2.3).
 * Adding a block type = one SFC + one line here. An unknown type falls back to paragraph
 * instead of crashing the document (forward-compat with newer app versions).
 */
import type { Component } from 'vue';
import BlockHeading from './blocks/BlockHeading.vue';
import BlockParagraph from './blocks/BlockParagraph.vue';
import BlockTask from './blocks/BlockTask.vue';
import BlockCallout from './blocks/BlockCallout.vue';
import BlockQuote from './blocks/BlockQuote.vue';
import BlockBulletedList from './blocks/BlockBulletedList.vue';
import BlockNumberedList from './blocks/BlockNumberedList.vue';
import BlockToggle from './blocks/BlockToggle.vue';
import BlockCode from './blocks/BlockCode.vue';
import BlockTextarea from './blocks/BlockTextarea.vue';
import BlockTable from './blocks/BlockTable.vue';
import BlockBookmark from './blocks/BlockBookmark.vue';
import BlockImage from './blocks/BlockImage.vue';
import BlockVideo from './blocks/BlockVideo.vue';
import BlockDivider from './blocks/BlockDivider.vue';

export const blockRegistry: Record<string, Component> = {
  heading: BlockHeading,
  paragraph: BlockParagraph,
  task: BlockTask,
  callout: BlockCallout,
  quote: BlockQuote,
  bulleted: BlockBulletedList,
  numbered: BlockNumberedList,
  toggle: BlockToggle,
  code: BlockCode,
  textarea: BlockTextarea,
  table: BlockTable,
  bookmark: BlockBookmark,
  image: BlockImage,
  video: BlockVideo,
  divider: BlockDivider,
};

export const fallbackBlock = BlockParagraph;
