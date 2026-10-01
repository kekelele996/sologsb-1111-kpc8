import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useHoleStore } from '../stores/holeStore';
import { buildSurveyTrack, type SurveyTrack } from '../utils/survey';
import type { DepthBasis } from '../types/drill-hole';

/**
 * 各孔测斜轨迹（由测斜成果派生，台帐更新后自动重算）。
 * 垂深只从这里换算，不回写到回次 / 岩芯箱 / 岩性记录上。
 */
export function useSurveyTracks(): Map<string, SurveyTrack> {
  const holes = useHoleStore((s) => s.holes);
  return useMemo(() => {
    const map = new Map<string, SurveyTrack>();
    holes.forEach((hole) => map.set(hole.id, buildSurveyTrack(hole.surveyData)));
    return map;
  }, [holes]);
}

/**
 * 深度基准（孔深 / 垂深）：保存在 URL query（?basis=tvd），
 * 工作台的剖面、覆盖与岩芯箱连续性按此基准显示。
 */
export function useDepthBasis(): [DepthBasis, (basis: DepthBasis) => void] {
  const [params, setParams] = useSearchParams();
  const basis: DepthBasis = params.get('basis') === 'tvd' ? 'tvd' : 'md';
  const setBasis = (next: DepthBasis) => {
    const p = new URLSearchParams(params);
    if (next === 'tvd') p.set('basis', 'tvd');
    else p.delete('basis');
    setParams(p, { replace: true });
  };
  return [basis, setBasis];
}
