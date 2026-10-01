import { useMemo } from 'react';
import { useHoleStore } from '../stores/holeStore';
import { computeTrajectory, type SurveyTrajectory } from '../utils/survey';

/** 按孔取测斜轨迹（平均角法）；测斜点变更后自动重算 */
export function useTrajectory(holeId: string | undefined | null): SurveyTrajectory | null {
  const surveyData = useHoleStore((s) => s.holes.find((h) => h.id === holeId)?.surveyData);
  return useMemo(() => (surveyData ? computeTrajectory(surveyData) : null), [surveyData]);
}
