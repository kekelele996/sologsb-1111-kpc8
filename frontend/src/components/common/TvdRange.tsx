import { Tag, Tooltip, Typography } from 'antd';
import type { SegmentConversion } from '../../utils/survey';

const { Text } = Typography;

export interface TvdRangeProps {
  conversion: SegmentConversion;
}

/**
 * 垂深区间单元格：换算成功显示垂深区间；失败按孔深保留并标「待换算」，
 * 只影响本段显示，不阻塞其他段。被回次、岩芯箱、岩性编录页复用。
 */
export default function TvdRange({ conversion }: TvdRangeProps) {
  if (conversion.status === 'ok') {
    return (
      <Text>
        {conversion.tvdFrom}~{conversion.tvdTo}
      </Text>
    );
  }
  return (
    <Tooltip title={`${conversion.reason}；该段先按孔深 ${conversion.fromDepth}~${conversion.toDepth}m 保留，待测量组补送成果后可换算`}>
      <Tag color="orange">待换算</Tag>
    </Tooltip>
  );
}
