import { Pressable, StyleSheet, Text, View } from 'react-native';

type ActionButtonProps = {
  label: string;
  caption: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function ActionButton({
  label,
  caption,
  onPress,
  variant = 'primary',
}: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.textGroup}>
        <Text style={[styles.label, labelStyles[variant]]}>{label}</Text>
        <Text style={[styles.caption, captionStyles[variant]]}>{caption}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.88,
  },
  textGroup: {
    gap: 3,
  },
  label: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: '#16372E',
    borderColor: '#16372E',
  },
  secondary: {
    backgroundColor: '#FFF9EE',
    borderColor: '#E8DDCB',
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: '#D8CDBB',
  },
});

const labelStyles = StyleSheet.create({
  primary: {
    color: '#FFFFFF',
  },
  secondary: {
    color: '#17372E',
  },
  ghost: {
    color: '#17372E',
  },
});

const captionStyles = StyleSheet.create({
  primary: {
    color: '#DCE7E2',
  },
  secondary: {
    color: '#596C64',
  },
  ghost: {
    color: '#61736C',
  },
});
