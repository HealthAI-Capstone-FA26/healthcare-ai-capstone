import { randomInt } from 'crypto';

/**
 * Chọn ứng viên có `load` NHỎ NHẤT; nếu nhiều người bằng nhau thì chọn NGẪU NHIÊN ĐỀU trong nhóm đó.
 *
 * Vì sao phải random thay vì lấy người đầu tiên (như TriageQueueService.assignNurse đang làm):
 * lấy "người đầu" khi hoà tải sẽ luôn dồn ca vào cùng 1 người mỗi lần cả khoa đang rỗng (đầu ngày,
 * hoặc sau khi mọi người vừa xong ca) -> người đứng đầu danh sách luôn nhiều hơn 1 ca so với
 * những người còn lại. Random đều loại bỏ thiên lệch đó.
 *
 * `randomIndex` cho phép test tiêm nguồn ngẫu nhiên có kiểm soát; mặc định dùng crypto.randomInt
 * (đều, không thiên lệch modulo như `Math.floor(Math.random() * n)` ở mức lý thuyết).
 */
export function pickLeastLoaded<T extends { load: number }>(
  candidates: readonly T[],
  randomIndex: (upperExclusive: number) => number = (n) => randomInt(n),
): { chosen: T; tiedCount: number } | null {
  if (candidates.length === 0) return null;

  let minLoad = Infinity;
  for (const c of candidates) if (c.load < minLoad) minLoad = c.load;

  const tied = candidates.filter((c) => c.load === minLoad);
  const chosen = tied.length === 1 ? tied[0] : tied[randomIndex(tied.length)];
  return { chosen, tiedCount: tied.length };
}
