/**
 * searchIndex — a local, in-memory inverted index over block text (ARCHITECTURE.md §9).
 * "Searched on device": results come from here, never a Dexie table scan. Kept in sync by the
 * EventBus (block.updated/created → re-index that block).
 *
 * This is a compact first implementation (token → set of blockIds) that runs on the main thread
 * for now; ARCHITECTURE §10 moves indexing into a Web Worker once the corpus is large. The
 * public shape (build / upsert / remove / query) won't change when that move happens.
 */
import type { BlockRow } from '@/core/db/schema';

export interface SearchHit {
  blockId: string;
  noteId: string;
  type: string;
  text: string;
  score: number;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);
}

/** flatten a block's searchable text (its own text + any string values in props.items) */
function blockText(b: BlockRow): string {
  const items = (b.props?.items as string[] | undefined) ?? [];
  return [b.text ?? '', ...items].join(' ');
}

class SearchIndex {
  private postings = new Map<string, Set<string>>(); // token → blockIds
  private docs = new Map<string, { noteId: string; type: string; text: string; tokens: Set<string> }>();

  build(blocks: BlockRow[]) {
    this.postings.clear();
    this.docs.clear();
    for (const b of blocks) if (!b.deletedAt) this.upsert(b);
  }

  upsert(b: BlockRow) {
    this.remove(b.id); // drop old postings first (text may have changed)
    if (b.deletedAt) return;
    const text = blockText(b);
    const tokens = new Set(tokenize(text));
    this.docs.set(b.id, { noteId: b.noteId, type: b.type, text, tokens });
    for (const t of tokens) {
      if (!this.postings.has(t)) this.postings.set(t, new Set());
      this.postings.get(t)!.add(b.id);
    }
  }

  remove(blockId: string) {
    const doc = this.docs.get(blockId);
    if (!doc) return;
    for (const t of doc.tokens) this.postings.get(t)?.delete(blockId);
    this.docs.delete(blockId);
  }

  /** AND across query tokens; score = matched tokens + light prefix credit. */
  query(q: string, limit = 20): SearchHit[] {
    const terms = tokenize(q);
    if (!terms.length) return [];
    const counts = new Map<string, number>();
    for (const term of terms) {
      // exact token postings + prefix matches across all tokens
      const ids = new Set<string>();
      for (const [tok, set] of this.postings) if (tok === term || tok.startsWith(term)) set.forEach((id) => ids.add(id));
      ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
    }
    return [...counts.entries()]
      .filter(([, c]) => c === terms.length) // AND: all terms present
      .map(([id, c]) => {
        const d = this.docs.get(id)!;
        return { blockId: id, noteId: d.noteId, type: d.type, text: d.text, score: c };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export const searchIndex = new SearchIndex();
