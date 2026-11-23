import os

import numpy as np
from torch.utils.data import DataLoader
from sklearn.preprocessing import RobustScaler

# Các tập ECG được gộp lại theo chiều thời gian, đúng thứ tự này.
# Layout (chỉ đọc .npy, bỏ qua .pkl):
#   data_path/ECG_A/ECG_train.npy, ECG_test.npy, ECG_test_label.npy
#   ...
#   data_path/ECG_F/...
ECG_SETS = ["A", "B", "C", "D", "E", "F"]


def _set_file(data_path, set_name, filename):
    path = os.path.join(data_path, f"ECG_{set_name}", filename)
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"Không tìm thấy {path}. --data_path phải là thư mục chứa ECG_A..ECG_F (ví dụ 'dataset').")
    return path


def _window_starts(lengths, win_size, step):
    """
    Chỉ số bắt đầu của các window trên chuỗi đã nối, sao cho mọi window nằm
    HOÀN TOÀN trong một tập. Window cuối của mỗi tập kết thúc đúng tại điểm
    cuối của tập đó, không lấn sang tập kế tiếp.
    """
    starts, offset = [], 0
    for n in lengths:
        if n >= win_size:
            starts.append(offset + np.arange(0, n - win_size + 1, step))
        offset += n
    if not starts:
        return np.zeros(0, dtype=np.int64)
    return np.concatenate(starts).astype(np.int64)


class ECGSegLoader(object):
    """
    Gộp ECG_A..ECG_F theo thời gian để train; mode chỉ có 'train' hoặc 'val'.

    holdout_val=True  : mỗi tập được chia thành [train | val] theo val_ratio (đuôi của mỗi tập
                        làm validation). Validation KHÔNG nằm trong train và scaler chỉ fit trên
                        phần train -> early stopping và ngưỡng phát hiện không bị rò rỉ.
    holdout_val=False : hành vi cũ, val là đuôi của train (nằm trong train), scaler fit trên toàn bộ train.

    load_test=True    : nạp thêm ECG_test.npy + ECG_test_label.npy của TỪNG tập vào self.test_sets
                        (chưa scale, không nối) để đánh giá theo từng tập.
    """

    def __init__(self, data_path, win_size, step, mode="train", val_ratio=0.2, holdout_val=True,
                 load_test=False):
        if mode not in ("train", "val"):
            raise ValueError(f"mode phải là 'train' hoặc 'val', nhận '{mode}'")
        if not 0.0 < val_ratio < 1.0:
            raise ValueError(f"val_ratio phải trong (0, 1), nhận {val_ratio}")
        self.mode = mode
        self.step = step
        self.win_size = win_size
        self.val_ratio = val_ratio
        self.holdout_val = holdout_val
        self.scaler = RobustScaler()

        # ---------- Đọc 6 tập, tách train/val cho từng tập ----------
        train_raw, val_raw, self.set_names = [], [], []
        for name in ECG_SETS:
            arr = np.load(_set_file(data_path, name, "ECG_train.npy"))
            if arr.ndim != 2:
                raise ValueError(f"ECG_{name}: cần shape (T, C), nhận {arr.shape}")
            if not np.isfinite(arr).all():
                raise ValueError(f"ECG_{name} chứa NaN/Inf; hãy làm sạch dữ liệu trước khi train")
            n = len(arr)
            if n < win_size:
                print(f"[WARN] ECG_{name} chỉ có {n} steps < win_size={win_size}, bỏ qua.")
                continue

            val_start = int(n * (1.0 - val_ratio))
            if holdout_val:
                if val_start < win_size or n - val_start < win_size:
                    print(f"[WARN] ECG_{name} ({n} steps) quá ngắn để tách validation với "
                          f"win_size={win_size}: dùng toàn bộ cho train, không có validation.")
                    train_raw.append(arr)
                    val_raw.append(arr[:0])
                else:
                    train_raw.append(arr[:val_start])
                    val_raw.append(arr[val_start:])
            else:
                train_raw.append(arr)
                val_raw.append(arr[val_start:])
            self.set_names.append(name)

        if not train_raw:
            raise ValueError(f"Không có tập ECG nào đủ dài (win_size={win_size})")
        n_feat = {a.shape[1] for a in train_raw}
        if len(n_feat) != 1:
            raise ValueError(f"Các tập ECG có số kênh khác nhau: {sorted(n_feat)}")
        self.n_features = n_feat.pop()

        # ---------- Một scaler duy nhất, fit trên toàn bộ train đã gộp ----------
        self.scaler.fit(np.concatenate(train_raw, axis=0))
        self.train_lengths = [len(a) for a in train_raw]
        self.train = self.scaler.transform(np.concatenate(train_raw, axis=0))

        self.raw_val_segments = [a for a in val_raw if len(a) >= win_size]  # chưa scale, dùng để calibrate
        val_scaled = [self.scaler.transform(a) for a in val_raw if len(a) > 0]
        self.val_lengths = [len(a) for a in val_scaled]
        self.val = (np.concatenate(val_scaled, axis=0) if val_scaled
                    else np.zeros((0, self.n_features), dtype=np.float32))

        # Chỉ số window hợp lệ (không băng qua ranh giới giữa các tập)
        self.train_starts = _window_starts(self.train_lengths, win_size, step)
        self.val_starts = _window_starts(self.val_lengths, win_size, step)

        # ---------- TEST: từng tập riêng, không nối ----------
        self.test_sets = []        # [(tên, x_raw (T, C), label (T,))]
        if load_test:
            for name in ECG_SETS:
                x = np.load(_set_file(data_path, name, "ECG_test.npy"))
                y = np.load(_set_file(data_path, name, "ECG_test_label.npy")).reshape(-1)
                if x.ndim != 2 or x.shape[1] != self.n_features:
                    raise ValueError(f"ECG_{name} test: cần shape (T, {self.n_features}), nhận {x.shape}")
                if len(y) != len(x):
                    raise ValueError(f"ECG_{name}: test có {len(x)} steps nhưng label có {len(y)}")
                if not np.isfinite(x).all():
                    raise ValueError(f"ECG_{name} test chứa NaN/Inf")
                if len(x) < win_size:
                    print(f"[WARN] ECG_{name} test chỉ có {len(x)} steps < win_size={win_size}, bỏ qua.")
                    continue
                self.test_sets.append((name, x, y.astype(int)))

        print("train sets:", dict(zip(self.set_names, self.train_lengths)))
        print("train:", self.train.shape, "| windows:", len(self.train_starts))
        print("val:", self.val.shape, "| windows:", len(self.val_starts), "| holdout:", holdout_val)
        if load_test:
            print("test sets:", {n: len(x) for n, x, _ in self.test_sets})

    def __len__(self):
        return len(self.train_starts) if self.mode == "train" else len(self.val_starts)

    def __getitem__(self, index):
        if self.mode == "train":
            s = self.train_starts[index]
            x = self.train[s:s + self.win_size]
        else:
            s = self.val_starts[index]
            x = self.val[s:s + self.win_size]
        return np.float32(x), np.zeros_like(x, dtype=np.float32)   # Không cần label khi train/val


def get_loader_segment(data_path, batch_size, win_size=127, step=None, mode='train', dataset='ECG',
                       val_ratio=0.2, holdout_val=True, load_test=False, sampling_rate=100):
    """step=None: ECG dùng 1 (như cũ), PTBXL dùng win_size//2 (step=1 trên PTB-XL cho hàng triệu window)."""
    if dataset == 'ECG':
        ds = ECGSegLoader(data_path, win_size, step or 1, mode, val_ratio=val_ratio,
                          holdout_val=holdout_val, load_test=load_test)
    elif dataset == 'PTBXL':      # train thẳng trên PTB-XL (12 kênh, chỉ bản ghi NORM), xem ptbxl_loader.py
        from data_factory.ptbxl_loader import PTBXLSegLoader
        ds = PTBXLSegLoader(data_path, win_size, step or max(1, win_size // 2), mode,
                            sampling_rate=sampling_rate, load_test=load_test)
    else:
        raise ValueError(f"dataset phải là 'ECG' hoặc 'PTBXL', nhận '{dataset}'")

    return DataLoader(dataset=ds,
                      batch_size=batch_size,
                      shuffle=(mode == 'train'),
                      num_workers=0)
