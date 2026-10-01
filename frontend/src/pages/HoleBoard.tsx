import { useMemo } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Empty, Progress, Row, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { Link } from 'react-router-dom';
import StatBadge from '../components/common/StatBadge';
import RecoveryBadge from '../components/common/RecoveryBadge';
import FilterBar from '../components/common/FilterBar';
import HoleProfile from '../components/common/HoleProfile';
import TvdRange from '../components/common/TvdRange';
import { useHoleFilter } from '../hooks/useHoleFilter';
import { useDepthBasis, useSurveyTracks } from '../hooks/useSurvey';
import { useHoleStore, holeProgressList } from '../stores/holeStore';
import { useRunStore, anomalyList } from '../stores/runStore';
import { useBoxStore } from '../stores/boxStore';
import { useLithoStore } from '../stores/lithoStore';
import { RIG_NOS, SHIFTS, type DepthBasis, type HoleProgress } from '../types/drill-hole';
import type { CoreBox } from '../types/core-box';
import type { RunAnomaly } from '../types/drill-run';
import { checkBoxContinuity, isAnomaly, mergeRanges } from '../utils/recovery';
import { checkBoxContinuityTvd, convertSegment, EMPTY_TRACK, splitConversions, tvdAt } from '../utils/survey';

const { Title, Paragraph, Text } = Typography;

/** 待换算段：换算失败按孔深保留，可逐段重试 */
interface PendingItem {
  key: string;
  kind: '回次' | '岩芯箱' | '岩性';
  holeId: string;
  holeNo: string;
  label: string;
  fromDepth: number;
  toDepth: number;
  reason: string;
}

interface ContinuityRow {
  box: CoreBox;
  status: 'covered' | 'gaps' | 'pending';
  message: string;
}

/** 工作台：钻孔进度、剖面与岩芯箱连续性（按深度基准显示）、采取率异常清单 */
export default function HoleBoard() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const currentHoleId = useHoleStore((s) => s.currentHoleId);
  const setCurrentHole = useHoleStore((s) => s.setCurrentHole);
  const runs = useRunStore((s) => s.runs);
  const boxes = useBoxStore((s) => s.boxes);
  const lithos = useLithoStore((s) => s.lithos);
  const filter = useHoleFilter();
  const tracks = useSurveyTracks();
  const [basis, setBasis] = useDepthBasis();

  const visibleHoles = useMemo(() => filter.apply(holes), [holes, filter]);
  const progress = useMemo(() => holeProgressList(visibleHoles, runs), [visibleHoles, runs]);

  const holeNoOf = (holeId: string) => holes.find((h) => h.id === holeId)?.holeNo ?? '未知孔';
  const anomalies = useMemo<RunAnomaly[]>(
    () => anomalyList(runs.filter((run) => filter.matchRun(run, holes)), holeNoOf),
    [runs, holes, filter],
  );

  const inDrilling = progress.filter((item) => !item.finished).length;
  const finished = progress.filter((item) => item.finished).length;
  const supplement = progress.filter((item) => item.needSupplement);
  const avgRecovery = useMemo(() => {
    const totalFootage = runs.reduce((sum, run) => sum + run.footage, 0);
    const totalCore = runs.reduce((sum, run) => sum + run.coreLength, 0);
    return totalFootage > 0 ? Number(((totalCore / totalFootage) * 100).toFixed(1)) : 0;
  }, [runs]);

  /** 深度覆盖（按基准）：垂深基准下逐段换算，失败段计数待换算 */
  const coverageOf = (holeId: string): { ranges: Array<{ from: number; to: number }>; pendingCount: number } => {
    const holeRuns = runs.filter((run) => run.holeId === holeId);
    if (basis === 'md') {
      return { ranges: mergeRanges(holeRuns.map((run) => ({ from: run.fromDepth, to: run.toDepth }))), pendingCount: 0 };
    }
    const track = tracks.get(holeId) ?? EMPTY_TRACK;
    const { ok, pending } = splitConversions(holeRuns.map((run) => convertSegment(track, run.fromDepth, run.toDepth)));
    return { ranges: ok, pendingCount: pending.length };
  };

  /** 待换算清单（垂深基准）：回次 / 岩芯箱 / 岩性逐段收集，互不影响 */
  const pendingItems = useMemo<PendingItem[]>(() => {
    if (basis !== 'tvd') return [];
    const items: PendingItem[] = [];
    visibleHoles.forEach((hole) => {
      const track = tracks.get(hole.id) ?? EMPTY_TRACK;
      const collect = (kind: PendingItem['kind'], key: string, label: string, fromDepth: number, toDepth: number) => {
        const conv = convertSegment(track, fromDepth, toDepth);
        if (conv.status === 'pending') {
          items.push({ key, kind, holeId: hole.id, holeNo: hole.holeNo, label, fromDepth, toDepth, reason: conv.reason ?? '' });
        }
      };
      runs.filter((run) => run.holeId === hole.id).forEach((run) => collect('回次', run.id, run.runNo, run.fromDepth, run.toDepth));
      boxes.filter((box) => box.holeId === hole.id).forEach((box) => collect('岩芯箱', box.id, box.boxNo, box.fromDepth, box.toDepth));
      lithos
        .filter((log) => log.holeId === hole.id)
        .forEach((log) => collect('岩性', log.id, log.sampleNo || log.lithology, log.fromDepth, log.toDepth));
    });
    return items;
  }, [basis, visibleHoles, tracks, runs, boxes, lithos]);

  /** 按段重试：只重算本段，已换算的段保持不动 */
  const retrySegment = (item: { holeId: string; fromDepth: number; toDepth: number; label: string }) => {
    const track = tracks.get(item.holeId) ?? EMPTY_TRACK;
    const res = convertSegment(track, item.fromDepth, item.toDepth);
    if (res.status === 'ok') {
      message.success(`${item.label} 换算成功：垂深 ${res.tvdFrom}~${res.tvdTo}m`);
    } else {
      message.warning(`${item.label} 仍待换算：${res.reason}`);
    }
  };

  /** 岩芯箱连续性（按基准）：垂深基准下箱体与回次换算到垂深空间校验 */
  const continuityRows = useMemo<ContinuityRow[]>(() => {
    const holeIds = new Set(visibleHoles.map((h) => h.id));
    return boxes
      .filter((box) => holeIds.has(box.holeId))
      .map((box): ContinuityRow => {
        if (basis === 'md') {
          const c = checkBoxContinuity(box, runs);
          return { box, status: c.covered ? 'covered' : 'gaps', message: c.message };
        }
        const track = tracks.get(box.holeId) ?? EMPTY_TRACK;
        const c = checkBoxContinuityTvd(
          box,
          runs.filter((run) => run.holeId === box.holeId),
          track,
        );
        return { box, status: c.status, message: c.message };
      })
      .sort((a, b) => holeNoOf(a.box.holeId).localeCompare(holeNoOf(b.box.holeId)) || a.box.fromDepth - b.box.fromDepth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis, boxes, visibleHoles, runs, tracks]);

  const profileHole = holes.find((h) => h.id === currentHoleId) ?? visibleHoles[0] ?? holes[0];

  const basisText = basis === 'tvd' ? '垂深' : '孔深';

  const progressColumns: TableColumnsType<HoleProgress> = [
    { title: '孔号', width: 110, render: (_, row) => <Text strong>{row.hole.holeNo}</Text> },
    { title: '钻机', width: 90, render: (_, row) => row.hole.rigNo },
    { title: '班组', width: 80, render: (_, row) => row.hole.shift },
    { title: '设计孔深(m)', width: 110, align: 'right', render: (_, row) => row.hole.designDepth },
    {
      title: `已达深度(m)·${basisText}`,
      width: 140,
      align: 'right',
      render: (_, row) => {
        if (basis === 'md') return row.reachedDepth;
        const tvd = tvdAt(tracks.get(row.hole.id) ?? EMPTY_TRACK, row.reachedDepth);
        return tvd !== undefined ? tvd : <Tag color="orange">待换算</Tag>;
      },
    },
    {
      title: `深度覆盖·${basisText}`,
      width: 210,
      render: (_, row) => {
        const cov = coverageOf(row.hole.id);
        if (cov.ranges.length === 0 && cov.pendingCount === 0) return <Text type="secondary">尚无回次</Text>;
        return (
          <Space size={4} wrap>
            <span style={{ fontSize: 12 }}>{cov.ranges.length ? cov.ranges.map((r) => `${r.from}~${r.to}m`).join('、') : '—'}</span>
            {cov.pendingCount > 0 ? <Tag color="orange">待换算 {cov.pendingCount} 段</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '设计达成率',
      width: 170,
      render: (_, row) => (
        <Progress percent={Math.min(100, Math.round(row.designRatio))} size="small" status={row.needSupplement ? 'exception' : undefined} />
      ),
    },
    {
      title: '状态',
      width: 150,
      render: (_, row) =>
        row.needSupplement ? (
          <Tag color="red">未达设计 · 待补勘</Tag>
        ) : row.finished ? (
          <Tag color="green">已终孔</Tag>
        ) : (
          <Tag color="blue">在钻</Tag>
        ),
    },
    {
      title: '操作',
      width: 100,
      render: (_, row) => (
        <Link to="/runs">
          <Button size="small" type="link">
            录回次
          </Button>
        </Link>
      ),
    },
  ];

  const anomalyColumns: TableColumnsType<RunAnomaly> = [
    { title: '孔号', width: 100, render: (_, row) => row.holeNo },
    { title: '回次号', width: 110, render: (_, row) => row.run.runNo },
    {
      title: '深度区间(m)',
      width: 130,
      render: (_, row) => `${row.run.fromDepth}~${row.run.toDepth}`,
    },
    { title: '进尺(m)', width: 90, align: 'right', render: (_, row) => row.run.footage },
    { title: '岩芯长度(m)', width: 110, align: 'right', render: (_, row) => row.run.coreLength },
    { title: '采取率', width: 130, render: (_, row) => <RecoveryBadge recovery={row.run.recovery} /> },
    { title: '处置建议', render: (_, row) => <Text type="danger">{row.advice}</Text> },
  ];

  const continuityColumns: TableColumnsType<ContinuityRow> = [
    { title: '孔号', width: 100, render: (_, row) => holeNoOf(row.box.holeId) },
    { title: '箱号', width: 120, render: (_, row) => <Text strong>{row.box.boxNo}</Text> },
    {
      title: `深度区间(m)·${basisText}`,
      width: 150,
      render: (_, row) => {
        if (basis === 'md') return `${row.box.fromDepth}~${row.box.toDepth}`;
        const conv = convertSegment(tracks.get(row.box.holeId) ?? EMPTY_TRACK, row.box.fromDepth, row.box.toDepth);
        return <TvdRange conversion={conv} />;
      },
    },
    {
      title: '连续性',
      render: (_, row) => {
        if (row.status === 'pending') {
          return (
            <Space size={4} wrap>
              <Text type="warning" style={{ fontSize: 12 }}>
                {row.message}
              </Text>
              <Button
                size="small"
                type="link"
                onClick={() => retrySegment({ holeId: row.box.holeId, fromDepth: row.box.fromDepth, toDepth: row.box.toDepth, label: `箱 ${row.box.boxNo}` })}
              >
                重试
              </Button>
            </Space>
          );
        }
        return <Text type={row.status === 'covered' ? 'success' : 'danger'}>{row.message}</Text>;
      },
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        矿区钻孔岩芯编目台
      </Title>
      <Paragraph type="secondary">
        回次、岩芯箱与岩性按孔深编录，垂深由测斜成果换算派生：两套深度各自持有、互不覆盖。数据保存在浏览器本地（IndexedDB：
        gbdrillcore-db）。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="在钻钻孔" value={inDrilling} unit="个" status="warning" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="已终孔" value={finished} unit="个" status="success" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge
            label="未达设计待补勘"
            value={supplement.length}
            unit="个"
            status={supplement.length ? 'error' : 'success'}
            hint="终孔深度小于设计孔深"
          />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="有效采取率" value={avgRecovery} unit="%" status={avgRecovery >= 75 ? 'success' : 'error'} hint="岩芯长度合计 / 进尺合计" />
        </Col>
      </Row>

      {supplement.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          message={`未达设计孔深提醒：${supplement.length} 个钻孔终孔深度小于设计孔深，已计入待补勘`}
          description={
            <Space wrap>
              {supplement.map((item) => (
                <Tag key={item.hole.id} color="red">
                  {item.hole.holeNo}：终孔 {item.hole.finalDepth}m / 设计 {item.hole.designDepth}m（差 {(item.hole.designDepth - item.hole.finalDepth).toFixed(1)}m）
                </Tag>
              ))}
            </Space>
          }
        />
      ) : null}

      {basis === 'tvd' && pendingItems.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`${pendingItems.length} 段待换算：已按孔深保留，不影响其他段的垂深显示；测量组补送成果后可逐段重试`}
          description={
            <Space wrap size={[8, 6]}>
              {pendingItems.slice(0, 12).map((item) => (
                <Tag key={`${item.kind}-${item.key}`} color="orange" style={{ paddingInline: 8 }}>
                  {item.holeNo} {item.kind} {item.label} 孔深{item.fromDepth}~{item.toDepth}m
                  <Button
                    size="small"
                    type="link"
                    style={{ height: 'auto', padding: '0 0 0 4px' }}
                    onClick={() => retrySegment({ holeId: item.holeId, fromDepth: item.fromDepth, toDepth: item.toDepth, label: `${item.holeNo} ${item.kind} ${item.label}` })}
                  >
                    重试
                  </Button>
                </Tag>
              ))}
              {pendingItems.length > 12 ? <Tag>等 {pendingItems.length} 段</Tag> : null}
            </Space>
          }
        />
      ) : null}

      <FilterBar
        fields={[
          { key: 'rig', label: '钻机', options: RIG_NOS, width: 110 },
          { key: 'shift', label: '施工班组', options: SHIFTS, width: 110 },
        ]}
        keywordPlaceholder="搜索孔号 / 钻机 / 备注"
        resultCount={visibleHoles.length}
        totalCount={holes.length}
        extra={
          <Space size={6}>
            <span style={{ color: '#6b7a86' }}>深度基准</span>
            <Segmented
              value={basis}
              onChange={(value) => setBasis(value as DepthBasis)}
              options={[
                { label: '孔深基准', value: 'md' },
                { label: '垂深基准', value: 'tvd' },
              ]}
            />
          </Space>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="钻孔进度" size="small" extra={<Link to="/holes"><Button size="small" type="primary">去钻孔台帐</Button></Link>}>
            <Table
              rowKey={(row) => row.hole.id}
              size="small"
              columns={progressColumns}
              dataSource={progress}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              scroll={{ x: 1180 }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title="采取率异常清单（< 75% 标红）"
            size="small"
            extra={<Tag color={anomalies.length ? 'red' : 'green'}>{anomalies.length} 条</Tag>}
          >
            <Table
              rowKey={(row) => row.run.id}
              size="small"
              columns={anomalyColumns}
              dataSource={anomalies}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              scroll={{ x: 800 }}
              locale={{ emptyText: '暂无异常回次，采取率均不低于 75%' }}
            />
          </Card>
          <Card title="异常统计" size="small" style={{ marginTop: 16 }}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text>
                回次总数 <Text strong>{runs.length}</Text> 个，其中采取率异常{' '}
                <Text strong type="danger">
                  {runs.filter((run) => isAnomaly(run.recovery)).length}
                </Text>{' '}
                个
              </Text>
              <Text type="secondary">
                累计进尺 {runs.reduce((sum, run) => sum + run.footage, 0).toFixed(2)} m · 累计岩芯{' '}
                {runs.reduce((sum, run) => sum + run.coreLength, 0).toFixed(2)} m
              </Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            title={`钻孔剖面（${basisText}基准）`}
            size="small"
            extra={
              <Select
                size="small"
                style={{ width: 180 }}
                value={profileHole?.id}
                onChange={setCurrentHole}
                options={holes.map((hole) => ({ label: hole.holeNo, value: hole.id }))}
                placeholder="选择钻孔"
              />
            }
          >
            {profileHole ? (
              <HoleProfile hole={profileHole} runs={runs} boxes={boxes} track={tracks.get(profileHole.id) ?? EMPTY_TRACK} basis={basis} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无钻孔" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title={`岩芯箱连续性（${basisText}基准）`} size="small">
            <Table
              rowKey={(row) => row.box.id}
              size="small"
              columns={continuityColumns}
              dataSource={continuityRows}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              scroll={{ x: 640 }}
              locale={{ emptyText: '筛选范围内暂无岩芯箱' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
