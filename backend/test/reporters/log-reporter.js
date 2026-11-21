/* eslint-disable */
/**
 * Custom Jest reporter: mỗi lần chạy `npx jest test/<a>` sẽ sinh ra `logs/<a>/...`
 *
 *   test/lab-test/ecg-model.service.spec.ts
 *     -> logs/lab-test/ecg-model.service.spec.log    (log đọc được)
 *     -> logs/lab-test/ecg-model.service.spec.json   (dữ liệu thô)
 *   logs/lab-test/results.csv                        (bảng gộp cả thư mục -> mở bằng Excel để fill báo cáo)
 *
 * Cấu hình qua option của reporter (không bắt buộc):
 *   ["<rootDir>/test/reporters/log-reporter.js", { "outputDir": "logs", "baseDir": "test" }]
 */
const fs = require('fs');
const path = require('path');

const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '');
// bỏ các dòng stack nằm trong node_modules cho log gọn
const clean = (s) => stripAnsi(s).split('\n').filter((l) => !/^\s+at .*node_modules/.test(l) && !/^\s+at .*\(node:/.test(l)).join('\n').trim();
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, '\n')}"`;
const STATUS = { passed: 'PASS', failed: 'FAIL', pending: 'SKIP', skipped: 'SKIP', todo: 'TODO', disabled: 'SKIP' };

class LogReporter {
  constructor(globalConfig, options = {}) {
    this.rootDir = globalConfig.rootDir;
    this.outDir = path.resolve(this.rootDir, options.outputDir || 'logs');
    this.baseDir = path.resolve(this.rootDir, options.baseDir || 'test');
    this.touchedDirs = new Set();
  }

  // thư mục con (tương đối so với test/) -> logs/<thư mục con>
  _relative(testPath) {
    let rel = path.relative(this.baseDir, testPath);
    if (rel.startsWith('..')) rel = path.relative(this.rootDir, testPath);
    return rel;
  }

  onTestResult(_test, result) {
    const rel = this._relative(result.testFilePath);
    const dir = path.join(this.outDir, path.dirname(rel));
    const base = path.basename(rel).replace(/\.(ts|js|tsx|jsx)$/, '');
    fs.mkdirSync(dir, { recursive: true });
    this.touchedDirs.add(dir);

    const cases = result.testResults.map((t, i) => ({
      no: i + 1,
      suite: t.ancestorTitles.join(' > '),
      name: t.title,
      fullName: t.fullName,
      status: STATUS[t.status] || t.status,
      durationMs: t.duration ?? 0,
      error: (t.failureMessages || []).map(clean).join('\n'),
    }));

    // nếu cả file lỗi trước khi chạy test (lỗi compile/import...) thì ghi lại
    const suiteError = result.testExecError
      ? stripAnsi(result.testExecError.stack || result.testExecError.message)
      : result.failureMessage && cases.length === 0
        ? stripAnsi(result.failureMessage)
        : '';

    const data = {
      file: rel.split(path.sep).join('/'),
      ranAt: new Date(result.perfStats.start).toISOString(),
      durationMs: result.perfStats.end - result.perfStats.start,
      total: cases.length,
      passed: cases.filter((c) => c.status === 'PASS').length,
      failed: cases.filter((c) => c.status === 'FAIL').length,
      skipped: cases.filter((c) => c.status === 'SKIP' || c.status === 'TODO').length,
      suiteError,
      cases,
    };

    fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify(data, null, 2), 'utf8');

    const lines = [
      `FILE     : ${data.file}`,
      `RAN AT   : ${data.ranAt}`,
      `RESULT   : ${data.passed} passed, ${data.failed} failed, ${data.skipped} skipped / ${data.total} total (${data.durationMs} ms)`,
      '='.repeat(80),
    ];
    if (suiteError) lines.push('[SUITE ERROR]', suiteError, '='.repeat(80));
    for (const c of cases) {
      lines.push(`#${c.no} [${c.status}] ${c.fullName} (${c.durationMs} ms)`);
      if (c.error) lines.push(c.error.split('\n').map((l) => '    ' + l).join('\n'));
    }
    fs.writeFileSync(path.join(dir, `${base}.log`), lines.join('\n') + '\n', 'utf8');
  }

  onRunComplete() {
    // Gộp mọi *.json trong từng thư mục vừa chạy -> results.csv (luôn đủ, kể cả khi chỉ chạy 1 file)
    for (const dir of this.touchedDirs) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
      const header = ['STT', 'File', 'Suite', 'Test case', 'Kết quả', 'Thời gian (ms)', 'Lỗi / Ghi chú'];
      const rows = [header];
      let n = 0;
      for (const f of files) {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (d.suiteError) rows.push([++n, d.file, '', '(suite error)', 'FAIL', d.durationMs, d.suiteError]);
        for (const c of d.cases) rows.push([++n, d.file, c.suite, c.name, c.status, c.durationMs, c.error]);
      }
      // BOM để Excel hiển thị đúng tiếng Việt
      fs.writeFileSync(
        path.join(dir, 'results.csv'),
        '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n',
        'utf8',
      );
    }
  }
}

module.exports = LogReporter;
