import { StyleSheet, Text, View } from 'react-native';

import { initialOf } from '@/lib/format';
import { memberColorHex, MemberColor, palette } from '@/lib/theme';

export function Avatar({
  name,
  color = 'sage',
  size = 36,
}: {
  name: string | null | undefined;
  color?: MemberColor;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: memberColorHex[color] },
      ]}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initialOf(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: palette.white, fontWeight: '700' },
});
