"""
Suy luận production từ deploy bundle, trên một hoặc nhiều tập ECG bất kỳ.

  # Theo tên tập (đọc dataset/ECG_x/ECG_{split}.npy):
  python predict.py --bundle checkpoints/ECG_wsize100_deploy.pt --data_path dataset --sets A C --split test
  python predict.py --bundle checkpoints/ECG_wsize100_deploy.pt --data_path dataset            # cả A..F

  # Hoặc file .npy bất kỳ, shape (T, C), tín hiệu RAW (chưa scale):
  python predict.py --bundle checkpoints/ECG_wsize100_deploy.pt --input a.npy b.npy

Với mỗi đầu vào lưu <out_dir>/<tên>_scores.npy và <tên>_flags.npy. Nếu có file label cạnh bên
(ECG_test.npy -> ECG_test_label.npy) thì in thêm các metric (cùng thư viện tsadmetrics như solver.py):
  - Theo score liên tục : AUC-ROC, AUC-PR, VUS-ROC, VUS-PR
  - Tại ngưỡng deploy   : Precision / Recall / F1 (point-wise), F1-PA (point-adjust), Aff-P / Aff-R / Aff-F1 (affiliation)
Bundle đã chứa scaler, win_size và ngưỡng nên không cần truyền thêm.
"""
import argparse
import os
import sys

import numpy as np
from sklearn.metrics import precision_score, recall_score
from tsadmetrics.metrics.spm import PointwiseAucRoc, PointwiseAucPr
from tsadmetrics.metrics.tem.tpdm import PointadjustedFScore
from tsadmetrics.metrics.tem.tstm import VusRoc, VusPr, AffiliationbasedFScore

from data_factory.data_loader import ECG_SETS
from utils.deploy import load_bundle
from utils.metric_support import _pr_f1_from_fbeta

NAN = float("nan")


def _collect_inputs(args):
    """Trả về danh sách (tên, đường dẫn .npy)."""
    if args.input:
        items = []
        for path in args.input:
            parent = os.path.basename(os.path.dirname(os.path.abspath(path)))
            stem = os.path.splitext(os.path.basename(path))[0]
            items.append((f"{parent}_{stem}", path))
        return items
    sets = [s.upper().replace("ECG_", "") for s in (args.sets or ECG_SETS)]
    bad = [s for s in sets if s not in ECG_SETS]
    if bad:
        raise SystemExit(f"Tập không hợp lệ: {bad}. Hợp lệ: {ECG_SETS}")
    return [(f"ECG_{s}_{args.split}", os.path.join(args.data_path, f"ECG_{s}", f"ECG_{args.split}.npy"))
            for s in sets]


def _load_label(path, n):
    """Label nằm cạnh file tín hiệu: X.npy -> X_label.npy. Trả None nếu không có hoặc lệch độ dài."""
    label_path = os.path.splitext(path)[0] + "_label.npy"
    if not os.path.isfile(label_path):
        return None
    y = np.load(label_path).reshape(-1).astype(int)
    if len(y) != n:
        print(f"[WARN] {label_path}: {len(y)} label nhưng tín hiệu có {n} steps, bỏ qua đánh giá")
        return None
    return y


def _safe(fn, *a, **kw):
    """Chạy một metric; lỗi (vd. nhãn chỉ có 1 lớp) -> NaN thay vì làm hỏng cả batch."""
    try:
        return fn(*a, **kw)
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] metric lỗi: {type(e).__name__}: {e}")
        return NAN


def _evaluate(y, scores, flags, vus_window, skip_vus=False):
    """Tính toàn bộ metric giống solver.test(), nhưng tại ngưỡng deploy thay vì best-ratio."""
    y = np.asarray(y).astype(int)
    flags = np.asarray(flags).astype(int)
    scores = np.asarray(scores, dtype=float)
    has_both = 0 < y.sum() < len(y)

    m = {}
    # --- Point-wise tại ngưỡng deploy ---
    m["p"] = precision_score(y, flags, zero_division=0)
    m["r"] = recall_score(y, flags, zero_division=0)
    m["f1"] = 2 * m["p"] * m["r"] / (m["p"] + m["r"]) if m["p"] + m["r"] > 0 else 0.0

    # --- F1 với point-adjust tại ngưỡng deploy (cùng PointadjustedFScore như solver.py) ---
    m["f1_pa"] = _safe(PointadjustedFScore(beta=1.0).compute, y, flags)

    # --- Affiliation tại ngưỡng deploy ---
    m["aff_p"], m["aff_r"], m["aff_f1"] = _safe(_pr_f1_from_fbeta, AffiliationbasedFScore, y, flags) \
        if has_both else (NAN, NAN, NAN)

    # --- AUC & VUS trên score liên tục ---
    m["auc_roc"] = _safe(PointwiseAucRoc().compute, y, scores) if has_both else NAN
    m["auc_pr"] = _safe(PointwiseAucPr().compute, y, scores) if has_both else NAN
    if skip_vus or not has_both:
        m["vus_roc"] = m["vus_pr"] = NAN
    else:
        m["vus_roc"] = _safe(VusRoc(window=vus_window).compute, y, scores)
        m["vus_pr"] = _safe(VusPr(window=vus_window).compute, y, scores)
    return m


def _diagnose(y, scores, deploy_thr):
    """Chẩn đoán lỗi ngưỡng vs lỗi score: quét ngưỡng oracle (như solver: top 0.1%..50% score) và xem phân bố score."""
    y = np.asarray(y).astype(int)
    scores = np.asarray(scores, dtype=float)
    d = {"anom": y.mean() * 100, "deploy_thr": deploy_thr,
         "p50": np.percentile(scores, 50), "p90": np.percentile(scores, 90),
         "p99": np.percentile(scores, 99), "max": scores.max(),
         "thr_pct": (scores <= deploy_thr).mean() * 100,   # ngưỡng deploy nằm ở percentile nào của score tập này
         "best_f1": NAN, "best_thr": NAN, "best_ratio": NAN}
    if y.sum() == 0:
        return d
    pos = y == 1
    best = -1.0
    for ratio in np.arange(0.1, 50.1, 0.5):
        thr = np.percentile(scores, 100 - ratio)
        pred = scores > thr
        tp = np.sum(pred & pos)
        f1 = 2 * tp / (pred.sum() + pos.sum()) if (pred.sum() + pos.sum()) > 0 else 0.0
        if f1 > best:
            best, d["best_f1"], d["best_thr"], d["best_ratio"] = f1, f1, thr, ratio
    return d


def _f1_at(y, scores, thr):
    pred = scores > thr
    denom = pred.sum() + y.sum()
    return 2 * np.sum(pred & (y == 1)) / denom if denom > 0 else 0.0


def _global_sweep(evals, deploy_thr):
    """
    Quét MỘT ngưỡng chung cho tất cả các tập (đúng ràng buộc deploy: 1 ngưỡng cố định).
    Chọn ngưỡng tối đa hóa F1 trung bình; dùng nhãn test nên CHỈ để chẩn đoán, không dùng làm kết quả báo cáo.
    """
    pooled = np.concatenate([sc for _, _, sc in evals])
    cands = np.unique(np.concatenate([np.percentile(pooled, np.arange(50, 99.96, 0.25)), [deploy_thr]]))
    best_thr, best_mean = None, -1.0
    for t in cands:
        mean_f1 = np.mean([_f1_at(y, sc, t) for _, y, sc in evals])
        if mean_f1 > best_mean:
            best_thr, best_mean = t, mean_f1

    names = [n.replace("ECG_", "").replace("_test", "") for n, _, _ in evals]
    print("\n--- QUÉT NGƯỠNG CHUNG (1 ngưỡng cho mọi tập; chỉ để chẩn đoán) ---")
    print(f"{'ngưỡng':<22}{'giá trị':>10}{'pooled-pct':>11}" + "".join(f"{n:>8}" for n in names) + f"{'MEAN':>8}")
    rows = [("deploy (bundle)", deploy_thr),
            ("best chung", best_thr)]
    for label, t in rows:
        f1s = [_f1_at(y, sc, t) for _, y, sc in evals]
        pct = (pooled <= t).mean() * 100
        print(f"{label:<22}{t:>10.4f}{pct:>11.2f}" + "".join(f"{v:>8.4f}" for v in f1s) + f"{np.mean(f1s):>8.4f}")
    f1s = [_f1_at(y, sc, -np.inf) for _, y, sc in evals]
    print(f"{'flag-hết (baseline)':<22}{'-':>10}{'-':>11}" + "".join(f"{v:>8.4f}" for v in f1s) + f"{np.mean(f1s):>8.4f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bundle', default='checkpoints/ECG_wsize100_deploy_p92.5.pt',
                    help='deploy bundle (mặc định: bundle calibrate ở p92.5)')
    ap.add_argument('--input', nargs='+', default=None, help='một hoặc nhiều file .npy (T, C), tín hiệu raw')
    ap.add_argument('--data_path', default='dataset', help='thư mục chứa ECG_A..ECG_F (khi dùng --sets)')
    ap.add_argument('--sets', nargs='+', default=None, help='ví dụ: A C F (mặc định: cả 6 tập)')
    ap.add_argument('--split', choices=['train', 'test'], default='test')
    ap.add_argument('--out_dir', default='predictions')
    ap.add_argument('--stride', type=int, default=None, help='mặc định = stride lưu trong bundle lúc calibrate (bundle cũ: win_size)')
    ap.add_argument('--device', default='cpu')
    ap.add_argument('--nan_policy', choices=['raise', 'interpolate'], default='raise')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--vus_window', type=int, default=100, help='cửa sổ VUS (mặc định 100, khớp solver.py)')
    ap.add_argument('--threshold', type=float, default=None,
                    help='ghi đè ngưỡng của bundle (chỉ để thử nghiệm). Chọn ngưỡng theo kết quả test = tinh chỉnh trên test, '
                         'cần nêu rõ khi báo cáo; ngưỡng chính thức nên calibrate lại trong bundle')
    ap.add_argument('--skip_vus', action='store_true', help='bỏ qua VUS-ROC/PR nếu muốn chạy nhanh')
    args = ap.parse_args()

    if not os.path.isfile(args.bundle):
        raise SystemExit(f"Không thấy bundle {args.bundle}. Tạo bundle p92.5 từ bundle hiện có:{chr(10)}"
                         f"  py recalibrate.py --bundle <bundle gốc> --data_path dataset --val_frac 0.2 "
                         f"--percentile 92.5 --out {args.bundle}")
    det = load_bundle(args.bundle, device=args.device)
    if args.threshold is not None:
        print(f"[NOTE] Ghi đè ngưỡng: bundle={det.threshold} -> {args.threshold}")
        det.threshold = args.threshold
    if det.threshold is None:
        raise SystemExit("Bundle chưa có ngưỡng; hãy train lại để bundle được calibrate")
    os.makedirs(args.out_dir, exist_ok=True)
    cal = det.calibration or {}
    if cal:
        print("calibration:", ", ".join(f"{k}={v:.6g}" if isinstance(v, float) else f"{k}={v}" for k, v in cal.items()))
    eff_stride = args.stride or cal.get("stride") or det.win_size
    print(f"win_size={det.win_size} channels={det.n_features} threshold={det.threshold:.6f} "
          f"stride={int(eff_stride)} vus_window={args.vus_window}")
    if cal.get("stride") and args.stride and int(args.stride) != int(cal["stride"]):
        print(f"[WARN] --stride={args.stride} khác stride lúc calibrate ({cal['stride']}); ngưỡng có thể không còn phù hợp")
    if not cal.get("stride") and args.stride and int(args.stride) != det.win_size:
        print(f"[WARN] bundle calibrate ở stride={det.win_size} nhưng đang chạy --stride={args.stride}; "
              f"hãy calibrate lại ở stride này (compare_percentiles.py / recalibrate.py --stride)")

    cols = ['AUC-ROC', 'AUC-PR', 'VUS-ROC', 'VUS-PR', 'P', 'R', 'F1', 'F1-PA', 'Aff-P', 'Aff-R', 'Aff-F1']
    header = f"{'input':<22}{'steps':>8}{'flagged%':>10}" + "".join(f"{c:>9}" for c in cols)
    print(header)
    failed = 0
    rows = []
    diags = []
    evals = []
    for name, path in _collect_inputs(args):
        try:
            if not os.path.isfile(path):
                raise FileNotFoundError(path)
            x = np.load(path)
            scores, flags = det.detect(x, stride=args.stride, seed=args.seed, nan_policy=args.nan_policy)
        except (ValueError, FileNotFoundError) as e:      # một tập lỗi không làm hỏng cả batch
            failed += 1
            print(f"{name:<22} LỖI: {e}")
            continue

        np.save(os.path.join(args.out_dir, f"{name}_scores.npy"), scores)
        np.save(os.path.join(args.out_dir, f"{name}_flags.npy"), flags)
        line = f"{name:<22}{len(scores):>8}{flags.mean() * 100:>10.2f}"
        y = _load_label(path, len(scores))
        if y is not None:
            m = _evaluate(y, scores, flags.astype(int), args.vus_window, args.skip_vus)
            vals = [m['auc_roc'], m['auc_pr'], m['vus_roc'], m['vus_pr'],
                    m['p'], m['r'], m['f1'], m['f1_pa'], m['aff_p'], m['aff_r'], m['aff_f1']]
            line += "".join(f"{v:>9.4f}" for v in vals)
            rows.append(vals)
            evals.append((name, y, np.asarray(scores, dtype=float)))
            diags.append((name, _diagnose(y, scores, det.threshold), m['f1']))
        print(line)

    if len(rows) > 1:  # trung bình qua các tập có label
        avg = np.nanmean(np.array(rows, dtype=float), axis=0)
        print(f"{'MEAN':<22}{'':>8}{'':>10}" + "".join(f"{v:>9.4f}" for v in avg))

    if diags:
        print("\n--- CHẨN ĐOÁN NGƯỠNG (oracle = quét ngưỡng trên chính tập này, chỉ để tham khảo) ---")
        h = (f"{'input':<22}{'anom%':>8}{'F1@deploy':>11}{'bestF1':>8}{'ratio%':>8}{'bestThr':>10}"
             f"{'deployThr':>11}{'thr@pct':>9}{'p50':>9}{'p90':>9}{'p99':>9}{'max':>9}")
        print(h)
        for name, d, f1_dep in diags:
            print(f"{name:<22}{d['anom']:>8.2f}{f1_dep:>11.4f}{d['best_f1']:>8.4f}{d['best_ratio']:>8.1f}"
                  f"{d['best_thr']:>10.4f}{d['deploy_thr']:>11.4f}{d['thr_pct']:>9.2f}"
                  f"{d['p50']:>9.4f}{d['p90']:>9.4f}{d['p99']:>9.4f}{d['max']:>9.4f}")
        print("Đọc: bestF1 >> F1@deploy => lỗi NGƯỠNG (calibrate lại); bestF1 vẫn thấp => lỗi SCORE/mô hình/dữ liệu.")
        print("     thr@pct = % bước có score <= deployThr; nếu ~99.9 mà anom% cao => ngưỡng quá khắt.")

    if len(evals) > 1:
        _global_sweep(evals, det.threshold)

    print(f"Đã lưu kết quả vào {args.out_dir}/" + (f" ({failed} đầu vào lỗi)" if failed else ""))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()