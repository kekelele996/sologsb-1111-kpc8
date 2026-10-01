import { db, SCHEMA_VERSION } from './db';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import { computeTrajectory, tvdAt } from './survey';

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

/** 取孔深对应的垂深值（换算不出返回空串，导出表中留空并由「垂深状态」列标注待换算） */
function tvdValue(md: number, traj: ReturnType<typeof computeTrajectory> | null): number | '' {
  const v = tvdAt(md, traj);
  return v === null ? '' : v;
}

/** 回次成果行（孔深 + 垂深两套深度） */
export function buildRunRows(holes: DrillHole[], runs: DrillRun[]) {
  return runs
    .map((run) => {
      const hole = holes.find((h) => h.id === run.holeId);
      const traj = hole ? computeTrajectory(hole.surveyData) : null;
      const tvdFrom = tvdValue(run.fromDepth, traj);
      const tvdTo = tvdValue(run.toDepth, traj);
      return {
        孔号: hole?.holeNo ?? '未知孔',
        回次号: run.runNo,
        孔深起_m: run.fromDepth,
        孔深止_m: run.toDepth,
        孔深进尺_m: run.footage,
        垂深起_m: tvdFrom,
        垂深止_m: tvdTo,
        垂深状态: tvdFrom === '' || tvdTo === '' ? '待换算' : '已换算',
        岩芯长度_m: run.coreLength,
        采取率_pct: run.recovery,
        回次水位_m: run.waterLevel,
        班次: run.shift,
        钻进日期: run.drilledAt.slice(0, 10),
        记录人: run.recorder,
        备注: run.remark ?? '',
      };
    })
    .sort((a, b) => a.孔号.localeCompare(b.孔号) || a.孔深起_m - b.孔深起_m);
}

/** 岩芯箱成果行（孔深 + 垂深两套深度） */
export function buildBoxRows(holes: DrillHole[], boxes: CoreBox[]) {
  return boxes
    .map((box) => {
      const hole = holes.find((h) => h.id === box.holeId);
      const traj = hole ? computeTrajectory(hole.surveyData) : null;
      const tvdFrom = tvdValue(box.fromDepth, traj);
      const tvdTo = tvdValue(box.toDepth, traj);
      return {
        孔号: hole?.holeNo ?? '未知孔',
        箱号: box.boxNo,
        孔深起_m: box.fromDepth,
        孔深止_m: box.toDepth,
        垂深起_m: tvdFrom,
        垂深止_m: tvdTo,
        垂深状态: tvdFrom === '' || tvdTo === '' ? '待换算' : '已换算',
        格数: box.slots,
        每格长度_m: box.slotLength,
        库架位: box.shelfPos,
        装箱日期: box.boxedAt.slice(0, 10),
        破损格: box.damagedSlots.join(','),
        装箱人: box.operator,
        备注: box.remark ?? '',
      };
    })
    .sort((a, b) => a.孔号.localeCompare(b.孔号) || a.孔深起_m - b.孔深起_m);
}

/** 岩性编录成果行（孔深 + 垂深两套深度） */
export function buildLithoRows(holes: DrillHole[], lithos: LithoLog[]) {
  return lithos
    .map((log) => {
      const hole = holes.find((h) => h.id === log.holeId);
      const traj = hole ? computeTrajectory(hole.surveyData) : null;
      const tvdFrom = tvdValue(log.fromDepth, traj);
      const tvdTo = tvdValue(log.toDepth, traj);
      return {
        孔号: hole?.holeNo ?? '未知孔',
        孔深起_m: log.fromDepth,
        孔深止_m: log.toDepth,
        垂深起_m: tvdFrom,
        垂深止_m: tvdTo,
        垂深状态: tvdFrom === '' || tvdTo === '' ? '待换算' : '已换算',
        岩性: log.lithology,
        颜色: log.color,
        蚀变: log.alteration,
        矿化: log.mineralization,
        RQD_pct: log.rqd,
        样品号: log.sampleNo,
        编录人: log.logger,
        备注: log.remark ?? '',
      };
    })
    .sort((a, b) => a.孔号.localeCompare(b.孔号) || a.孔深起_m - b.孔深起_m);
}

/** 导出全部成果 CSV（回次 / 岩芯箱 / 岩性各一份，均带孔深与垂深两套深度） */
export async function exportAllResultsCsv(): Promise<void> {
  const [holes, runs, boxes, lithos] = await Promise.all([
    db.holes.toArray(),
    db.runs.toArray(),
    db.boxes.toArray(),
    db.lithos.toArray(),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  const runRows = buildRunRows(holes, runs);
  const boxRows = buildBoxRows(holes, boxes);
  const lithoRows = buildLithoRows(holes, lithos);
  const colsOf = <T extends Record<string, unknown>>(rows: T[]): Array<{ key: keyof T; title: string }> =>
    rows.length ? (Object.keys(rows[0]) as Array<keyof T>).map((k) => ({ key: k, title: k as string })) : [];
  downloadCsv(`回次成果_双深度_${stamp}.csv`, runRows, colsOf(runRows));
  downloadCsv(`岩芯箱成果_双深度_${stamp}.csv`, boxRows, colsOf(boxRows));
  downloadCsv(`岩性编录成果_双深度_${stamp}.csv`, lithoRows, colsOf(lithoRows));
}
