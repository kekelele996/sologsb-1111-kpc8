import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { DrillHole, HoleProgress, SurveyPoint } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import { buildHoleProgress } from '../utils/recovery';
import { mergeSurveyPoints } from '../utils/survey';

export interface HoleInput {
  holeNo: string;
  coordX: number;
  coordY: number;
  collarElevation: number;
  designDepth: number;
  finalDepth: number;
  startDate: string;
  endDate?: string;
  rigNo: string;
  shift: string;
  surveyData: SurveyPoint[];
  remark?: string;
}

interface HoleState {
  holes: DrillHole[];
  currentHoleId: string;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setCurrentHole: (id: string) => void;
  addHole: (input: HoleInput) => Promise<DrillHole>;
  updateHole: (id: string, patch: Partial<HoleInput>) => Promise<void>;
  removeHole: (id: string) => Promise<void>;
  /** 导入测斜成果：按孔深去重（补送同一份成果不多出测点），返回新增/更新点数 */
  importSurveyPoints: (holeId: string, points: SurveyPoint[]) => Promise<{ added: number; updated: number }>;
  /** 删除一个测斜点 */
  removeSurveyPoint: (holeId: string, pointId: string) => Promise<void>;
  /** 当前钻孔 */
  currentHole: () => DrillHole | undefined;
}

/** 钻孔台帐与当前孔 */
export const useHoleStore = create<HoleState>()((set, get) => ({
  holes: [],
  currentHoleId: '',
  hydrated: false,

  hydrate: async () => {
    const holes = await db.holes.orderBy('holeNo').toArray();
    set({ holes, currentHoleId: get().currentHoleId || holes[0]?.id || '', hydrated: true });
  },

  setCurrentHole: (id) => set({ currentHoleId: id }),

  addHole: async (input) => {
    const hole: DrillHole = {
      id: uid('hole'),
      holeNo: input.holeNo.trim(),
      coordX: Number(input.coordX) || 0,
      coordY: Number(input.coordY) || 0,
      collarElevation: Number(input.collarElevation) || 0,
      designDepth: Number(input.designDepth) || 0,
      finalDepth: Number(input.finalDepth) || 0,
      startDate: input.startDate,
      endDate: input.endDate || undefined,
      rigNo: input.rigNo,
      shift: input.shift,
      surveyData: input.surveyData,
      remark: input.remark?.trim() || undefined,
    };
    await db.holes.put(hole);
    set({ holes: [...get().holes, hole].sort((a, b) => a.holeNo.localeCompare(b.holeNo)), currentHoleId: hole.id });
    return hole;
  },

  updateHole: async (id, patch) => {
    const current = get().holes.find((h) => h.id === id);
    if (!current) return;
    const next: DrillHole = { ...current, ...patch };
    await db.holes.put(next);
    set({ holes: get().holes.map((h) => (h.id === id ? next : h)) });
  },

  removeHole: async (id) => {
    await db.holes.delete(id);
    set({ holes: get().holes.filter((h) => h.id !== id) });
  },

  importSurveyPoints: async (holeId, points) => {
    const current = get().holes.find((h) => h.id === holeId);
    if (!current) return { added: 0, updated: 0 };
    const { points: merged, added, updated } = mergeSurveyPoints(current.surveyData, points);
    const next: DrillHole = { ...current, surveyData: merged };
    await db.holes.put(next);
    set({ holes: get().holes.map((h) => (h.id === holeId ? next : h)) });
    return { added, updated };
  },

  removeSurveyPoint: async (holeId, pointId) => {
    const current = get().holes.find((h) => h.id === holeId);
    if (!current) return;
    const next: DrillHole = { ...current, surveyData: current.surveyData.filter((p) => p.id !== pointId) };
    await db.holes.put(next);
    set({ holes: get().holes.map((h) => (h.id === holeId ? next : h)) });
  },

  currentHole: () => get().holes.find((h) => h.id === get().currentHoleId),
}));

/** 钻孔进度派生（终孔深度 / 未达设计 / 待补勘） */
export function holeProgressList(holes: DrillHole[], runs: DrillRun[]): HoleProgress[] {
  return holes.map((hole) => buildHoleProgress(hole, runs.filter((run) => run.holeId === hole.id)));
}
