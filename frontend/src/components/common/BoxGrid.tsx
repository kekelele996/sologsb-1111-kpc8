import { Badge, Space, Tooltip, Typography } from 'antd';
import type { CoreBox } from '../../types/core-box';
import type { DrillRun } from '../../types/drill-run';
import { useTrajectory } from '../../hooks/useTrajectory';
import { convertRange, type DepthBasis } from '../../utils/survey';

const { Text } = Typography;

export interface BoxGridProps {
  box: CoreBox;
  runs?: DrillRun[];
  onToggleDamaged?: (slot: number) => void;
  compact?: boolean;
  /** 深度基准：md 孔深 / tvd 垂深 */
  basis?: DepthBasis;
}

/**
 * 岩芯箱格位网格：按深度填充每格并标注破损格，
 * 未被回次覆盖的格位以虚线标出（装箱断档）。
 * 垂深基准下格位深度换算为垂深；测斜未覆盖的格位标「待换算」，不计断档。
 */
export default function BoxGrid({ box, runs = [], onToggleDamaged, compact = false, basis = 'md' }: BoxGridProps) {
  const traj = useTrajectory(box.holeId);
  const holeRuns = runs.filter((run) => run.holeId === box.holeId);

  /** 回次在当前基准下的深度区间（垂深待换算的回次跳过覆盖判定） */
  const runIntervals = holeRuns
    .map((run) => {
      if (basis === 'md') return { from: run.fromDepth, to: run.toDepth, pending: false };
      const c = convertRange(run.fromDepth, run.toDepth, traj);
      return c.status === 'ok' && c.fromTvd !== null && c.toTvd !== null
        ? { from: c.fromTvd, to: c.toTvd, pending: false }
        : { from: 0, to: 0, pending: true };
    })
    .filter((r) => !r.pending);

  const total = box.slots;
  const cells = Array.from({ length: total }, (_, index) => {
    const slot = index + 1;
    const mdFrom = Number((box.fromDepth + index * box.slotLength).toFixed(2));
    const mdTo = Number(Math.min(mdFrom + box.slotLength, box.toDepth).toFixed(2));
    let from = mdFrom;
    let to = mdTo;
    let pending = false;
    if (basis === 'tvd') {
      const c = convertRange(mdFrom, mdTo, traj);
      if (c.status === 'ok' && c.fromTvd !== null && c.toTvd !== null) {
        from = c.fromTvd;
        to = c.toTvd;
      } else {
        pending = true;
      }
    }
    const covered = !pending && runIntervals.some((run) => Math.min(run.to, to) - Math.max(run.from, from) > 0.0001);
    return { slot, from, to, pending, covered, damaged: box.damagedSlots.includes(slot) };
  });

  const damaged = cells.filter((c) => c.damaged).length;
  const gaps = cells.filter((c) => !c.pending && !c.covered).length;
  const pendingCount = cells.filter((c) => c.pending).length;

  const boxRange =
    basis === 'md'
      ? `${box.fromDepth}~${box.toDepth}m`
      : (() => {
          const c = convertRange(box.fromDepth, box.toDepth, traj);
          return c.status === 'ok' && c.fromTvd !== null && c.toTvd !== null ? `${c.fromTvd}~${c.toTvd}m（垂深）` : '垂深待换算';
        })();

  return (
    <div>
      <Space size={12} wrap style={{ marginBottom: 6 }}>
        <Text type="secondary">
          箱号 {box.boxNo} · {boxRange} · {box.slots} 格 × {box.slotLength}m
        </Text>
        <Badge color="#237804" text={`已填充 ${total - gaps - pendingCount} 格`} />
        {gaps > 0 ? <Badge color="#d48806" text={`断档 ${gaps} 格`} /> : null}
        {pendingCount > 0 ? <Badge color="#fa8c16" text={`待换算 ${pendingCount} 格`} /> : null}
        {damaged > 0 ? <Badge color="#cf1322" text={`破损 ${damaged} 格`} /> : null}
      </Space>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${compact ? 10 : 12}, minmax(0, 1fr))`, gap: 4 }}>
        {cells.map((cell) => {
          const background = cell.damaged ? '#cf1322' : cell.pending ? '#fff7e6' : cell.covered ? '#5b7c8d' : '#f4f7f9';
          const color = cell.damaged || cell.covered ? '#fff' : cell.pending ? '#d46b08' : '#8a99a5';
          const border = cell.pending ? '1px dashed #fa8c16' : cell.covered ? '1px solid #4a6b7c' : '1px dashed #b9c6d0';
          return (
            <Tooltip
              key={cell.slot}
              title={`第 ${cell.slot} 格 · ${cell.pending ? '垂深待换算（保留孔深）' : `${cell.from}~${cell.to}m`} · ${
                cell.damaged ? '破损（岩芯缺失）' : cell.pending ? '测斜未覆盖，按孔深留箱位' : cell.covered ? '已装岩芯' : '无对应回次（断档）'
              }${onToggleDamaged ? ' · 点击切换破损标记' : ''}`}
            >
              <div
                onClick={() => onToggleDamaged?.(cell.slot)}
                style={{
                  cursor: onToggleDamaged ? 'pointer' : 'default',
                  border,
                  borderRadius: 4,
                  background,
                  color,
                  fontSize: 11,
                  padding: '4px 2px',
                  textAlign: 'center',
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 600 }}>{cell.slot}</div>
                <div>{cell.pending ? '待换算' : `${cell.from}~${cell.to}`}</div>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
