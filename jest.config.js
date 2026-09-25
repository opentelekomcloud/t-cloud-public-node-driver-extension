module.exports = {
  rootDir: 'pkg/opentelekomcloud',
  testEnvironment: 'node',
  watchman: false,
  testMatch: ['<rootDir>/__tests__/**/*.spec.js'],
  moduleNameMapper: { '\\.(svg)$': '<rootDir>/__tests__/svgMock.js' },
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', {
      configFile: false,
      babelrc:   false,
      presets:   [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        ['@babel/preset-typescript', { allExtensions: true, isTSX: true }],
      ],
    }],
  },
};
