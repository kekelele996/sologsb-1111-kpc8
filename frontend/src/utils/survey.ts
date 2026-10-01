import type { SurveyPoint } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import { gapsWithinRanges, mergeRanges, rangesOverlap } from './recovery';
import { uid } from './id';

/** 深度比较容差（m） */
const EPS = 0.0001;

const round2 = (v: number) => Number(v.toFixed(2));

/** 测点归一化键：同孔深（到厘米）视为同一测点，用于补送去重 */
const depthKey = (depth: number) => (Number(depth) || 0).toFixed(2);

/** 测斜轨迹上的计算测站（含累计垂深与水平位移） */
export interface TrackStation {
  /** 孔深（m） */
  depth: number;
  /** 倾角（°，90=垂直孔） */
  dip: number;
  /** 方位角（°） */
  azimuth: number;
  /** 累计垂深（m） */
  tvd: number;
  /** 累计水平位移（m，距孔口） */
  horizontal: number;
}

/** 测斜轨迹：由测斜成果派生，是垂深换算的唯一依据 */
export interface SurveyTrack {
  stations: TrackStation[];
  /** 测斜成果覆盖的最大孔深（m），无有效测点时为 0 */
  maxDepth: number;
  /** 无效测点（深度 + 原因）：换算跨越这些深度的段判为待换算 */
  invalidPoints: Array<{ depth: number; reason: string }>;
}

/** 空轨迹（无测斜成果时的占位，所有段换算均为待换算） */
export const EMPTY_TRACK: SurveyTrack = { stations: [], maxDepth: 0, invalidPoints: [] };

/** 单段换算结果：成功给出垂深区间；失败保持孔深并标待换算，不影响其他段 */
export interface SegmentConversion {
  status: 'ok' | 'pending';
  /** 孔深起（m），始终保留 */
  fromDepth: number;
  /** 孔深止（m），始终保留 */
  toDepth: number;
  /** 垂深起（m），仅换算成功时有值 */
  tvdFrom?: number;
  /** 垂深止（m），仅换算成功时有值 */
  tvdTo?: number;
  /** 待换算原因 */
  reason?: string;
}

/** 测斜成果文本解析结果（严格校验，逐行报错） */
export interface SurveyParseResult {
  points: SurveyPoint[];
  errors: Array<{ line: number; text: string; reason: string }>;
}

/** 测斜成果合并结果：同孔深去重，重复补送不多出测点 */
export interface SurveyMergeResult {
  merged: SurveyPoint[];
  added: number;
  updated: number;
  unchanged: number;
}

/** 校验单个测点：孔深非负、倾角 (0,90]、方位角 [0,360) */
export function validateSurveyPoint(point: Pick<SurveyPoint, 'depth' | 'dip' | 'azimuth'>): string | undefined {
  const { depth, dip, azimuth } = point;
  if (!Number.isFinite(depth) || depth < 0) return '测点孔深必须是非负数字';
  if (!Number.isFinite(dip) || dip <= 0 || dip > 90) return '倾角须在 (0, 90]° 之间';
  if (!Number.isFinite(azimuth) || azimuth < 0 || azimuth >= 360) return '方位角须在 [0, 360)° 之间';
  return undefined;
}

/** 解析测斜文本：每行「孔深,倾角,方位角」，无效行逐行报错（不静默置 0） */
export function parseSurveyText(text: string | undefined): SurveyParseResult {
  const points: SurveyPoint[] = [];
  const errors: SurveyParseResult['errors'] = [];
  (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .forEach((line, index) => {
      if (!line) return;
      const parts = line.split(/[,，\s]+/).filter(Boolean);
      if (parts.length !== 3) {
        errors.push({ line: index + 1, text: line, reason: '需为「孔深,倾角,方位角」三列' });
        return;
      }
      const [depth, dip, azimuth] = parts.map(Number);
      const reason = validateSurveyPoint({ depth, dip, azimuth });
      if (reason) {
        errors.push({ line: index + 1, text: line, reason });
        return;
      }
      points.push({ id: uid('sv'), depth, dip, azimuth });
    });
  return { points, errors };
}

/**
 * 合并测斜成果（测量组补送）：按测点孔深去重——
 * 同孔深同值视为未变，同孔深异值原位更新，新孔深追加；
 * 同一份成果重复补送不会多出测点。
 */
export function mergeSurveyPoints(existing: SurveyPoint[], incoming: SurveyPoint[]): SurveyMergeResult {
  const byKey = new Map<string, SurveyPoint>();
  existing.forEach((p) => byKey.set(depthKey(p.depth), p));
  // 补送文本内部同孔深的行，后者覆盖前者，避免一次补送内部重复计数
  const incomingByKey = new Map<string, SurveyPoint>();
  incoming.forEach((p) => incomingByKey.set(depthKey(p.depth), p));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  incomingByKey.forEach((p, key) => {
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, p);
      added += 1;
      return;
    }
    if (prev.dip === p.dip && prev.azimuth === p.azimuth) {
      unchanged += 1;
      return;
    }
    // 保留原测点 id，只更新姿态值
    byKey.set(key, { ...prev, dip: p.dip, azimuth: p.azimuth });
    updated += 1;
  });

  const merged = [...byKey.values()].sort((a, b) => a.depth - b.depth);
  return { merged, added, updated, unchanged };
}

/**
 * 由测斜成果建立轨迹（平均角法）：
 * 相邻两测点间倾角、方位角取平均，逐段累计垂深与水平位移。
 * 孔口至首测点沿用首测点姿态；无效测点剔除并记录，供分段判待换算。
 */
export function buildSurveyTrack(points: SurveyPoint[]): SurveyTrack {
  const invalidPoints: SurveyTrack['invalidPoints'] = [];
  const byKey = new Map<string, SurveyPoint>();
  points.forEach((p) => {
    const reason = validateSurveyPoint(p);
    if (reason) {
      invalidPoints.push({ depth: Number(p.depth) || 0, reason });
      return;
    }
    byKey.set(depthKey(p.depth), p);
  });
  const sorted = [...byKey.values()].sort((a, b) => a.depth - b.depth);
  if (sorted.length === 0) {
    return { stations: [], maxDepth: 0, invalidPoints };
  }

  const stations: TrackStation[] = [];
  let prevDepth = 0;
  let prevDip = sorted[0].dip;
  let prevAzimuth = sorted[0].azimuth;
  let tvd = 0;
  let north = 0;
  let east = 0;
  stations.push({ depth: 0, dip: prevDip, azimuth: prevAzimuth, tvd: 0, horizontal: 0 });

  sorted.forEach((p) => {
    const dMd = p.depth - prevDepth;
    if (dMd <= 0) return;
    const avgDip = ((prevDip + p.dip) / 2) * (Math.PI / 180);
    const avgAzimuth = ((prevAzimuth + p.azimuth) / 2) * (Math.PI / 180);
    tvd += dMd * Math.sin(avgDip);
    north += dMd * Math.cos(avgDip) * Math.cos(avgAzimuth);
    east += dMd * Math.cos(avgDip) * Math.sin(avgAzimuth);
    stations.push({ depth: p.depth, dip: p.dip, azimuth: p.azimuth, tvd, horizontal: Math.hypot(north, east) });
    prevDepth = p.depth;
    prevDip = p.dip;
    prevAzimuth = p.azimuth;
  });

  return { stations, maxDepth: sorted[sorted.length - 1].depth, invalidPoints };
}

/** 孔深 → 垂深：超出测斜覆盖（最深测点）不外推，返回 undefined */
export function tvdAt(track: SurveyTrack, depth: number): number | undefined {
  if (!Number.isFinite(depth) || depth < 0 || track.stations.length === 0) return undefined;
  if (depth - track.maxDepth > EPS) return undefined;
  const d = Math.min(depth, track.maxDepth);
  for (let i = 1; i < track.stations.length; i += 1) {
    const a = track.stations[i - 1];
    const b = track.stations[i];
    if (d <= b.depth + EPS) {
      const span = b.depth - a.depth;
      if (span <= 0) return round2(b.tvd);
      const avgDip = ((a.dip + b.dip) / 2) * (Math.PI / 180);
      return round2(a.tvd + (d - a.depth) * Math.sin(avgDip));
    }
  }
  return round2(track.stations[track.stations.length - 1].tvd);
}

/**
 * 分段换算孔深区间为垂深区间。
 * 失败（无测斜成果 / 测斜未覆盖 / 段内含无效测点）时保持孔深、标待换算，
 * 各段独立换算，互不影响。
 */
export function convertSegment(track: SurveyTrack, fromDepth: number, toDepth: number): SegmentConversion {
  const from = Math.min(fromDepth, toDepth);
  const to = Math.max(fromDepth, toDepth);
  if (track.stations.length === 0) {
    return { status: 'pending', fromDepth: from, toDepth: to, reason: '无测斜成果，待测量组补送' };
  }
  const bad = track.invalidPoints.find((p) => p.depth > from + EPS && p.depth <= to + EPS);
  if (bad) {
    return { status: 'pending', fromDepth: from, toDepth: to, reason: `孔深 ${bad.depth}m 测点无效（${bad.reason}）` };
  }
  const tvdFrom = tvdAt(track, from);
  const tvdTo = tvdAt(track, to);
  if (tvdFrom === undefined || tvdTo === undefined) {
    return { status: 'pending', fromDepth: from, toDepth: to, reason: `测斜成果最深 ${track.maxDepth}m，未覆盖该段` };
  }
  return { status: 'ok', fromDepth: from, toDepth: to, tvdFrom, tvdTo };
}

/** 批量换算结果拆分：成功段合并为垂深覆盖区间，失败段保留孔深待换算 */
export function splitConversions(conversions: SegmentConversion[]): {
  ok: Array<{ from: number; to: number }>;
  pending: SegmentConversion[];
} {
  const ok = mergeRanges(
    conversions
      .filter((c): c is SegmentConversion & { tvdFrom: number; tvdTo: number } => c.status === 'ok')
      .map((c) => ({ from: c.tvdFrom, to: c.tvdTo })),
  );
  const pending = conversions.filter((c) => c.status === 'pending');
  return { ok, pending };
}

/** 垂深基准下的岩芯箱连续性：箱体与回次分别换算后在垂深空间校验 */
export interface TvdBoxContinuity {
  status: 'covered' | 'gaps' | 'pending';
  gaps: Array<{ from: number; to: number }>;
  /** 箱体自身待换算原因 */
  pendingReason?: string;
  /** 箱区间内尚未换算的回次段数（结果可能随补测变化） */
  pendingRuns: number;
  message: string;
}

export function checkBoxContinuityTvd(box: CoreBox, holeRuns: DrillRun[], track: SurveyTrack): TvdBoxContinuity {
  const conv = convertSegment(track, box.fromDepth, box.toDepth);
  if (conv.status === 'pending') {
    return {
      status: 'pending',
      gaps: [],
      pendingReason: conv.reason,
      pendingRuns: 0,
      message: `待换算：${conv.reason}，该箱先按孔深 ${box.fromDepth}~${box.toDepth}m 保留`,
    };
  }
  const converted = holeRuns.map((run) => ({ run, conv: convertSegment(track, run.fromDepth, run.toDepth) }));
  const okRanges = converted
    .filter((c): c is { run: DrillRun; conv: SegmentConversion & { tvdFrom: number; tvdTo: number } } => c.conv.status === 'ok')
    .map((c) => ({ from: c.conv.tvdFrom, to: c.conv.tvdTo }));
  const pendingRuns = converted.filter(
    (c) => c.conv.status === 'pending' && rangesOverlap(c.run.fromDepth, c.run.toDepth, box.fromDepth, box.toDepth),
  ).length;
  const gaps = gapsWithinRanges(conv.tvdFrom!, conv.tvdTo!, okRanges);
  const pendingNote = pendingRuns > 0 ? `；另有 ${pendingRuns} 段回次待换算，结果可能随补测变化` : '';
  if (gaps.length === 0) {
    return {
      status: 'covered',
      gaps,
      pendingRuns,
      message: `垂深 ${conv.tvdFrom}~${conv.tvdTo}m 已被回次完整覆盖${pendingNote}`,
    };
  }
  return {
    status: 'gaps',
    gaps,
    pendingRuns,
    message: `垂深 ${gaps.map((g) => `${g.from}~${g.to}m`).join('、')} 无对应回次${pendingNote}`,
  };
}
