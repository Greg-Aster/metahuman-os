module.exports = {
  preset: 'react-native',
  modulePathIgnorePatterns: [
    '<rootDir>/android/app/build/',
    '<rootDir>/android/build/',
    '<rootDir>/android/app/src/main/assets/',
    '<rootDir>/nodejs-assets/',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|\\.pnpm)/)',
  ],
  transform: {
    '^.+\\.(js|ts|tsx)$': [
      'babel-jest',
      {configFile: require.resolve('./babel.config.js')},
    ],
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp)$': require.resolve(
      'react-native/jest/assetFileTransformer.js',
    ),
  },
};
