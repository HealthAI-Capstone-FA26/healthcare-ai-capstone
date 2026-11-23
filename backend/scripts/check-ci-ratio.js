#!/usr/bin/env node
/* eslint-disable */
/**
 * Ràng buộc của Commitment: số unit test chạy trong CI = 1/2 tổng số unit test.
 * Đọc test/ci/unit-ci-manifest.json, đếm bằng AST (scripts/count-unit-tests.js), exit 1 nếu lệch.
 */
const fs = require('fs');
const path = require('path');
const { countAll, walk, TEST_DIR, ROOT } = require('./count-unit-tests');

function checkRatio() {
  const manifest = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'ci', 'unit-ci-manifest.json'), 'utf8'));
  const missing = manifest.files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  const all = countAll(walk(TEST_DIR).sort());
  const ci = countAll(manifest.files.filter((f) => !missing.includes(f)).map((f) => path.join(ROOT, f)));
  return { total: all.total, ci: ci.total, missing, ok: missing.length === 0 && all.total % 2 === 0 && ci.total * 2 === all.total };
}

module.exports = { checkRatio };

if (require.main === module) {
  const r = checkRatio();
  console.log(`Unit tests: total=${r.total}, in CI=${r.ci}, expected CI=${r.total / 2}`);
  if (r.missing.length) console.error('File trong manifest không tồn tại:', r.missing.join(', '));
  if (!r.ok) {
    console.error('FAIL: số unit test trong CI phải bằng đúng 1/2 tổng (tổng phải chẵn). Chỉnh test/ci/unit-ci-manifest.json.');
    process.exit(1);
  }
  console.log('OK: CI chạy đúng 1/2 tổng số unit test.');
}
