import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { color as themeColor } from '@/lib/theme';

/**
 * The icon set.
 *
 * It replaces the emoji that used to sit in the tab bar. Emoji were the single
 * loudest "this is not a real app" signal, and they were also broken: the tab
 * bar passed a tint colour into a <Text> holding an emoji, and emoji ignore
 * `color` — so the active tab was never actually indicated by its icon, only
 * by the label underneath it. They also rendered as a different picture on
 * every OS version.
 *
 * These are drawn on a 24x24 grid with a 1.7 stroke. `filled` softly fills the
 * body of the glyph with the same colour at low opacity, which is how the
 * active tab is marked.
 */
export type IconName =
  | 'today'
  | 'meds'
  | 'visits'
  | 'family'
  | 'timeline'
  | 'account'
  | 'plus'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'alert'
  | 'close'
  | 'phone'
  | 'location'
  | 'search'
  | 'note'
  | 'handoff'
  | 'refill'
  | 'watch'
  | 'share'
  | 'leaf';

export function Icon({
  name,
  size = 22,
  color = themeColor.textMuted,
  filled = false,
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** Marks the active state — fills the glyph body at 18% of `color`. */
  filled?: boolean;
  strokeWidth?: number;
}) {
  const stroke = color;
  const fill = filled ? color : 'none';
  const fillOpacity = filled ? 0.18 : 0;
  const common = {
    stroke,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'today' && (
        <>
          <Circle cx={12} cy={12} r={4} fill={filled ? color : 'none'} stroke={stroke} strokeWidth={strokeWidth} />
          <Path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            {...common}
          />
        </>
      )}

      {name === 'meds' && (
        <>
          <Rect
            x={2.6}
            y={7.6}
            width={18.8}
            height={8.8}
            rx={4.4}
            fill={fill}
            fillOpacity={fillOpacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
          <Path d="M12 7.6v8.8" {...common} />
        </>
      )}

      {name === 'visits' && (
        <>
          <Rect
            x={3}
            y={5}
            width={18}
            height={16}
            rx={3.5}
            fill={fill}
            fillOpacity={fillOpacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
          <Path d="M8 3v4M16 3v4M3 10h18" {...common} />
        </>
      )}

      {name === 'family' && (
        <>
          <Path
            d="M15.5 20v-1.4a3.8 3.8 0 0 0-3.8-3.8H6.8A3.8 3.8 0 0 0 3 18.6V20"
            {...common}
            fill={fill}
            fillOpacity={fillOpacity}
          />
          <Circle
            cx={9.2}
            cy={7.4}
            r={3.4}
            fill={fill}
            fillOpacity={fillOpacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          <Path d="M21 20v-1.4a3.8 3.8 0 0 0-2.9-3.7M16 4.2a3.4 3.4 0 0 1 0 6.4" {...common} />
        </>
      )}

      {name === 'timeline' && (
        <>
          <Circle
            cx={12}
            cy={12}
            r={9}
            fill={fill}
            fillOpacity={fillOpacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          <Path d="M12 7v5.2l3.2 2" {...common} />
        </>
      )}

      {name === 'account' && (
        <>
          <Circle
            cx={12}
            cy={8}
            r={3.6}
            fill={fill}
            fillOpacity={fillOpacity}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          <Path d="M4.6 20a7.4 7.4 0 0 1 14.8 0" {...common} />
        </>
      )}

      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...common} strokeWidth={strokeWidth + 0.4} />}

      {name === 'check' && (
        <Path d="M4.5 12.5 9.5 17.5 19.5 7" {...common} strokeWidth={strokeWidth + 0.4} />
      )}

      {name === 'chevronLeft' && <Path d="M15 5l-7 7 7 7" {...common} strokeWidth={strokeWidth + 0.4} />}

      {name === 'chevronRight' && <Path d="M9 5l7 7-7 7" {...common} />}

      {name === 'alert' && (
        <>
          <Path
            d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
            {...common}
            fill={fill}
            fillOpacity={fillOpacity}
          />
          <Path d="M12 9v4.5M12 17.2v.1" {...common} strokeWidth={strokeWidth + 0.4} />
        </>
      )}

      {name === 'close' && <Path d="M6 6l12 12M18 6 6 18" {...common} strokeWidth={strokeWidth + 0.4} />}

      {name === 'phone' && (
        <Path
          d="M6.6 3.6h3.1l1.5 3.9-2 1.5a12.2 12.2 0 0 0 5.8 5.8l1.5-2 3.9 1.5v3.1a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.6 5.8a2 2 0 0 1 2-2.2Z"
          {...common}
          fill={fill}
          fillOpacity={fillOpacity}
        />
      )}

      {name === 'location' && (
        <>
          <Path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" {...common} fill={fill} fillOpacity={fillOpacity} />
          <Circle cx={12} cy={10} r={2.6} {...common} />
        </>
      )}

      {name === 'search' && (
        <>
          <Circle cx={11} cy={11} r={6.5} {...common} fill={fill} fillOpacity={fillOpacity} />
          <Path d="M15.8 15.8 20.5 20.5" {...common} strokeWidth={strokeWidth + 0.3} />
        </>
      )}

      {name === 'note' && (
        <>
          <Path
            d="M5.5 3.5h8L19 9v10.5A1.5 1.5 0 0 1 17.5 21h-12A1.5 1.5 0 0 1 4 19.5v-14a2 2 0 0 1 1.5-2Z"
            {...common}
            fill={fill}
            fillOpacity={fillOpacity}
          />
          <Path d="M13.5 3.5V9H19M8 13.5h7M8 17h4.5" {...common} />
        </>
      )}

      {/* An exchange, not a handshake — a hand-off is one person passing to another. */}
      {name === 'handoff' && (
        <Path d="M3.5 8.5h12M12 5l3.5 3.5L12 12M20.5 15.5h-12M12 12l-3.5 3.5L12 19" {...common} />
      )}

      {name === 'refill' && (
        <Path d="M20 11.5a8 8 0 1 1-2.4-5.7M20 4.5v5.5h-5.5" {...common} />
      )}

      {name === 'watch' && (
        <>
          <Path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" {...common} fill={fill} fillOpacity={fillOpacity} />
          <Circle cx={12} cy={12} r={3.1} {...common} />
        </>
      )}

      {name === 'share' && (
        <>
          <Path d="M12 3.5v12M8.2 7.3 12 3.5l3.8 3.8" {...common} />
          <Path d="M5 14v4.8A1.7 1.7 0 0 0 6.7 20.5h10.6A1.7 1.7 0 0 0 19 18.8V14" {...common} />
        </>
      )}

      {/* Empty states used a potted-plant emoji; a sprig is the same idea drawn. */}
      {name === 'leaf' && (
        <>
          <Path d="M5.5 18.5c0-7.5 4.8-12.4 13.4-13.4C19.9 13.6 15 19.4 8 19.4H5.5Z" {...common} fill={fill} fillOpacity={fillOpacity} />
          <Path d="M5.5 19.5c2.8-3.9 5.7-6 8.7-7" {...common} />
        </>
      )}
    </Svg>
  );
}
