"""
Đánh giá mô hình train thẳng trên PTB-XL ở CẤP BẢN GHI.

  python eval_ptbxl.py --bundle checkpoints/ptbxl/PTBXL_wsize100_deploy.pt --data_path E:/Capstone/ecg/ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.1

Nhãn PTB-XL là nhãn cả bản ghi (NORM = 0, có MI/STTC/CD/HYP = 1) nên điểm của từng mẫu được gộp thành một điểm
cho mỗi bản ghi (mean | max | top10 = trung bình 10% điểm cao nhất). Ngưỡng lấy từ bản ghi NORM ở fold 9
(không dùng nhãn test): ngưỡng = percentile --val_percentile của điểm gộp trên fold 9.
AUROC/AUPRC không phụ thuộc ngưỡng; F1 'oracle' chọn ngưỡng tốt nhất trên test nên chỉ là cận trên để tham khảo.
"""
import argparse

import numpy as np
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score

from data_factory.ptbxl_loader import SUPERCLASSES, load_ptbxl, record_label
from utils.deploy import load_bundle

AGGS = {
    "mean": lambda s: float(np.mean(s)),
    "max": lambda s: float(np.max(s)),
    "top10": lambda s: float(np.sort(s)[-max(1, len(s) // 10):].mean()),
}


def _prf(y, pred):
    tp = int(((pred == 1) & (y == 1)).sum())
    p = tp / max(1, int((pred == 1).sum()))
    r = tp / max(1, int((y == 1).sum()))
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--data_path", required=True)
    ap.add_argument("--sampling_rate", type=int, default=100, choices=[100, 500])
    ap.add_argument("--val_fold", type=int, default=9)
    ap.add_argument("--test_fold", type=int, default=10)
    ap.add_argument("--val_percentile", type=float, default=95.0)
    ap.add_argument("--device", default="cuda")
    a = ap.parse_args()

    det = load_bundle(a.bundle, a.device)
    d = load_ptbxl(a.data_path, a.sampling_rate)
    labels = [record_label(c) for c in d["classes"]]
    val_idx = [i for i, (l, f) in enumerate(zip(labels, d["fold"])) if l == 0 and f == a.val_fold]
    test_idx = [i for i, (l, f) in enumerate(zip(labels, d["fold"])) if l is not None and f == a.test_fold]
    if not val_idx or not test_idx:
        raise SystemExit(f"Thiếu bản ghi: val={len(val_idx)}, test={len(test_idx)}")

    print(f"Chấm điểm {len(val_idx)} bản ghi val và {len(test_idx)} bản ghi test ...")
    val_scores = [det.score(d["X"][i]) for i in val_idx]
    test_scores = [det.score(d["X"][i]) for i in test_idx]
    y = np.array([labels[i] for i in test_idx])
    print(f"test: {int((y == 0).sum())} NORM, {int((y == 1).sum())} bất thường")

    for name, agg in AGGS.items():
        v = np.array([agg(s) for s in val_scores])
        t = np.array([agg(s) for s in test_scores])
        thr = float(np.percentile(v, a.val_percentile))
        p, r, f1 = _prf(y, (t > thr).astype(int))
        pr, rc, _ = precision_recall_curve(y, t)
        oracle = float(np.max(2 * pr * rc / np.clip(pr + rc, 1e-12, None)))
        print(f"\n[{name}] AUROC {roc_auc_score(y, t):.4f} | AUPRC {average_precision_score(y, t):.4f} | "
              f"@val p{a.val_percentile:g} (thr {thr:.4g}): P {p:.3f} R {r:.3f} F1 {f1:.3f} | F1 oracle {oracle:.3f}")
        norm = y == 0
        for c in SUPERCLASSES[1:]:
            has = np.array([c in d["classes"][i] for i in test_idx])
            m = norm | has
            if has.sum() >= 2 and norm.sum() >= 2:
                print(f"   NORM vs {c:<5} (n={int(has.sum()):>4}): AUROC {roc_auc_score(has[m].astype(int), t[m]):.4f}")


if __name__ == "__main__":
    main()
