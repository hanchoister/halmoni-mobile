// Tiny bar-style sparkline for medication adherence. Each bar's height
// reflects the day's given/scheduled ratio; missing days render as a faint
// stub so the shape reads as a streak vs. a gap. Zero deps beyond
// react-native-svg.

import Svg, { Rect } from 'react-native-svg';

import type { DayAdherence } from '@/lib/adherence';
import { palette } from '@/lib/theme';

interface Props {
  days: DayAdherence[];
  width?: number;
  height?: number;
  gapPx?: number;
  color?: string;
  missingColor?: string;
}

export function AdherenceSparkline({
  days,
  width = 120,
  height = 32,
  gapPx = 2,
  color = palette.sage500,
  missingColor = palette.cream300,
}: Props) {
  const n = Math.max(days.length, 1);
  const barWidth = Math.max((width - gapPx * (n - 1)) / n, 1);
  const minBar = 3;

  return (
    <Svg width={width} height={height}>
      {days.map((d, i) => {
        const x = i * (barWidth + gapPx);
        if (d.rate == null) {
          return (
            <Rect
              key={d.date}
              x={x}
              y={height - minBar}
              width={barWidth}
              height={minBar}
              rx={1}
              fill={missingColor}
            />
          );
        }
        const h = Math.max(minBar, d.rate * height);
        return (
          <Rect
            key={d.date}
            x={x}
            y={height - h}
            width={barWidth}
            height={h}
            rx={1}
            fill={color}
            opacity={0.4 + 0.6 * d.rate}
          />
        );
      })}
    </Svg>
  );
}
