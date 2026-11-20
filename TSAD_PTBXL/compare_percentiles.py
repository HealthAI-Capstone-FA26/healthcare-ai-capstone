"""
So sánh nhiều percentile calibrate trong MỘT lần chạy.

Điểm của model không phụ thuộc ngưỡng, nên script chấm điểm validation (dữ liệu bình thường giữ lại) và các tập test
đúng một lần, rồi với mỗi percentile: ngưỡng = percentile của điểm validation -> flags -> P/R/F1/F1-PA/Aff-F1.
Mỗi percentile ứng với MỘT ngưỡng cố định duy nhất cho mọi tập (đúng ràng buộc deploy).

  py compare_percentiles.py --bundle checkpoints/ECG_wsize100_deploy.pt --data_path dataset --val_frac 0.2 \
      --percentiles 90 92.5 95 99.5

  # thêm --save_dir để lưu luôn bundle cho từng percentile:
  py compare_percentiles.py ... --save_dir checkpoints
"""
import argparse
import os

import numpy as np
import torch

from predict import _collect_inputs, _load_label, _evaluate
from recalibrate import _load_val_segments
from utils.deploy import load_bundle, save_bundle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', required=True)
    ap.add_argument('--percentiles', type=float, nargs='+', default=[90, 92.5, 95, 99.5])
    ap.add_argument('--val', nargs='+', default=None, help='file .npy dữ liệu bình thường (T, C), raw')
    ap.add_argument('--data_path', default='dataset')
    ap.add_argument('--sets', nargs='+', default=None)
    ap.add_argument('--split', choices=['train', 'test'], default='test')
    ap.add_argument('--val_frac', type=float, default=0.2, help='đuôi ECG_train.npy dùng làm validation (khi không có --val)')
    ap.add_argument('--stride', type=int, default=None)
    ap.add_argument('--device', default='cpu')
    ap.add_argument('--nan_policy', choices=['raise', 'interpolate'], default='raise')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--save_dir', default=None, help='nếu có: lưu bundle <tên>_p<percentile>.pt cho từng percentile')
    ap.add_argument('--input', default=None, help=argparse.SUPPRESS)   # để dùng chung _collect_inputs
    args = ap.parse_args()
    if any(not 0 < p < 100 for p in args.percentiles):
        raise SystemExit("Mỗi percentile phải nằm trong (0, 100)")

    det = load_bundle(args.bundle, device=args.device)

    # ---- 1. Chấm điểm validation một lần ----
    segs, src = _load_val_segments(args)
    segs = [s for s in segs if len(s) >= det.win_size]
    val_scores = np.concatenate([det.score(s, stride=args.stride, seed=args.seed) for s in segs])
    thrs = {p: float(np.percentile(val_scores, p)) for p in args.percentiles}
    print(f"Validation: {src}; n_points={len(val_scores)} "
          f"(bundle gốc: n_points={det.calibration.get('n_points')}, percentile={det.calibration.get('percentile')})")

    # ---- 2. Chấm điểm các tập test một lần ----
    data = []
    for name, path in _collect_inputs(args):
        try:
            if not os.path.isfile(path):
                raise FileNotFoundError(path)
            sc = det.score(np.load(path), stride=args.stride, seed=args.seed, nan_policy=args.nan_policy)
        except (ValueError, FileNotFoundError) as e:
            print(f"{name:<14} LỖI: {e}")
            continue
        y = _load_label(path, len(sc))
        if y is not None:
            data.append((name.replace("ECG_", "").replace(f"_{args.split}", ""), y, np.asarray(sc, dtype=float)))
    if not data:
        raise SystemExit("Không có tập nào có label để đánh giá")

    # ---- 3. Mỗi percentile = một ngưỡng chung ----
    names = [n for n, _, _ in data]
    res = {}
    for p, thr in thrs.items():
        res[p] = [_evaluate(y, sc, (sc > thr).astype(int), 100, skip_vus=True) for _, y, sc in data]

    def mean(p, key):
        return float(np.nanmean([m[key] for m in res[p]]))

    print("\n--- TỔNG HỢP (trung bình qua các tập; mỗi hàng là MỘT ngưỡng cố định cho mọi tập) ---")
    print(f"{'pct':>6}{'ngưỡng':>10}{'flag%':>8}{'P':>8}{'R':>8}{'F1':>8}{'F1-PA':>8}{'Aff-P':>8}{'Aff-R':>8}{'Aff-F1':>8}")
    for p, thr in thrs.items():
        flag = np.mean([(sc > thr).mean() * 100 for _, _, sc in data])
        print(f"{p:>6g}{thr:>10.4f}{flag:>8.2f}" + "".join(
            f"{mean(p, k):>8.4f}" for k in ('p', 'r', 'f1', 'f1_pa', 'aff_p', 'aff_r', 'aff_f1')))

    for title, key in (("F1 (point-wise)", 'f1'), ("Aff-F1", 'aff_f1'), ("F1-PA", 'f1_pa')):
        print(f"\n--- {title} theo từng tập ---")
        print(f"{'pct':>6}{'ngưỡng':>10}" + "".join(f"{n:>8}" for n in names) + f"{'MEAN':>8}")
        for p, thr in thrs.items():
            vals = [m[key] for m in res[p]]
            print(f"{p:>6g}{thr:>10.4f}" + "".join(f"{v:>8.4f}" for v in vals) + f"{np.nanmean(vals):>8.4f}")
    print("\nLưu ý: chọn percentile theo bảng này là chọn trên test; hãy nêu rõ khi báo cáo, hoặc trình bày cả 4 mức như "
          "phân tích độ nhạy. F1-PA bị thổi phồng khi dự đoán thưa, nên ưu tiên F1 và Aff-F1 để so sánh.")

    # ---- 4. (tuỳ chọn) lưu bundle cho từng percentile ----
    if args.save_dir:
        raw = torch.load(args.bundle, map_location="cpu", weights_only=True)
        base = os.path.splitext(os.path.basename(args.bundle))[0]
        for p in args.percentiles:
            det.calibrate(segs, p, stride=args.stride, seed=args.seed)
            info = dict(raw.get("data_info", {}))
            info["recalibrated"] = f"percentile={p:g}; val={src}"
            out = save_bundle(os.path.join(args.save_dir, f"{base}_p{p:g}.pt"), det, raw["model_config"], info)
            print(f"Đã lưu bundle: {out}")


if __name__ == '__main__':
    main()
