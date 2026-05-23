module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  // `tsc` を並走させる開発で stale な .js が残ると、Jest 既定の解決順 (`js` が先) では
  // 古い .js を拾ってソース変更が反映されない事故が起きる。
  // `.ts` を最優先にして、ts-jest が常に最新ソースを変換する形に揃える。
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'json', 'node'],
  setupFilesAfterEnv: ['aws-cdk-lib/testhelpers/jest-autoclean'],
};
