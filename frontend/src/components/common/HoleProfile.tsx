import { Empty, Space, Tag, Typography } from 'antd';
import type { CoreBox } from '../../types/core-box';
import type { DepthBasis, DrillHole } from '../../types/drill-hole';
import type { DrillRun } from '../../types/drill-run';
import { reachedDepthOf } from '../../utils/recovery';
import { convertSegment, type SegmentConversion, type SurveyTrack } from '../../utils/survey';

const { Text } = Typography;

export interface HoleProfileProps {
  hole: DrillHole;
  runs: DrillRun[];
  boxes: CoreBox[];
  track: SurveyTrack;
  basis: DepthBasis;
  height?: number;
}

const WIDTH = 640;
const AXIS_X = 86;
const RUN_LANE_X = 114;
const BOX_LANE_X = 152;
const TRAJ_BASE_X = 310;
const TOP = 18;
const BOTTOM = 30;

interface LaneItem {
  key: string;
  from: number;
  to: number;
  label: string;
}

/**
 * 钻孔剖面：按深度基准绘制。
 * 孔深基准画等深直孔柱；垂深基准按测斜轨迹（平均角法）画孔迹曲线，
 * 回次覆盖与岩芯箱换算到垂深后入图，换算失败的段不入图、列入右侧待换算清单。
 */
export default function HoleProfile({ hole, runs, boxes, track, basis, height = 420 }: HoleProfileProps) {
  const holeRuns = runs.filter((run) => run.holeId === hole.id);
  const holeBoxes = boxes.filter((box) => box.holeId === hole.id);
  const reached = Math.max(hole.finalDepth || 0, reachedDepthOf(holeRuns));

  if (basis === 'tvd' && track.stations.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无测斜成果，无法绘制垂深剖面；待测量组补送后自动换算" />;
  }

  // 各段按基准换算：垂深基准下失败段保持孔深、列入待换算清单，不挡住已换算段
  const pending: Array<{ key: string; kind: string; label: string; conv: SegmentConversion }> = [];
  const place = <T extends { id: string; fromDepth: number; toDepth: number }>(
    items: T[],
    kind: string,
    labelOf: (item: T) => string,
  ): LaneItem[] => {
    const placed: LaneItem[] = [];
    items.forEach((item) => {
      if (basis === 'md') {
        placed.push({ key: item.id, from: item.fromDepth, to: item.toDepth, label: labelOf(item) });
        return;
      }
      const conv = convertSegment(track, item.fromDepth, item.toDepth);
      if (conv.status === 'ok') {
        placed.push({ key: item.id, from: conv.tvdFrom!, to: conv.tvdTo!, label: labelOf(item) });
      } else {
        pending.push({ key: item.id, kind, label: labelOf(item), conv });
      }
    });
    return placed;
  };

  const runItems = place(holeRuns, '回次', (run) => run.runNo);
  const boxItems = place(holeBoxes, '岩芯箱', (box) => box.boxNo);

  // 深度轴范围：孔深基准用孔深；垂深基准用可换算到的最大垂深
  const reachedTvd = basis === 'tvd' ? convertSegment(track, 0, reached) : undefined;
  const axisMax =
    basis === 'md'
      ? Math.max(hole.designDepth, reached, track.maxDepth, ...holeBoxes.map((b) => b.toDepth), 1)
      : Math.max(
          track.stations[track.stations.length - 1].tvd,
          reachedTvd?.status === 'ok' ? reachedTvd.tvdTo! : 0,
          ...runItems.map((r) => r.to),
          ...boxItems.map((b) => b.to),
          1,
        );

  const y = (depth: number) => TOP + (depth / axisMax) * (height - TOP - BOTTOM);
  const maxHorizontal = Math.max(...track.stations.map((s) => s.horizontal), 0.01);
  const x = (horizontal: number) =>
    basis === 'md' ? TRAJ_BASE_X : TRAJ_BASE_X + (horizontal / maxHorizontal) * (WIDTH - TRAJ_BASE_X - 70);

  const tickStep = axisMax > 300 ? 50 : axisMax > 150 ? 25 : axisMax > 60 ? 20 : 10;
  const ticks: number[] = [];
  for (let d = 0; d <= axisMax + 0.001; d += tickStep) {
    ticks.push(Number(d.toFixed(0)));
  }

  const axisLabel = basis === 'md' ? '孔深(m)' : '垂深(m)';
  const designLine = basis === 'md' && hole.designDepth > 0 ? hole.designDepth : undefined;
  const reachedLine = basis === 'tvd' && reachedTvd?.status === 'ok' ? reachedTvd.tvdTo! : undefined;

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 320, flex: '1 1 420px' }}>
        <Space size={12} wrap style={{ marginBottom: 6 }}>
          <Text strong>
            {hole.holeNo} 剖面（{basis === 'md' ? '孔深基准' : '垂深基准'}）
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            回次覆盖 {runItems.length} 段 · 岩芯箱 {boxItems.length} 箱
            {basis === 'tvd' ? ` · 测点 ${track.stations.length - 1} 个` : ''}
            {pending.length ? ` · 待换算 ${pending.length} 段` : ''}
          </Text>
        </Space>
        <svg viewBox={`0 0 ${WIDTH} ${height}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="钻孔剖面">
          {/* 深度轴 */}
          <line x1={AXIS_X} y1={TOP} x2={AXIS_X} y2={height - BOTTOM} stroke="#b9c6d0" />
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={AXIS_X - 4} y1={y(tick)} x2={AXIS_X + 4} y2={y(tick)} stroke="#b9c6d0" />
              <text x={AXIS_X - 8} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="#6b7a86">
                {tick}
              </text>
            </g>
          ))}
          <text x={AXIS_X - 8} y={TOP - 6} textAnchor="end" fontSize="10" fill="#6b7a86">
            {axisLabel}
          </text>

          {/* 设计孔深 / 已达垂深参考线 */}
          {designLine !== undefined ? (
            <g>
              <line x1={AXIS_X} y1={y(designLine)} x2={WIDTH - 60} y2={y(designLine)} stroke="#d48806" strokeDasharray="5 4" />
              <text x={WIDTH - 56} y={y(designLine) + 4} fontSize="10" fill="#d48806">
                设计孔深 {hole.designDepth}m
              </text>
            </g>
          ) : null}
          {reachedLine !== undefined ? (
            <g>
              <line x1={AXIS_X} y1={y(reachedLine)} x2={WIDTH - 60} y2={y(reachedLine)} stroke="#237804" strokeDasharray="5 4" />
              <text x={WIDTH - 56} y={y(reachedLine) + 4} fontSize="10" fill="#237804">
                已达垂深 {reachedLine}m
              </text>
            </g>
          ) : null}

          {/* 回次覆盖 lane */}
          {runItems.map((item) => (
            <rect key={item.key} x={RUN_LANE_X} y={y(item.from)} width={12} height={Math.max(2, y(item.to) - y(item.from))} fill="#5b7c8d" rx={2}>
              <title>{`回次 ${item.label} · ${axisLabel.replace('(m)', '')} ${item.from}~${item.to}m`}</title>
            </rect>
          ))}
          <text x={RUN_LANE_X + 6} y={height - 10} textAnchor="middle" fontSize="10" fill="#6b7a86">
            回次
          </text>

          {/* 岩芯箱 lane */}
          {boxItems.map((item) => (
            <g key={item.key}>
              <rect x={BOX_LANE_X} y={y(item.from)} width={8} height={Math.max(2, y(item.to) - y(item.from))} fill="#8fb98a" rx={2}>
                <title>{`岩芯箱 ${item.label} · ${item.from}~${item.to}m`}</title>
              </rect>
              <text x={BOX_LANE_X + 12} y={y(item.from) + 10} fontSize="10" fill="#4a6b7c">
                {item.label}
              </text>
            </g>
          ))}
          <text x={BOX_LANE_X + 4} y={height - 10} textAnchor="middle" fontSize="10" fill="#6b7a86">
            箱
          </text>

          {/* 孔迹 */}
          {basis === 'md' ? (
            <line x1={TRAJ_BASE_X} y1={y(0)} x2={TRAJ_BASE_X} y2={y(Math.min(reached || hole.designDepth, axisMax))} stroke="#3b6c8f" strokeWidth={2.5} />
          ) : (
            <g>
              <polyline
                points={track.stations.map((s) => `${x(s.horizontal)},${y(s.tvd)}`).join(' ')}
                fill="none"
                stroke="#3b6c8f"
                strokeWidth={2.5}
              />
              {track.stations.slice(1).map((s) => (
                <circle key={s.depth} cx={x(s.horizontal)} cy={y(s.tvd)} r={3.5} fill="#c62828">
                  <title>{`测点 孔深 ${s.depth}m · 倾角 ${s.dip}° · 方位 ${s.azimuth}° · 垂深 ${Number(s.tvd.toFixed(2))}m`}</title>
                </circle>
              ))}
              <text x={x(maxHorizontal)} y={height - 10} textAnchor="middle" fontSize="10" fill="#6b7a86">
                水平位移(m) →
              </text>
            </g>
          )}
        </svg>
      </div>

      {pending.length > 0 ? (
        <div style={{ flex: '0 1 220px' }}>
          <Text strong type="warning">
            待换算 {pending.length} 段（按孔深保留）
          </Text>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pending.map((item) => (
              <div key={`${item.kind}-${item.key}`}>
                <Tag color="orange">
                  {item.kind} {item.label}
                </Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  孔深 {item.conv.fromDepth}~{item.conv.toDepth}m · {item.conv.reason}
                </Text>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
