/* Jest cho job "unit" của CI: chỉ chạy các spec trong test/ci/unit-ci-manifest.json (= 1/2 tổng unit test). */
const { files } = require('./test/ci/unit-ci-manifest.json');

module.exports = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  modulePaths: ['<rootDir>'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  testMatch: files.map((f) => `<rootDir>/${f}`),
  reporters: ['default', ['<rootDir>/test/reporters/log-reporter.js', { outputDir: 'logs', baseDir: 'test' }]],
};
