import React from 'react';
import { Tag } from 'antd';
import { useTrajectory } from '../../hooks/useTrajectory';
import { convertRange, type DepthBasis } from '../../utils/survey';

export interface DepthRangeCellProps {
  holeId?: string;
  fromDepth: number;
  toDepth: number;
  basis: DepthBasis;
  /** 是否显示另一套深度辅显行（默认显示） */
  showSecondary?: boolean;
}

const WRAP: React.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  lineHeight: 1.35,
};

const PRIMARY: React.CSSProperties = { fontWeight: 600, color: '#22323c' };
const SECONDARY: React.CSSProperties = { fontSize: 11, color: '#8a99a5' };

/**
 * 深度区间双深度显示：孔深与垂深分行并列，互不覆盖。
 * 基准（basis）决定主显行；另一套以小字辅显。垂深换算不出（测斜覆盖不到/测段失败）时标「待换算」。
 */
export default function DepthRangeCell({ holeId, fromDepth, toDepth, basis, showSecondary = true }: DepthRangeCellProps) {
  const traj = useTrajectory(holeId);
  const conv = convertRange(fromDepth, toDepth, traj);

  const mdText = `${fromDepth}~${toDepth}m`;
  const tvdText = conv.status === 'ok' && conv.fromTvd !== null && conv.toTvd !== null ? `${conv.fromTvd}~${conv.toTvd}m` : null;

  const primary =
    basis === 'md' ? (
      <span style={PRIMARY}>{mdText}</span>
    ) : conv.status === 'ok' ? (
      <span style={PRIMARY}>{tvdText}</span>
    ) : (
      <Tag color="orange" style={{ marginInlineEnd: 0 }}>
        垂深待换算
      </Tag>
    );

  const secondary = !showSecondary ? null : basis === 'md' ? (
    <span style={SECONDARY}>垂深 {tvdText ?? '待换算'}</span>
  ) : (
    <span style={SECONDARY}>孔深 {mdText}</span>
  );

  return (
    <span style={WRAP}>
      {primary}
      {secondary}
    </span>
  );
}
