// 抽出結果（Claude の読み取り）と、人が直して保存した記録の差分。読み取りの崩れ方を検証するための純粋関数。
import type { ExtractItem, ExtractResult } from './voysy';
import type { RecordRow } from './types';

export type DiffKind = 'match' | 'filled' | 'corrected' | 'cleared';
export type FieldDiff = { field: string; model: string | null; saved: string | null; kind: DiffKind };
export type ExtractionDiff = {
  extraction_id: number;
  created_at: string;
  raw_text: string;
  work_type_model: string;
  work_type_saved: string;
  diffs: FieldDiff[]; // match 以外だけ
  matched: number; // 一致した項目数
};

const SCALAR_FIELDS = [
  'work_type', 'lot_no', 'farm', 'lane', 'ma_from', 'ma_to', 'purpose',
  'mortality', 'shell_state', 'meat_quality', 'fouling', 'workers', 'duration_min', 'notes',
] as const;
const ITEM_FIELDS: (keyof ExtractItem)[] = ['avg_weight_g', 'count_per_basket', 'basket_count', 'basket_type'];

function str(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v ? 'あり' : 'なし';
  if (typeof v === 'number') return String(v);
  return String(v).trim() || null;
}

function kindOf(model: string | null, saved: string | null): DiffKind {
  if (model === saved) return 'match';
  if (model == null) return 'filled';
  if (saved == null) return 'cleared';
  return 'corrected';
}

/** 1 件の抽出と、それから保存された記録（選別は帯ごとに複数）を突き合わせる */
export function diffExtraction(
  ex: { id: number; created_at: string; raw_text: string; result: ExtractResult },
  saved: RecordRow[],
): ExtractionDiff | null {
  if (saved.length === 0) return null;
  const rows = [...saved].sort((a, b) => a.id - b.id);
  const r0 = rows[0];
  const diffs: FieldDiff[] = [];
  let matched = 0;
  const push = (field: string, model: string | null, savedV: string | null) => {
    const kind = kindOf(model, savedV);
    if (kind === 'match') matched += 1;
    else diffs.push({ field, model, saved: savedV, kind });
  };

  for (const f of SCALAR_FIELDS) {
    const m = str(ex.result[f as keyof ExtractResult]);
    // fouling は記録では 0/1
    const s = f === 'fouling' ? (r0.fouling == null ? null : r0.fouling ? 'あり' : 'なし') : str(r0[f as keyof RecordRow]);
    push(f, m, s);
  }

  const savedType = r0.work_type;
  if (ex.result.work_type === '選別' || savedType === '選別') {
    const modelItems = ex.result.items ?? [];
    const savedItems = rows.filter((r) => r.avg_weight_g != null || r.count_per_basket != null || r.basket_count != null);
    push('items.count', String(modelItems.length), String(savedItems.length));
    const n = Math.max(modelItems.length, savedItems.length);
    for (let i = 0; i < n; i++) {
      for (const f of ITEM_FIELDS) {
        push(`items[${i}].${f}`, str(modelItems[i]?.[f]), str(savedItems[i]?.[f as keyof RecordRow]));
      }
    }
  } else {
    push('basket_count', str(ex.result.basket_count), str(r0.basket_count));
  }

  return {
    extraction_id: ex.id,
    created_at: ex.created_at,
    raw_text: ex.raw_text,
    work_type_model: ex.result.work_type,
    work_type_saved: savedType,
    diffs,
    matched,
  };
}

export type AccuracySummary = {
  extractions: number;
  fields_total: number;
  fields_matched: number;
  by_field: Record<string, { match: number; filled: number; corrected: number; cleared: number }>;
};

export function summarize(diffs: ExtractionDiff[]): AccuracySummary {
  const by: AccuracySummary['by_field'] = {};
  let total = 0;
  let matched = 0;
  for (const d of diffs) {
    total += d.matched + d.diffs.length;
    matched += d.matched;
    for (const f of d.diffs) {
      const key = f.field.replace(/\[\d+\]/, '[]');
      by[key] ??= { match: 0, filled: 0, corrected: 0, cleared: 0 };
      by[key][f.kind] += 1;
    }
  }
  return { extractions: diffs.length, fields_total: total, fields_matched: matched, by_field: by };
}
