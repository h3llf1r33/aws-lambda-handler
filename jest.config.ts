/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type {Config} from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
      '^.+\\.tsx?$': 'ts-jest',
  },
  testRegex: '/src/tests/.*\\.test\\.ts$',
  clearMocks: true,
  collectCoverage: true,
  coverageDirectory: "coverage",
};

export default config;
