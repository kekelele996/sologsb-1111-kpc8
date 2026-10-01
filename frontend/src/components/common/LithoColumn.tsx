import { Empty, Space, Tag, Typography } from 'antd';
import { LITHO_COLOR, type LithoLog } from '../../types/litho-log';
import type { DrillRun } from '../../types/drill-run';
import { useTrajectory } from '../../hooks/useTrajectory';
import { tvdAt, type DepthBasis } from '../../utils/survey';

const { Text } = Typography;

export interface LithoColumnProps {
  logs: LithoLog[];
  runs?: DrillRun[];
  /** 柱状图最大深度（m），默认取最大编录深度 */
  maxDepth?: number;
  height?: number;
  /** 深度基准：md 孔深 / tvd 垂深 */
  basis?: DepthBasis;
}

const COLUMN_X = 90;
const COLUMN_W = 78;

/**
 * 岩性柱状图：按深度区间绘制岩性色块并叠加样品位与回次采取率异常段。
 * 深度基准可切换孔深/垂深；垂深基准下测斜未覆盖的区间回退孔深位置并标「待换算」。
 */
export default function LithoColumn({ logs, runs = [], maxDepth, height = 460, basis = 'md' }: LithoColumnProps) {
  const traj = useTrajectory(logs[0]?.holeId);

  const depthOf = (md: number): number => {
    if (basis === 'md') return md;
    return tvdAt(md, traj) ?? md;
  };
  const isPending = (log: LithoLog): boolean =>
    basis === 'tvd' && (tvdAt(log.fromDepth, traj) === null || tvdAt(log.toDepth, traj) === null);

  if (logs.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可绘制的岩性区间" />;
  }

  const logBottoms = logs.map((log) => depthOf(log.toDepth));
  const depthMax = maxDepth && maxDepth > 0 ? (basis === 'md' ? maxDepth : depthOf(maxDepth)) : Math.max(...logBottoms);
  const scale = (depth: number) => (depth / depthMax) * height;
  const tickStep = depthMax > 300 ? 50 : depthMax > 150 ? 25 : 20;
  const ticks: number[] = [];
  for (let d = 0; d <= depthMax + 0.001; d += tickStep) {
    ticks.push(Number(d.toFixed(0)));
  }

  const samples = logs.filter((log) => log.sampleNo);
  const abnormalRuns = runs.filter((run) => run.recovery < 75);
  const pendingCount = logs.filter(isPending).length;

  return (
    <div style={{ background: '#fff', border: '1px solid #dbe4ea', borderRadius: 8, padding: 12 }}>
      <Space size={12} wrap style={{ marginBottom: 8 }}>
        <Text strong>岩性柱状图（0~{depthMax}m · {basis === 'md' ? '孔深' : '垂深'}）</Text>
        <Text type="secondary">样品位 {samples.length} 个 · 采取率异常段 {abnormalRuns.length} 段</Text>
        {pendingCount > 0 ? <Tag color="orange">{pendingCount} 段垂深待换算</Tag> : null}
      </Space>
      <svg viewBox={`0 0 360 ${height + 40}`} style={{ width: '100%', maxWidth: 460, height: 'auto' }} role="img" aria-label="岩性柱状图">
        {/* 深度轴 */}
        <line x1={COLUMN_X - 12} y1={0} x2={COLUMN_X - 12} y2={height} stroke="#b9c6d0" />
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={COLUMN_X - 16} y1={scale(tick)} x2={COLUMN_X - 8} y2={scale(tick)} stroke="#b9c6d0" />
            <text x={COLUMN_X - 20} y={scale(tick) + 4} textAnchor="end" fontSize="10" fill="#6b7a86">
              {tick}m
            </text>
          </g>
        ))}

        {/* 岩性色块 */}
        {logs.map((log) => {
          const pending = isPending(log);
          const top = depthOf(log.fromDepth);
          const bottom = depthOf(log.toDepth);
          const y = scale(top);
          const h = Math.max(6, scale(bottom) - scale(top));
          return (
            <g key={log.id}>
              <rect
                x={COLUMN_X}
                y={y}
                width={COLUMN_W}
                height={h}
                fill={LITHO_COLOR[log.lithology]}
                stroke={pending ? '#fa8c16' : '#8a99a5'}
                strokeDasharray={pending ? '4 3' : undefined}
              />
              <text x={COLUMN_X + COLUMN_W / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize="10" fill="#33414d">
                {log.lithology.slice(0, 4)}
              </text>
              <text x={COLUMN_X + COLUMN_W + 8} y={y + 12} fontSize="10" fill={pending ? '#d46b08' : '#6b7a86'}>
                {basis === 'md'
                  ? `${log.fromDepth}~${log.toDepth}m`
                  : pending
                    ? `${log.fromDepth}~${log.toDepth}m(孔深·待换算)`
                    : `${top}~${bottom}m(垂深)`}
                {log.alteration !== '无' ? ` · ${log.alteration}` : ''}
                {log.mineralization !== '无' ? ` · ${log.mineralization}` : ''}
              </text>
            </g>
          );
        })}

        {/* 样品位 */}
        {samples.map((log) => {
          const y = scale(depthOf((log.fromDepth + log.toDepth) / 2));
          return (
            <g key={`sample-${log.id}`}>
              <polygon points={`${COLUMN_X + COLUMN_W + 2},${y - 5} ${COLUMN_X + COLUMN_W + 9},${y} ${COLUMN_X + COLUMN_W + 2},${y + 5} ${COLUMN_X + COLUMN_W - 5},${y}`} fill="#c62828" />
              <text x={COLUMN_X + COLUMN_W + 14} y={y + 4} fontSize="10" fill="#c62828">
                {log.sampleNo} · RQD {log.rqd}%
              </text>
            </g>
          );
        })}

        {/* 采取率异常段 */}
        {abnormalRuns.map((run) => (
          <line
            key={`abn-${run.id}`}
            x1={COLUMN_X - 4}
            y1={scale(depthOf(run.fromDepth))}
            x2={COLUMN_X - 4}
            y2={scale(depthOf(run.toDepth))}
            stroke="#cf1322"
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );
}
