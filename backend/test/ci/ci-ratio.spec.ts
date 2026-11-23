// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkRatio } = require('../../scripts/check-ci-ratio');

// Cho phép lệch ±5 test giữa (CI × 2) và tổng unit test.
const TOLERANCE = 5;

describe('CI unit-test ratio (Commitment)', () => {
  it('CI chạy xấp xỉ 1/2 tổng số unit test (lệch tối đa ±5) và mọi file trong manifest đều tồn tại', () => {
    const r = checkRatio();
    expect(r.missing).toEqual([]);
    expect(Math.abs(r.ci * 2 - r.total)).toBeLessThanOrEqual(TOLERANCE);
  });
});