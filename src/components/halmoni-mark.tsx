import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

/**
 * The Halmoni brand mark — the same drawing as the halmoni.uk header logo and
 * `favicon.svg`. It replaces the 👵 emoji, which rendered as a different face
 * on every platform and matched the brand on none of them.
 *
 * Kept in sync with halmoni-landing/favicon.svg by hand. If one changes, change
 * both.
 */
export function HalmoniMark({
  size = 64,
  style,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" style={[{ alignSelf: 'center' }, style]}>
      <Path
        d="M 140 300 Q 140 208 256 208 Q 372 208 372 300 Q 372 420 256 434 Q 140 420 140 300 Z"
        fill="#f4e7d1"
        stroke="#5c3a1e"
        strokeWidth={14}
        strokeLinejoin="round"
      />
      <G fill="#f4e7d1" stroke="#5c3a1e" strokeWidth={14}>
        <Circle cx={155} cy={245} r={32} />
        <Circle cx={357} cy={245} r={32} />
        <Circle cx={170} cy={201} r={38} />
        <Circle cx={342} cy={201} r={38} />
        <Circle cx={210} cy={173} r={42} />
        <Circle cx={302} cy={173} r={42} />
        <Circle cx={256} cy={167} r={46} />
      </G>
      <Circle cx={172} cy={362} r={24} fill="#f19aa2" opacity={0.75} />
      <Circle cx={340} cy={362} r={24} fill="#f19aa2" opacity={0.75} />
      <G fill="none" stroke="#5c3a1e" strokeWidth={12} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx={212} cy={310} r={32} />
        <Circle cx={300} cy={310} r={32} />
        <Line x1={244} y1={310} x2={268} y2={310} />
        <Line x1={180} y1={306} x2={164} y2={296} />
        <Line x1={332} y1={306} x2={348} y2={296} />
        <Path d="M 196 312 Q 212 296 228 312" />
        <Path d="M 284 312 Q 300 296 316 312" />
        <Path d="M 240 378 Q 256 390 272 378" />
      </G>
    </Svg>
  );
}
