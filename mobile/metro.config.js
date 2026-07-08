const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * Custom resolver: redirect `firebase/auth` to the React Native bundle
 * so that `getReactNativePersistence` and Hermes-compatible classes are used.
 */
const config = {
  resolver: {
    resolverMainFields: ['react-native', 'browser', 'main'],
    extraNodeModules: {
      // Redirect firebase/auth to the RN-specific entry point
      // so getReactNativePersistence is available and classes work under Hermes
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
