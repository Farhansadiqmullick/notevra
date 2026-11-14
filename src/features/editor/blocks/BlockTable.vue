<script setup lang="ts">
/** Table block — editable headers + cells (props.headers / props.rows), with add row / add column
 *  controls. Cells are `multiline` EditableText so Enter makes a newline inside the cell. Each edit
 *  writes the whole grid in one UpdateBlock op (grouped shape, like the lists). */
import { computed } from 'vue';
import EditableText from '@/components/primitives/EditableText.vue';
import { blockService } from '@/services/block.service';
import { debounce } from '@/utils/debounce';
import type { BlockRow } from '@/core/db/schema';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ block: BlockRow }>();
const headers = computed<string[]>(() => (props.block.props?.headers as string[] | undefined) ?? []);
const rows = computed<string[][]>(() => (props.block.props?.rows as string[][] | undefined) ?? []);

function commit(next: { headers: string[]; rows: string[][] }) {
  blockService.updateBlock(props.block.id, { props: { ...props.block.props, headers: next.headers, rows: next.rows } });
}
const save = debounce(commit, 300);

/** the grid including an edit still waiting on the debounce, so add row/column can't undo typing */
const current = () => save.pending()?.[0] ?? { headers: headers.value, rows: rows.value };

function editHeader(i: number, text: string) {
  const g = current();
  const h = g.headers.slice();
  h[i] = text;
  save({ headers: h, rows: g.rows });
}
function editCell(r: number, c: number, text: string) {
  const g = current();
  const rr = g.rows.map((row) => row.slice());
  rr[r][c] = text;
  save({ headers: g.headers, rows: rr });
}
function addRow() {
  const g = current();
  save.cancel();
  const rr = g.rows.map((row) => row.slice());
  rr.push(g.headers.map(() => ''));
  commit({ headers: g.headers, rows: rr });
}
function addCol() {
  const g = current();
  save.cancel();
  const h = [...g.headers, 'New'];
  const rr = g.rows.map((row) => [...row, '']);
  commit({ headers: h, rows: rr });
}
</script>

<template>
  <div class="twrap">
    <table class="table">
      <thead>
        <tr>
          <th v-for="(h, i) in headers" :key="i">
            <EditableText multiline :model-value="h" placeholder="Header" @input="(t) => editHeader(i, t)" />
          </th>
          <th class="addcol"><button title="Add column" @click="addCol"><AppIcon name="plus" /></button></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, r) in rows" :key="r">
          <td v-for="(cell, c) in row" :key="c">
            <EditableText multiline :model-value="cell" placeholder="—" @input="(t) => editCell(r, c, t)" />
          </td>
          <td class="spacer" />
        </tr>
      </tbody>
    </table>
    <button class="addrow" title="Add row" @click="addRow"><AppIcon name="plus" /> Row</button>
  </div>
</template>

<style scoped>
.twrap { overflow-x: auto; margin: 6px 0 16px; }
.table { inline-size: 100%; border-collapse: collapse; border: 1px solid var(--border); border-radius: var(--r-item); overflow: hidden; }
thead th { background: var(--surface-subtle); text-align: start; font: 700 11px var(--font-ui); color: var(--ink-muted); padding: 10px 14px; border-bottom: 1px solid var(--border); }
tbody td { font: 500 13px var(--font-ui); color: var(--ink-secondary); padding: 10px 14px; border-bottom: 1px solid var(--divider-faint); }
tbody tr:last-child td { border-bottom: none; }
th.addcol, td.spacer { inline-size: 34px; text-align: center; padding: 4px; }
th.addcol button {
  inline-size: 24px; block-size: 24px; border: none; background: none; cursor: pointer;
  border-radius: var(--r-tag); color: var(--ink-faint); font-size: 14px;
}
th.addcol button:hover { background: var(--divider-faint); color: var(--ink-secondary); }
.addrow {
  margin-block-start: 6px; border: 1px dashed var(--border-strong); background: none; cursor: pointer;
  border-radius: var(--r-control); color: var(--ink-faint); font: 600 11.5px var(--font-ui); padding: 6px 12px;
}
.addrow:hover { border-color: var(--accent); color: var(--accent-deep); }
</style>
