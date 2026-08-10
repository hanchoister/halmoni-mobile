// Catches render-tree exceptions so a single broken screen doesn't crash the
// whole app. Wrap the root and any high-risk subtrees. `fallback` receives
// the caught error + a `retry` function that clears the error and re-renders.

import { Component, ErrorInfo, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { palette } from '@/lib/theme';

interface Props {
  children: ReactNode;
  fallback?: (err: Error, retry: () => void) => ReactNode;
  onError?: (err: Error, info: ErrorInfo) => void;
}

interface State {
  err: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[ErrorBoundary]', err, info.componentStack);
    }
    this.props.onError?.(err, info);
  }

  retry = () => this.setState({ err: null });

  render() {
    if (this.state.err) {
      if (this.props.fallback) return this.props.fallback(this.state.err, this.retry);
      return <DefaultFallback err={this.state.err} onRetry={this.retry} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ err, onRetry }: { err: Error; onRetry: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        backgroundColor: palette.cream50,
      }}>
      <Text
        style={{
          fontSize: 20,
          fontWeight: '700',
          color: palette.ink900,
          marginBottom: 8,
          textAlign: 'center',
        }}>
        Something went sideways
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: palette.ink900,
          opacity: 0.7,
          textAlign: 'center',
          marginBottom: 24,
        }}>
        {err.message || 'An unexpected error occurred.'}
      </Text>
      <Pressable
        onPress={onRetry}
        style={{
          backgroundColor: palette.sage500,
          paddingVertical: 12,
          paddingHorizontal: 24,
          borderRadius: 10,
        }}>
        <Text style={{ color: 'white', fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </View>
  );
}
