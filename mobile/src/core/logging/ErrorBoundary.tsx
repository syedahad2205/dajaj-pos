/**
 * Top-level React error boundary (design §13a, Requirement 17.1).
 * Renders a generic "Something went wrong" screen with a restart affordance.
 * Writes caught errors to both the local error log and the centralized logger.
 */
import React, { type ReactNode, Component } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { logError } from '@/core/logging/errorLogStore';
import { logger } from '@/core/logging/logger';

interface Props { children: ReactNode; }
interface State { hasError: boolean; message: string; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = (error instanceof Error ? error.stack : undefined) ?? info.componentStack;

    // Write to dedicated error log (backwards compat + error-only store)
    logError({ screen: 'ErrorBoundary', operation: null, message, stack });

    // Also write to centralized logger for unified log viewer visibility
    logger.exception('ErrorBoundary', null, error, {
      componentStack: info.componentStack,
    });
  }

  handleRestart() {
    this.setState({ hasError: false, message: '' });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.message}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => this.handleRestart()}>
            <Text style={styles.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  message: { color: '#555', textAlign: 'center', marginBottom: 24 },
  btn: { backgroundColor: '#1a73e8', borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
