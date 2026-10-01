import { Tag } from 'antd';
import { useTrajectory } from '../../hooks/useTrajectory';
import { tvdAt, type DepthBasis } from '../../utils/survey';

export interface DepthValueProps {
  /** 孔深（m） */
  md: number;
  holeId?: string;
  basis: DepthBasis;
  /** 垂深待换算时的回退显示（默认显示孔深并加标记） */
  fallback?: 'md' | 'pending';
}

/**
 * 单值深度按基准显示：孔深恒有值；垂深换算不出时回退孔深并标「待换算」。
 * 被工作台设计/已达深度等列消费。
 */
export default function DepthValue({ md, holeId, basis, fallback = 'md' }: DepthValueProps) {
  const traj = useTrajectory(holeId);
  if (basis === 'md') return <span>{md}</span>;
  const tvd = tvdAt(md, traj);
  if (tvd !== null) return <span>{tvd}</span>;
  if (fallback === 'pending') return <Tag color="orange">待换算</Tag>;
  return (
    <span>
      {md}
      <Tag color="orange" style={{ marginInlineStart: 4 }}>
        垂深待换算
      </Tag>
    </span>
  );
}
