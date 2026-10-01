import { db, SCHEMA_VERSION } from './db';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import { buildSurveyTrack, convertSegment, tvdAt, validateSurveyPoint } from './survey';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  holes: unknown[];
  runs: unknown[];
  boxes: unknown[];
  lithos: unknown[];
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [holes, runs, boxes, lithos] = await Promise.all([
    db.holes.toArray(),
    db.runs.toArray(),
    db.boxes.toArray(),
    db.lithos.toArray(),
  ]);
  return {
    app: 'gbdrillcore',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    holes,
    runs,
    boxes,
    lithos,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（岩芯编目表打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

/** 恢复 JSON 备份 */
export async function importBackup(text: string): Promise<{ holes: number; runs: number; boxes: number; lithos: number }> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbdrillcore') {
    throw new Error('备份文件格式不匹配（缺少 app=gbdrillcore 标记）');
  }
  const counts = {
    holes: payload.holes?.length ?? 0,
    runs: payload.runs?.length ?? 0,
    boxes: payload.boxes?.length ?? 0,
    lithos: payload.lithos?.length ?? 0,
  };
  await db.transaction('rw', db.holes, db.runs, db.boxes, db.lithos, async () => {
    await Promise.all([db.holes.clear(), db.runs.clear(), db.boxes.clear(), db.lithos.clear()]);
    if (payload.holes?.length) await db.holes.bulkPut(payload.holes as never[]);
    if (payload.runs?.length) await db.runs.bulkPut(payload.runs as never[]);
    if (payload.boxes?.length) await db.boxes.bulkPut(payload.boxes as never[]);
    if (payload.lithos?.length) await db.lithos.bulkPut(payload.lithos as never[]);
  });
  return counts;
}

/** 成果行：孔深、垂深两套深度并列，换算失败的段垂深留空并标注待换算 */
export interface ResultRow extends Record<string, unknown> {
  kind: string;
  holeNo: string;
  ref: string;
  mdFrom: number | '';
  mdTo: number | '';
  tvdFrom: number | '';
  tvdTo: number | '';
  status: string;
  mdThick: number | '';
  tvdThick: number | '';
  summary: string;
}

const RESULT_COLUMNS: Array<{ key: keyof ResultRow; title: string }> = [
  { key: 'kind', title: '表别' },
  { key: 'holeNo', title: '孔号' },
  { key: 'ref', title: '编号' },
  { key: 'mdFrom', title: '孔深起(m)' },
  { key: 'mdTo', title: '孔深止(m)' },
  { key: 'tvdFrom', title: '垂深起(m)' },
  { key: 'tvdTo', title: '垂深止(m)' },
  { key: 'status', title: '换算状态' },
  { key: 'mdThick', title: '孔深厚度(m)' },
  { key: 'tvdThick', title: '垂深厚度(m)' },
  { key: 'summary', title: '摘要' },
];

const round2 = (v: number) => Number(v.toFixed(2));

/** 汇总各表为成果行：孔深为落库值，垂深由测斜成果逐段换算（待换算段保留孔深） */
export function buildResultsRows(holes: DrillHole[], runs: DrillRun[], boxes: CoreBox[], lithos: LithoLog[]): ResultRow[] {
  const rows: ResultRow[] = [];
  const sortedHoles = [...holes].sort((a, b) => a.holeNo.localeCompare(b.holeNo));

  sortedHoles.forEach((hole) => {
    const track = buildSurveyTrack(hole.surveyData);

    // 测斜成果：每个测点给出累计垂深，无效测点单独标注
    [...hole.surveyData]
      .sort((a, b) => a.depth - b.depth)
      .forEach((p, index) => {
        const invalid = validateSurveyPoint(p);
        const tvd = invalid ? undefined : tvdAt(track, p.depth);
        rows.push({
          kind: '测斜',
          holeNo: hole.holeNo,
          ref: `测点${index + 1}`,
          mdFrom: p.depth,
          mdTo: p.depth,
          tvdFrom: tvd ?? '',
          tvdTo: tvd ?? '',
          status: invalid ? `无效测点：${invalid}` : '已换算',
          mdThick: '',
          tvdThick: '',
          summary: `倾角 ${p.dip}° · 方位 ${p.azimuth}°`,
        });
      });

    const segmentRow = (
      kind: string,
      ref: string,
      fromDepth: number,
      toDepth: number,
      summary: string,
    ): ResultRow => {
      const conv = convertSegment(track, fromDepth, toDepth);
      const ok = conv.status === 'ok';
      return {
        kind,
        holeNo: hole.holeNo,
        ref,
        mdFrom: fromDepth,
        mdTo: toDepth,
        tvdFrom: ok ? conv.tvdFrom! : '',
        tvdTo: ok ? conv.tvdTo! : '',
        status: ok ? '已换算' : `待换算：${conv.reason}`,
        mdThick: round2(toDepth - fromDepth),
        tvdThick: ok ? round2(conv.tvdTo! - conv.tvdFrom!) : '',
        summary,
      };
    };

    runs
      .filter((run) => run.holeId === hole.id)
      .sort((a, b) => a.fromDepth - b.fromDepth)
      .forEach((run) => {
        rows.push(
          segmentRow('回次', run.runNo, run.fromDepth, run.toDepth, `进尺 ${run.footage}m · 岩芯 ${run.coreLength}m · 采取率 ${run.recovery}%`),
        );
      });

    boxes
      .filter((box) => box.holeId === hole.id)
      .sort((a, b) => a.fromDepth - b.fromDepth)
      .forEach((box) => {
        rows.push(segmentRow('岩芯箱', box.boxNo, box.fromDepth, box.toDepth, `${box.slots} 格 × ${box.slotLength}m · ${box.shelfPos}`));
      });

    lithos
      .filter((log) => log.holeId === hole.id)
      .sort((a, b) => a.fromDepth - b.fromDepth)
      .forEach((log) => {
        rows.push(
          segmentRow(
            '岩性',
            log.sampleNo || '-',
            log.fromDepth,
            log.toDepth,
            `${log.lithology} · ${log.alteration} · ${log.mineralization} · RQD ${log.rqd}%`,
          ),
        );
      });
  });

  return rows;
}

/** 导出成果 CSV：回次 / 岩芯箱 / 岩性 / 测斜全部带孔深、垂深两套深度 */
export async function downloadResultsCsv(): Promise<number> {
  const [holes, runs, boxes, lithos] = await Promise.all([db.holes.toArray(), db.runs.toArray(), db.boxes.toArray(), db.lithos.toArray()]);
  const rows = buildResultsRows(holes, runs, boxes, lithos);
  downloadCsv(`gbdrillcore-成果-${new Date().toISOString().slice(0, 10)}.csv`, rows, RESULT_COLUMNS);
  return rows.length;
}
