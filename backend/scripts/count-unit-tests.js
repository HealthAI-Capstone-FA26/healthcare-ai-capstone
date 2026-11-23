#!/usr/bin/env node
/* eslint-disable */
/**
 * Đếm số unit test (Jest) bằng AST — KHÔNG cần chạy test, KHÔNG cần DB.
 *
 * Quy ước đếm (khớp với số "total" mà Jest báo cáo, trừ todo):
 *   - it(...) / test(...)                        = 1
 *   - it.each(<mảng literal | const cùng file>)  = số phần tử của mảng (mỗi phần tử = 1 test)
 *   - it.skip / it.todo / xit                    = KHÔNG tính (Jest không chạy)
 *
 * Dùng:
 *   node scripts/count-unit-tests.js                       # in bảng đếm từng file + tổng
 *   node scripts/count-unit-tests.js --json                # in JSON { files: {path: n}, total }
 *   node scripts/count-unit-tests.js --files <a> <b> ...   # chỉ đếm các file chỉ định
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'e2e' || name === 'node_modules') continue; // e2e đếm riêng
      walk(full, out);
    } else if (/\.spec\.ts$/.test(name)) out.push(full);
  }
  return out;
}

function countFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);

  // const x = [ ... ]  -> số phần tử (để resolve it.each(x))
  const arrays = new Map();
  (function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let init = node.initializer;
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isArrayLiteralExpression(init)) arrays.set(node.name.text, init.elements.length);
    }
    ts.forEachChild(node, collect);
  })(sf);

  let total = 0;
  const unresolved = [];
  (function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // it(...) / test(...)
      if (ts.isIdentifier(callee) && (callee.text === 'it' || callee.text === 'test')) total += 1;
      // it.each(arr)(name, fn)
      else if (ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression)) {
        const pa = callee.expression;
        if (ts.isIdentifier(pa.expression) && ['it', 'test'].includes(pa.expression.text) && pa.name.text === 'each') {
          let arg = callee.arguments[0];
          while (arg && (ts.isAsExpression(arg) || ts.isParenthesizedExpression(arg))) arg = arg.expression;
          if (arg && ts.isArrayLiteralExpression(arg)) total += arg.elements.length;
          else if (arg && ts.isIdentifier(arg) && arrays.has(arg.text)) total += arrays.get(arg.text);
          else unresolved.push(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  })(sf);

  if (unresolved.length) {
    throw new Error(`${path.relative(ROOT, file)}: it.each không resolve được số phần tử (dòng ${unresolved.join(', ')}). Dùng mảng literal hoặc const cùng file.`);
  }
  return total;
}

function countAll(files) {
  const result = {};
  for (const f of files) result[path.relative(ROOT, f).split(path.sep).join('/')] = countFile(f);
  const total = Object.values(result).reduce((a, b) => a + b, 0);
  return { files: result, total };
}

module.exports = { countAll, countFile, walk, ROOT, TEST_DIR };

if (require.main === module) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const idx = args.indexOf('--files');
  const files = idx >= 0 ? args.slice(idx + 1).map((p) => path.resolve(ROOT, p)) : walk(TEST_DIR).sort();
  const { files: counts, total } = countAll(files);
  if (asJson) console.log(JSON.stringify({ files: counts, total }, null, 2));
  else {
    for (const [f, n] of Object.entries(counts)) console.log(String(n).padStart(4), f);
    console.log('-'.repeat(60));
    console.log(String(total).padStart(4), 'TOTAL unit tests');
  }
}
