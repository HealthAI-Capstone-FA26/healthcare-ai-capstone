"""
Calibrate lại ngưỡng của một deploy bundle có sẵn, KHÔNG train lại, KHÔNG dùng label và KHÔNG dùng dữ liệu inference.

Ngưỡng = percentile của điểm trên dữ liệu BÌNH THƯỜNG được giữ lại (validation) -> vẫn là một ngưỡng cố định
nằm trong bundle, đúng ràng buộc deploy. Bundle gốc không bị ghi đè; bundle mới được lưu ra --out.

  # (1) Chỉ rõ file validation bình thường (tín hiệu RAW, shape (T, C)) - cách an toàn nhất:
  python recalibrate.py --bundle checkpoints/ECG_wsize100_deploy.pt --val val_A.npy val_B.npy --percentile 90

  # (2) Lấy phần đuôi của ECG_train.npy mỗi tập làm validation (PHẢI khớp phần đã giữ lại lúc train):
  python recalibrate.py --bundle checkpoints/ECG_wsize100_deploy.pt --data_path dataset --val_frac 0.2 --percentile 90

Sau đó:
  python predict.py --bundle checkpoints/ECG_wsize100_deploy_p90.pt --data_path dataset
"""
import argparse
import os

import numpy as np
import torch

from data_factory.data_loader import ECG_SETS
from utils.deploy import load_bundle, save_bundle

REF_PCTS = (85, 90, 92.5, 95, 97, 99, 99.5)


def _load_val_segments(args):
    """Trả về (danh sách đoạn validation, mô tả nguồn)."""
    if args.val:
        segs = [np.load(p) for p in args.val]
        return segs, f"{len(segs)} file --val"
    sets = [s.upper().replace("ECG_", "") for s in (args.sets or ECG_SETS)]
    bad = [s for s in sets if s not in ECG_SETS]
    if bad:
        raise SystemExit(f"Tập không hợp lệ: {bad}. Hợp lệ: {ECG_SETS}")
    if not 0 < args.val_frac < 1:
        raise SystemExit("--val_frac phải nằm trong (0, 1)")
    segs = []
    for s in sets:
        path = os.path.join(args.data_path, f"ECG_{s}", "ECG_train.npy")
        x = np.load(path)
        segs.append(x[int(len(x) * (1 - args.val_frac)):])
    return segs, f"đuôi {args.val_frac:.0%} của ECG_train.npy các tập {sets}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', required=True)
    ap.add_argument('--out', default=None, help='mặc định: <bundle>_p<percentile>.pt (không ghi đè bundle gốc)')
    ap.add_argument('--percentile', type=float, default=90.0,
                    help='percentile của điểm bình thường dùng làm ngưỡng (mặc định 90 ~ 10%% báo động nhầm)')
    ap.add_argument('--val', nargs='+', default=None, help='file .npy dữ liệu bình thường (T, C), tín hiệu raw')
    ap.add_argument('--data_path', default='dataset')
    ap.add_argument('--sets', nargs='+', default=None)
    ap.add_argument('--val_frac', type=float, default=0.2, help='tỉ lệ đuôi ECG_train.npy dùng làm validation')
    ap.add_argument('--stride', type=int, default=None, help='mặc định = win_size (như lúc calibrate gốc)')
    ap.add_argument('--device', default='cpu')
    ap.add_argument('--seed', type=int, default=0)
    args = ap.parse_args()
    if not 0 < args.percentile < 100:
        raise SystemExit("--percentile phải nằm trong (0, 100)")

    det = load_bundle(args.bundle, device=args.device)
    raw = torch.load(args.bundle, map_location="cpu", weights_only=True)   # lấy model_config + data_info gốc
    old_thr = det.threshold
    old_cal = dict(det.calibration)

    segs, src = _load_val_segments(args)
    segs = [s for s in segs if len(s) >= det.win_size]
    print(f"Validation: {src}; {len(segs)} đoạn đủ dài (win_size={det.win_size})")
    if not args.val:
        print("[CẢNH BÁO] Đang lấy đuôi ECG_train làm validation. Nếu model đã được train trên phần này thì điểm "
              "sẽ thấp hơn thực tế và ngưỡng bị kéo xuống; hãy dùng --val với đúng phần dữ liệu đã giữ lại.")

    cal = det.calibrate(segs, args.percentile, stride=args.stride, seed=args.seed)

    print(f"\nngưỡng cũ  : {old_thr:.6f}  (percentile={old_cal.get('percentile')}, n_points={old_cal.get('n_points')})")
    print(f"ngưỡng mới : {cal['threshold']:.6f}  (percentile={cal['percentile']}, n_points={cal['n_points']})")
    print("percentile tham chiếu của điểm validation (để đối chiếu):")
    scores = np.concatenate([det.score(s, stride=args.stride, seed=args.seed) for s in segs])
    print("  " + "  ".join(f"p{q:g}={np.percentile(scores, q):.4f}" for q in REF_PCTS))

    out = args.out or f"{os.path.splitext(args.bundle)[0]}_p{args.percentile:g}.pt"
    if os.path.abspath(out) == os.path.abspath(args.bundle):
        raise SystemExit("--out trùng bundle gốc; chọn đường dẫn khác để không ghi đè")
    data_info = dict(raw.get("data_info", {}))
    data_info["recalibrated"] = f"percentile={args.percentile:g}; val={src}; old_threshold={old_thr}"
    save_bundle(out, det, raw["model_config"], data_info)
    print(f"\nĐã lưu bundle mới: {out}")


if __name__ == '__main__':
    main()
