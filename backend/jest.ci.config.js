module.exports = {
  rootDir: ".",
  moduleFileExtensions: ["js", "json", "ts"],
  modulePaths: ["<rootDir>"],
  transform: { "^.+\\.(t|j)s$": "ts-jest" },
  testEnvironment: "node",
  reporters: [
    "default",
    [
      "<rootDir>/test/reporters/log-reporter.js",
      { outputDir: "logs", baseDir: "test" },
    ],
  ],
};
