import type { SurveyPoint } from '../types/drill-hole';

/** 深度基准：孔深（md, 测量/编录原始坐标）/ 垂深（tvd, 设计剖面坐标） */
export type DepthBasis = 'md' | 'tvd';

/** 垂深换算状态：ok 已换算 / pending 待换算（测斜覆盖不到或测段失败） */
export type TvdStatus = 'ok' | 'pending';

/** 测段（相邻测点之间，含井口虚拟点 0m）的换算结果 */
export interface SurveySegment {
  /** 测段序号（从井口起算，0 = 井口~第一测点） */
  index: number;
  fromDepth: number;
  toDepth: number;
  /** 该测段终点测点的倾角（°） */
  dip: number;
  /** 该测段终点测点的方位角（°） */
  azimuth: number;
  /** 垂深增量 ΔTVD（m） */
  deltaTvd: number;
  /** 北分量增量（m） */
  deltaNorth: number;
  /** 东分量增量（m） */
  deltaEast: number;
  /** 该测段终点累加深垂（m） */
  tvdEnd: number;
  northEnd: number;
  eastEnd: number;
  /** 该测段是否换算成功 */
  ok: boolean;
  /** 失败原因（ok=false 时存在） */
  error?: string;
}

/** 钻孔测斜轨迹（平均角法） */
export interface SurveyTrajectory {
  segments: SurveySegment[];
  /** 各测点（含井口虚拟点）累加坐标 */
  points: Array<{ depth: number; tvd: number; north: number; east: number }>;
  /** 测斜控制的最大孔深（m），超过此深度无测斜成果 */
  maxSurveyDepth: number;
  /** 最大测斜深度处的垂深（m） */
  totalTvd: number;
  /** 换算失败的测段数 */
  failedCount: number;
}

const r2 = (n: number): number => Number(n.toFixed(2));

/** 方位角平均（向量法，规避 0°/360° 跨越） */
function avgAngle(a: number, b: number): number {
  const ar = (a * Math.PI) / 180;
  const br = (b * Math.PI) / 180;
  const x = Math.cos(ar) + Math.cos(br);
  const y = Math.sin(ar) + Math.sin(br);
  let ang = (Math.atan2(y, x) * 180) / Math.PI;
  if (ang < 0) ang += 360;
  return ang;
}

/**
 * 由测斜点计算钻孔轨迹（平均角法）。
 * 井口（0m）按垂直（倾角 90°、方位 0°）虚拟起算；
 * 任一测段失败则该段及其后段标记失败（垂深无法累加），浅部已算好的测段保留。
 */
export function computeTrajectory(survey: SurveyPoint[]): SurveyTrajectory {
  const sorted = [...survey]
    .filter((p) => p && Number.isFinite(Number(p.depth)))
    .sort((a, b) => a.depth - b.depth);

  // 同孔深测点去重（补送成果时后者覆盖前者）
  const dedup: SurveyPoint[] = [];
  for (const p of sorted) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.depth - p.depth) < 0.001) {
      dedup[dedup.length - 1] = { ...last, dip: p.dip, azimuth: p.azimuth };
    } else {
      dedup.push({ ...p });
    }
  }

  const stations: Array<{ depth: number; dip: number; azimuth: number }> = [
    { depth: 0, dip: 90, azimuth: 0 },
    ...dedup.map((p) => ({ depth: p.depth, dip: p.dip, azimuth: p.azimuth })),
  ];

  const segments: SurveySegment[] = [];
  const points: SurveyTrajectory['points'] = [{ depth: 0, tvd: 0, north: 0, east: 0 }];
  const acc = { tvd: 0, north: 0, east: 0 };
  let broken = false;

  for (let i = 1; i < stations.length; i += 1) {
    const a = stations[i - 1];
    const b = stations[i];
    const seg: SurveySegment = {
      index: i - 1,
      fromDepth: a.depth,
      toDepth: b.depth,
      dip: b.dip,
      azimuth: b.azimuth,
      deltaTvd: 0,
      deltaNorth: 0,
      deltaEast: 0,
      tvdEnd: 0,
      northEnd: 0,
      eastEnd: 0,
      ok: false,
    };

    const dL = b.depth - a.depth;
    let error: string | undefined;
    if (broken) {
      error = '上一测段换算失败，垂深无法累加';
    } else if (!(dL > 0.0001)) {
      error = '测点深度未递增';
    } else if (!Number.isFinite(b.dip) || b.dip < 0 || b.dip > 90) {
      error = `倾角 ${b.dip}° 超出 0~90°`;
    } else if (!Number.isFinite(b.azimuth) || b.azimuth < 0 || b.azimuth >= 360) {
      error = `方位角 ${b.azimuth}° 超出 0~360°`;
    }

    if (error) {
      seg.ok = false;
      seg.error = error;
      broken = true;
      segments.push(seg);
      continue;
    }

    const avgDip = (a.dip + b.dip) / 2;
    const avgAz = avgAngle(a.azimuth, b.azimuth);
    const rad = (avgDip * Math.PI) / 180;
    const deltaTvd = dL * Math.sin(rad);
    const deltaH = dL * Math.cos(rad);
    const azRad = (avgAz * Math.PI) / 180;
    const deltaNorth = deltaH * Math.cos(azRad);
    const deltaEast = deltaH * Math.sin(azRad);

    acc.tvd += deltaTvd;
    acc.north += deltaNorth;
    acc.east += deltaEast;

    seg.deltaTvd = r2(deltaTvd);
    seg.deltaNorth = r2(deltaNorth);
    seg.deltaEast = r2(deltaEast);
    seg.tvdEnd = r2(acc.tvd);
    seg.northEnd = r2(acc.north);
    seg.eastEnd = r2(acc.east);
    seg.ok = true;
    segments.push(seg);
    points.push({ depth: b.depth, tvd: seg.tvdEnd, north: seg.northEnd, east: seg.eastEnd });
  }

  const maxSurveyDepth = dedup.length ? dedup[dedup.length - 1].depth : 0;
  const lastOk = [...segments].reverse().find((s) => s.ok);
  return {
    segments,
    points,
    maxSurveyDepth,
    totalTvd: lastOk ? lastOk.tvdEnd : 0,
    failedCount: segments.filter((s) => !s.ok).length,
  };
}

/** 由孔深（md）求垂深（tvd）；测斜覆盖不到或所在测段失败时返回 null（待换算） */
export function tvdAt(depth: number, traj: SurveyTrajectory | null): number | null {
  if (!traj || !Number.isFinite(Number(depth))) return null;
  const d = Number(depth);
  if (d <= 0) return 0;
  if (traj.maxSurveyDepth <= 0) return null;
  if (d > traj.maxSurveyDepth + 0.001) return null;
  for (const seg of traj.segments) {
    if (d <= seg.toDepth + 0.001) {
      if (!seg.ok) return null;
      const baseTvd = seg.index === 0 ? 0 : traj.segments[seg.index - 1].tvdEnd;
      const ratio = (d - seg.fromDepth) / (seg.toDepth - seg.fromDepth);
      return r2(baseTvd + ratio * seg.deltaTvd);
    }
  }
  return null;
}

/** 孔深区间 → 垂深区间；任一端点换算不出即整段待换算 */
export function convertRange(
  from: number,
  to: number,
  traj: SurveyTrajectory | null,
): { fromTvd: number | null; toTvd: number | null; status: TvdStatus } {
  if (!traj) return { fromTvd: null, toTvd: null, status: 'pending' };
  const fromTvd = tvdAt(from, traj);
  const toTvd = tvdAt(to, traj);
  const status: TvdStatus = fromTvd !== null && toTvd !== null ? 'ok' : 'pending';
  return { fromTvd, toTvd, status };
}

/**
 * 合并测斜成果：按孔深去重（补送同一份成果不多出测点）。
 * 相同孔深的测点保留原 id、更新倾角/方位角；新增点保留 incoming 自带 id。
 */
export function mergeSurveyPoints(
  existing: SurveyPoint[],
  incoming: SurveyPoint[],
): { points: SurveyPoint[]; added: number; updated: number } {
  const keyOf = (d: number) => Math.round(Number(d) * 1000);
  const map = new Map<number, SurveyPoint>();
  existing.forEach((p) => map.set(keyOf(p.depth), { ...p }));
  let added = 0;
  let updated = 0;
  incoming.forEach((p) => {
    const k = keyOf(p.depth);
    const prev = map.get(k);
    if (prev) {
      updated += 1;
      map.set(k, { ...prev, dip: p.dip, azimuth: p.azimuth });
    } else {
      added += 1;
      map.set(k, { ...p });
    }
  });
  const points = [...map.values()].sort((a, b) => a.depth - b.depth);
  return { points, added, updated };
}

/** 深度显示文案：按基准返回主深度值（孔深恒有值；垂深待换算返回 null） */
export function depthLabel(depth: number, basis: DepthBasis, traj: SurveyTrajectory | null): number | null {
  if (basis === 'md') return Number(depth);
  return tvdAt(depth, traj);
}
