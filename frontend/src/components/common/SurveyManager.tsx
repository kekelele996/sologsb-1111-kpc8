import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useHoleStore } from '../../stores/holeStore';
import { useTrajectory } from '../../hooks/useTrajectory';
import { convertRange, type SurveySegment } from '../../utils/survey';
import type { SurveyPoint } from '../../types/drill-hole';
import { uid } from '../../utils/id';

const { Text } = Typography;

function parseSurvey(text: string): SurveyPoint[] {
  if (!text.trim()) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [depth, dip, azimuth] = line.split(/[,，\s]+/).map((v) => Number(v));
      return { id: uid('sv'), depth: depth || 0, dip: dip || 0, azimuth: azimuth || 0 };
    });
}

/**
 * 测斜成果管理：测点按孔深去重（补送同一份成果不多出测点），
 * 测段换算按段展示状态，失败段标红并可在补测后按段重试（浅部已算好的测段保留）。
 */
export default function SurveyManager({ holeId }: { holeId: string }) {
  const { message } = AntApp.useApp();
  const hole = useHoleStore((s) => s.holes.find((h) => h.id === holeId));
  const importSurveyPoints = useHoleStore((s) => s.importSurveyPoints);
  const removeSurveyPoint = useHoleStore((s) => s.removeSurveyPoint);
  const traj = useTrajectory(holeId);
  const [retryTick, setRetryTick] = useState(0);

  const points = hole?.surveyData ?? [];
  const sortedPoints = useMemo(() => [...points].sort((a, b) => a.depth - b.depth), [points]);

  if (!hole) return null;

  const handleImport = async (text: string) => {
    const incoming = parseSurvey(text);
    if (incoming.length === 0) {
      message.warning('未解析到测点（每行：深度,倾角,方位角）');
      return;
    }
    const { added, updated } = await importSurveyPoints(holeId, incoming);
    message.success(`测斜成果已合并：新增 ${added} 点，更新 ${updated} 点（同孔深已去重）`);
  };

  const pointColumns: TableColumnsType<SurveyPoint> = [
    { title: '孔深(m)', dataIndex: 'depth', width: 90, align: 'right' },
    { title: '倾角(°)', dataIndex: 'dip', width: 80, align: 'right' },
    { title: '方位角(°)', dataIndex: 'azimuth', width: 90, align: 'right' },
    {
      title: '该点垂深(m)',
      width: 110,
      align: 'right',
      render: (_, p) => {
        const c = convertRange(p.depth, p.depth, traj);
        return c.status === 'ok' ? <Text>{c.fromTvd}</Text> : <Tag color="orange">待换算</Tag>;
      },
    },
    {
      title: '操作',
      width: 70,
      render: (_, p) => (
        <Popconfirm title={`删除孔深 ${p.depth}m 测点？`} onConfirm={() => removeSurveyPoint(holeId, p.id)}>
          <Button size="small" type="link" danger>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const segColumns: TableColumnsType<SurveySegment> = [
    { title: '测段', width: 120, render: (_, s) => `${s.fromDepth}~${s.toDepth}m` },
    {
      title: '平均倾角(°)',
      width: 90,
      align: 'right',
      render: (_, s) => {
        const startDip = s.index === 0 ? 90 : traj?.segments[s.index - 1]?.dip ?? 90;
        return (((startDip + s.dip) / 2).toFixed(1));
      },
    },
    { title: 'Δ垂深(m)', dataIndex: 'deltaTvd', width: 90, align: 'right' },
    { title: 'Δ北(m)', dataIndex: 'deltaNorth', width: 90, align: 'right' },
    { title: 'Δ东(m)', dataIndex: 'deltaEast', width: 90, align: 'right' },
    { title: '段末垂深(m)', dataIndex: 'tvdEnd', width: 100, align: 'right' },
    {
      title: '状态',
      render: (_, s) =>
        s.ok ? (
          <Tag color="green">已换算</Tag>
        ) : (
          <Space size={6}>
            <Tag color="red">失败</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {s.error}
            </Text>
          </Space>
        ),
    },
  ];

  return (
    <div>
      <Alert
        style={{ marginBottom: 10 }}
        type="info"
        showIcon
        message="测斜成果按孔深持有，补测或改点只影响垂深换算，不动地质编录的孔深。"
        description="粘贴测量组测斜成果（每行：深度,倾角,方位角）后点「导入合并」；相同孔深的测点自动合并去重，不会多出测点。"
      />
      <ImportArea onImport={handleImport} />

      <Table
        style={{ marginTop: 10 }}
        rowKey="id"
        size="small"
        columns={pointColumns}
        dataSource={sortedPoints}
        pagination={false}
        locale={{ emptyText: '暂无测斜点' }}
      />

      <div style={{ marginTop: 12, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text strong>测段换算（平均角法）{traj?.failedCount ? <Tag color="red">{traj.failedCount} 段失败</Tag> : <Tag color="green">全部已换算</Tag>}</Text>
        <Button size="small" onClick={() => { setRetryTick((t) => t + 1); message.info('已按当前测斜成果重新换算；补测新测点后失败段将自动重算'); }}>
          按段重试换算
        </Button>
      </div>
      <Table
        key={retryTick}
        rowKey={(s) => s.index}
        size="small"
        columns={segColumns}
        dataSource={traj?.segments ?? []}
        pagination={false}
        locale={{ emptyText: '暂无测段' }}
        rowClassName={(s) => (s.ok ? '' : 'survey-fail-row')}
      />
    </div>
  );
}

/** 批量粘贴导入区（独立组件，避免大文本受控拖累） */
function ImportArea({ onImport }: { onImport: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Space.Compact style={{ width: '100%' }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'每行：深度,倾角,方位角\n如：50,88.5,132'}
        style={{ width: '100%', minHeight: 64, padding: '6px 8px', border: '1px solid #d9d9d9', borderRadius: 6, fontFamily: 'monospace' }}
      />
      <Button type="primary" style={{ height: 'auto' }} onClick={() => { onImport(text); setText(''); }}>
        导入合并
      </Button>
    </Space.Compact>
  );
}
