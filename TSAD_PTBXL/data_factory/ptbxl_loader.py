"""
PTB-XL: train THẲNG (không pretrain/finetune) theo hướng phát hiện bất thường không giám sát.

  * Mỗi bản ghi = 12 kênh (I, II, III, AVR, AVL, AVF, V1..V6), 10 giây: 1000 mẫu @100Hz hoặc 5000 mẫu @500Hz.
  * TRAIN : chỉ các bản ghi "bình thường thuần" (siêu lớp chỉ gồm NORM) ở strat_fold 1..8.
  * VAL   : bản ghi NORM thuần ở fold 9  -> early stopping + calibrate ngưỡng.
  * TEST  : fold 10, gồm NORM (nhãn 0) và các bản ghi có siêu lớp MI / STTC / CD / HYP (nhãn 1).
            Nhãn là NHÃN CẢ BẢN GHI, không có nhãn theo từng điểm -> đánh giá theo bản ghi (xem eval_ptbxl.py).
  * Split theo fold chính thức của PTB-XL: mọi bản ghi của một bệnh nhân nằm cùng một fold, nên không rò rỉ bệnh nhân.
  * Mỗi bản ghi là một chuỗi riêng: window không bao giờ băng qua ranh giới giữa hai bản ghi.

Cấu trúc thư mục (theo PhysioNet; thư mục chứa ptbxl_database.csv được tự tìm trong --data_path):
    ptbxl_database.csv, scp_statements.csv, records100/..., records500/...
Cần `pip install wfdb`. Lần đầu đọc toàn bộ bản ghi hơi lâu; kết quả được cache thành .npz cạnh CSV.
"""
import ast
import os

import numpy as np
from sklearn.preprocessing import RobustScaler

from data_factory.data_loader import _window_starts

SUPERCLASSES = ("NORM", "MI", "STTC", "CD", "HYP")


def find_root(data_path):
    for d, _, files in os.walk(data_path):
        if "ptbxl_database.csv" in files:
            return d
        if d[len(data_path):].count(os.sep) >= 3:      # không đào sâu quá 3 cấp
            continue
    raise FileNotFoundError(f"Không thấy ptbxl_database.csv trong {data_path}")


def _superclasses(df, root):
    import pandas as pd
    st = pd.read_csv(os.path.join(root, "scp_statements.csv"), index_col=0)
    st = st[st["diagnostic"] == 1]
    cls = st["diagnostic_class"].to_dict()
    out = []
    for codes in df["scp_codes"]:
        d = ast.literal_eval(codes) if isinstance(codes, str) else dict(codes)
        out.append(frozenset(cls[c] for c in d if c in cls))      # mọi mã có trong bản ghi, như cách dùng chuẩn
    return out


def load_ptbxl(data_path, sampling_rate=100):
    """
    Trả về dict: X (N, T, 12) float32 RAW, fold (N,), ecg_id (N,), classes (list N frozenset siêu lớp).
    Bản ghi không có mã chẩn đoán nào (chỉ form/rhythm) có classes rỗng và bị loại khỏi train/val/test.
    """
    import pandas as pd
    if sampling_rate not in (100, 500):
        raise ValueError("sampling_rate phải là 100 hoặc 500")
    root = find_root(data_path)
    cache = os.path.join(root, f"ptbxl_cache_{sampling_rate}.npz")
    df = pd.read_csv(os.path.join(root, "ptbxl_database.csv"), index_col="ecg_id")
    classes = _superclasses(df, root)

    if os.path.isfile(cache):
        z = np.load(cache)
        if np.array_equal(z["ecg_id"], df.index.values):
            return dict(X=z["X"], fold=df["strat_fold"].values, ecg_id=df.index.values, classes=classes)
    try:
        import wfdb
    except ImportError as e:
        raise ImportError("Đọc PTB-XL cần `pip install wfdb`") from e

    col = "filename_lr" if sampling_rate == 100 else "filename_hr"
    sigs = []
    for i, f in enumerate(df[col].values):
        sig, _ = wfdb.rdsamp(os.path.join(root, f))
        sigs.append(sig.astype(np.float32))
        if (i + 1) % 2000 == 0:
            print(f"  đã đọc {i + 1}/{len(df)} bản ghi")
    X = np.stack(sigs)
    if not np.isfinite(X).all():
        raise ValueError("PTB-XL chứa NaN/Inf; hãy kiểm tra dữ liệu")
    try:
        np.savez(cache, X=X, ecg_id=df.index.values)
    except OSError:
        print("[WARN] không ghi được cache (thư mục chỉ đọc?); lần sau sẽ đọc lại từ đầu")
    return dict(X=X, fold=df["strat_fold"].values, ecg_id=df.index.values, classes=classes)


def record_label(classes):
    """0 = NORM thuần, 1 = có ít nhất một siêu lớp bệnh, None = không có chẩn đoán dùng được."""
    if not classes:
        return None
    return 0 if classes == frozenset({"NORM"}) else 1


class PTBXLSegLoader(object):
    def __init__(self, data_path, win_size, step, mode="train", sampling_rate=100, load_test=False,
                 train_folds=range(1, 9), val_fold=9, test_fold=10):
        if mode not in ("train", "val"):
            raise ValueError(f"mode phải là 'train' hoặc 'val', nhận '{mode}'")
        self.mode, self.win_size, self.step = mode, win_size, step
        d = load_ptbxl(data_path, sampling_rate)
        X, fold, labels = d["X"], d["fold"], [record_label(c) for c in d["classes"]]
        if X.shape[1] < win_size:
            raise ValueError(f"Bản ghi chỉ có {X.shape[1]} mẫu < win_size={win_size}")
        normal = np.array([l == 0 for l in labels])

        tr = np.where(normal & np.isin(fold, list(train_folds)))[0]
        va = np.where(normal & (fold == val_fold))[0]
        if len(tr) == 0 or len(va) == 0:
            raise ValueError(f"Không có bản ghi NORM nào cho train ({len(tr)}) hoặc val ({len(va)})")
        T, self.n_features = X.shape[1], X.shape[2]

        self.scaler = RobustScaler().fit(X[tr].reshape(-1, self.n_features))   # chỉ fit trên train
        sc = lambda a: self.scaler.transform(a.reshape(-1, self.n_features)).astype(np.float32)
        self.train, self.val = sc(X[tr]), sc(X[va])
        self.train_lengths, self.val_lengths = [T] * len(tr), [T] * len(va)
        self.raw_val_segments = [X[i].astype(np.float64) for i in va]          # chưa scale, để calibrate
        self.train_starts = _window_starts(self.train_lengths, win_size, step)
        self.val_starts = _window_starts(self.val_lengths, win_size, step)
        self.set_names = ["PTBXL_NORM"]        # một nhóm duy nhất (chỉ NORM)
        self.train_ecg_ids, self.val_ecg_ids = d["ecg_id"][tr], d["ecg_id"][va]

        self.test_sets, self.test_records = [], []    # test_sets rỗng: solver.test không hợp với nhãn cấp bản ghi
        if load_test:
            te = np.where(np.array([l is not None for l in labels]) & (fold == test_fold))[0]
            self.test_records = [dict(ecg_id=int(d["ecg_id"][i]), x=X[i].astype(np.float64), label=labels[i],
                                      classes=sorted(d["classes"][i])) for i in te]
        print(f"PTB-XL @{sampling_rate}Hz | train NORM: {len(tr)} bản ghi, {len(self.train_starts)} window "
              f"| val NORM: {len(va)} bản ghi, {len(self.val_starts)} window"
              + (f" | test: {len(self.test_records)} bản ghi" if load_test else ""))

    def __len__(self):
        return len(self.train_starts) if self.mode == "train" else len(self.val_starts)

    def __getitem__(self, index):
        if self.mode == "train":
            s = self.train_starts[index]
            x = self.train[s:s + self.win_size]
        else:
            s = self.val_starts[index]
            x = self.val[s:s + self.win_size]
        return np.float32(x), np.zeros_like(x, dtype=np.float32)
