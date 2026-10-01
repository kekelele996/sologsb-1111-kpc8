import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import FilterBar from '../components/common/FilterBar';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHoleFilter } from '../hooks/useHoleFilter';
import { useSurveyTracks } from '../hooks/useSurvey';
import { useHoleStore } from '../stores/holeStore';
import { useRunStore } from '../stores/runStore';
import { useBoxStore } from '../stores/boxStore';
import { RIG_NOS, SHIFTS, type DrillHole, type SurveyPoint } from '../types/drill-hole';
import { mergeRanges } from '../utils/recovery';
import { parseSurveyText } from '../utils/survey';

const { Title, Paragraph, Text } = Typography;

interface HoleFormValues {
  holeNo: string;
  coordX: number;
  coordY: number;
  collarElevation: number;
  designDepth: number;
  finalDepth: number;
  startDate: Dayjs;
  endDate?: Dayjs;
  rigNo: string;
  shift: string;
  surveyText?: string;
  remark?: string;
}

function surveyToText(points: SurveyPoint[]): string {
  return points.map((p) => `${p.depth},${p.dip},${p.azimuth}`).join('\n');
}

/** 钻孔台帐：新建钻孔并回显深度覆盖；测斜成果单独维护，只用于换算垂深 */
export default function HoleList() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const addHole = useHoleStore((s) => s.addHole);
  const updateHole = useHoleStore((s) => s.updateHole);
  const removeHole = useHoleStore((s) => s.removeHole);
  const mergeSurvey = useHoleStore((s) => s.mergeSurvey);
  const runs = useRunStore((s) => s.runs);
  const removeRunsByHole = useRunStore((s) => s.removeByHole);
  const boxes = useBoxStore((s) => s.boxes);
  const tracks = useSurveyTracks();

  const filter = useHoleFilter();
  const [form] = Form.useForm<HoleFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DrillHole | null>(null);
  /** 测量组补送测斜成果的合并弹窗 */
  const [importHole, setImportHole] = useState<DrillHole | null>(null);
  const [importText, setImportText] = useState('');
  const [importErrors, setImportErrors] = useState<Array<{ line: number; text: string; reason: string }>>([]);

  const visible = useMemo(() => filter.apply(holes), [holes, filter]);

  const coverageText = (holeId: string) => {
    const merged = mergeRanges(runs.filter((run) => run.holeId === holeId).map((run) => ({ from: run.fromDepth, to: run.toDepth })));
    if (merged.length === 0) return '尚无回次';
    return merged.map((range) => `${range.from}~${range.to}m`).join('、');
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      coordX: 512340,
      coordY: 3210880,
      collarElevation: 1240,
      designDepth: 200,
      finalDepth: 0,
      startDate: dayjs(),
      rigNo: 'XY-1',
      shift: '甲班',
      surveyText: '50,88.5,132',
    } as unknown as HoleFormValues);
    setOpen(true);
  };

  const openEdit = (record: DrillHole) => {
    setEditing(record);
    form.setFieldsValue({
      holeNo: record.holeNo,
      coordX: record.coordX,
      coordY: record.coordY,
      collarElevation: record.collarElevation,
      designDepth: record.designDepth,
      finalDepth: record.finalDepth,
      startDate: dayjs(record.startDate),
      endDate: record.endDate ? dayjs(record.endDate) : undefined,
      rigNo: record.rigNo,
      shift: record.shift,
      surveyText: surveyToText(record.surveyData),
      remark: record.remark,
    } as unknown as HoleFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const parsed = parseSurveyText(values.surveyText);
    if (parsed.errors.length > 0) {
      message.error(
        `测斜成果存在 ${parsed.errors.length} 行无效：${parsed.errors.map((e) => `第 ${e.line} 行（${e.reason}）`).join('；')}`,
      );
      return;
    }
    const payload = {
      holeNo: values.holeNo,
      coordX: Number(values.coordX) || 0,
      coordY: Number(values.coordY) || 0,
      collarElevation: Number(values.collarElevation) || 0,
      designDepth: Number(values.designDepth) || 0,
      finalDepth: Number(values.finalDepth) || 0,
      startDate: values.startDate.toISOString(),
      endDate: values.endDate ? values.endDate.toISOString() : undefined,
      rigNo: values.rigNo,
      shift: values.shift,
      surveyData: parsed.points,
      remark: values.remark,
    };
    if (editing) {
      await updateHole(editing.id, payload);
      message.success(`已更新钻孔 ${payload.holeNo}，垂深已按新测斜成果重算`);
    } else {
      await addHole(payload);
      message.success(`已建孔 ${payload.holeNo}`);
    }
    setOpen(false);
  };

  const openImport = (record: DrillHole) => {
    setImportHole(record);
    setImportText('');
    setImportErrors([]);
  };

  /** 弹窗内展示的钻孔以 store 最新值为准（合并后即时反映测点数） */
  const importHoleCurrent = holes.find((h) => h.id === importHole?.id);

  /** 合并补送成果：有效行入库（同孔深去重），无效行保留弹窗逐行报错 */
  const submitImport = async () => {
    if (!importHole) return;
    const parsed = parseSurveyText(importText);
    setImportErrors(parsed.errors);
    if (parsed.points.length === 0) {
      if (parsed.errors.length === 0) message.warning('请粘贴测量组补送的测斜成果');
      return;
    }
    const stats = await mergeSurvey(importHole.id, parsed.points);
    message.success(
      `已合并测斜成果：新增 ${stats.added} 点 · 更新 ${stats.updated} 点 · 相同 ${stats.unchanged} 点` +
        (parsed.errors.length ? ` · 跳过无效 ${parsed.errors.length} 行` : ''),
    );
    if (parsed.errors.length === 0) {
      setImportHole(null);
      setImportText('');
    }
  };

  const columns: TableColumnsType<DrillHole> = [
    { title: '孔号', dataIndex: 'holeNo', width: 110, render: (v: string) => <Text strong>{v}</Text> },
    { title: '钻机', dataIndex: 'rigNo', width: 90 },
    { title: '班组', dataIndex: 'shift', width: 80 },
    { title: '坐标(X, Y)', width: 200, render: (_, row) => `${row.coordX}, ${row.coordY}` },
    { title: '孔口标高(m)', dataIndex: 'collarElevation', width: 110, align: 'right' },
    { title: '设计孔深(m)', dataIndex: 'designDepth', width: 110, align: 'right' },
    { title: '终孔深度(m)', dataIndex: 'finalDepth', width: 110, align: 'right', render: (v: number) => (v > 0 ? v : '-') },
    {
      title: '深度覆盖（回次）',
      width: 260,
      render: (_, row) => <span style={{ fontSize: 12 }}>{coverageText(row.id)}</span>,
    },
    { title: '岩芯箱', width: 90, align: 'right', render: (_, row) => `${boxes.filter((b) => b.holeId === row.id).length} 箱` },
    {
      title: '测斜成果',
      width: 150,
      render: (_, row) => {
        const track = tracks.get(row.id);
        const invalid = track?.invalidPoints.length ?? 0;
        return (
          <Space size={4} wrap>
            <span>
              {row.surveyData.length} 点{track && track.maxDepth > 0 ? ` · 覆盖至 ${track.maxDepth}m` : ''}
            </span>
            {invalid > 0 ? <Tag color="orange">{invalid} 点无效</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '状态',
      width: 140,
      render: (_, row) => {
        if (row.endDate && row.finalDepth > 0 && row.finalDepth < row.designDepth) return <Tag color="red">未达设计 · 待补勘</Tag>;
        if (row.endDate) return <Tag color="green">已终孔</Tag>;
        return <Tag color="blue">在钻</Tag>;
      },
    },
    {
      title: '操作',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => openImport(record)}>
            补送测斜
          </Button>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title={`确认删除 ${record.holeNo}？（同时清除其回次）`}
            onConfirm={async () => {
              await removeRunsByHole(record.id);
              await removeHole(record.id);
              message.success('已删除钻孔及其回次');
            }}
          >
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        钻孔台帐
      </Title>
      <Paragraph type="secondary">登记钻孔坐标、孔口标高、设计孔深与测斜数据，并回显回次深度覆盖与岩芯箱数量。</Paragraph>

      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={openCreate}>
          新建钻孔
        </Button>
      </Space>

      <FilterBar
        fields={[
          { key: 'rig', label: '钻机', options: RIG_NOS, width: 110 },
          { key: 'shift', label: '施工班组', options: SHIFTS, width: 110 },
        ]}
        keywordPlaceholder="搜索孔号 / 钻机 / 备注"
        resultCount={visible.length}
        totalCount={holes.length}
      />

      {visible.length === 0 ? (
        <EmptyPanel description="没有符合条件的钻孔" actionText="重置筛选条件" onAction={filter.reset}>
          <div style={{ marginTop: 8 }}>
            <Button type="link" onClick={openCreate}>
              或直接新建一个钻孔
            </Button>
          </div>
        </EmptyPanel>
      ) : (
        <Card size="small">
          <Table rowKey="id" size="small" columns={columns} dataSource={visible} pagination={{ pageSize: 8 }} scroll={{ x: 1500 }} />
        </Card>
      )}

      <Modal
        open={open}
        title={editing ? `编辑钻孔 · ${editing.holeNo}` : '新建钻孔'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        width={720}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="holeNo" label="孔号" rules={[{ required: true, message: '请输入孔号' }]}>
            <Input placeholder="如：ZK-2406" maxLength={20} />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="coordX" label="坐标 X" rules={[{ required: true, message: '请输入坐标 X' }]}>
              <InputNumber style={{ width: 180 }} placeholder="坐标 X" />
            </Form.Item>
            <Form.Item name="coordY" label="坐标 Y" rules={[{ required: true, message: '请输入坐标 Y' }]}>
              <InputNumber style={{ width: 180 }} placeholder="坐标 Y" />
            </Form.Item>
            <Form.Item name="collarElevation" label="孔口标高(m)" rules={[{ required: true, message: '请输入孔口标高' }]}>
              <InputNumber style={{ width: 160 }} placeholder="孔口标高" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="designDepth" label="设计孔深(m)" rules={[{ required: true, message: '请输入设计孔深' }]}>
              <InputNumber min={0} style={{ width: 160 }} placeholder="设计孔深" />
            </Form.Item>
            <Form.Item name="finalDepth" label="终孔深度(m)" rules={[{ required: true, message: '请输入终孔深度' }]}>
              <InputNumber min={0} style={{ width: 160 }} placeholder="未终孔填 0" />
            </Form.Item>
            <Form.Item name="rigNo" label="钻机号" rules={[{ required: true, message: '请选择钻机号' }]}>
              <Select style={{ width: 150 }} options={RIG_NOS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="shift" label="施工班组" rules={[{ required: true, message: '请选择班组' }]}>
              <Select style={{ width: 140 }} options={SHIFTS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="startDate" label="开孔日期" rules={[{ required: true, message: '请选择开孔日期' }]}>
              <DatePicker style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="endDate" label="终孔日期（未终孔留空）">
              <DatePicker style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item name="surveyText" label="测斜数据（每行：孔深,倾角,方位角；倾角 90°=垂直孔）">
            <Input.TextArea rows={3} placeholder={'50,88.5,132\n100,87.2,133.5'} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={80} placeholder="设计见矿层位等" />
          </Form.Item>
        </Form>
        <Alert
          type="info"
          showIcon
          message="测斜成果只用于换算垂深：补测或改点只影响垂深一栏，回次、岩芯箱与岩性的孔深不受影响。终孔深度小于设计孔深时，将自动计入「未达设计 · 待补勘」清单。"
        />
      </Modal>

      <Modal
        open={importHole !== null}
        title={`补送测斜成果 · ${importHole?.holeNo ?? ''}`}
        onCancel={() => setImportHole(null)}
        onOk={submitImport}
        okText="合并导入"
        cancelText="取消"
        width={640}
      >
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          粘贴测量组补送的测斜成果（每行：孔深,倾角,方位角）。按测点孔深去重合并：同深度同值不变、异值更新、新深度追加，
          同一份成果重复补送不会多出测点。当前已有 {importHoleCurrent?.surveyData.length ?? 0} 点。
        </Paragraph>
        <Input.TextArea
          rows={6}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={'150,86.4,134\n200,85.9,135.2'}
        />
        {importErrors.length > 0 ? (
          <Alert
            style={{ marginTop: 10 }}
            type="warning"
            showIcon
            message={`${importErrors.length} 行无效已跳过（修正后可再次补送，已合并的测点不会重复）`}
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {importErrors.map((e) => (
                  <li key={e.line}>
                    第 {e.line} 行「{e.text}」：{e.reason}
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
      </Modal>
    </div>
  );
}
