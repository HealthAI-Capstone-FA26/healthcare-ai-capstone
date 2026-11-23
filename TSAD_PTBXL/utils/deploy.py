"""
Đóng gói và suy luận cho production.

Một file bundle (.pt) chứa TẤT CẢ những gì cần để chạy inference, để không bao giờ bị lệch
giữa lúc train và lúc deploy:
    - trọng số model + cấu hình dựng model
    - tham số RobustScaler (center, scale) đã fit trên train gộp
    - win_size và ngưỡng phát hiện đã calibrate trên validation (không cần label)

Bundle chỉ gồm tensor / số / chuỗi nên nạp được bằng torch.load(weights_only=True).
"""
import os
import time

import numpy as np
import torch

BUNDLE_VERSION = 1


class Detector(object):
    def __init__(self, model, scaler_center, scaler_scale, win_size, device, threshold=None, calibration=None):
        self.model = model.to(device).eval()
        self.center = np.asarray(scaler_center, dtype=np.float64)
        self.scale = np.asarray(scaler_scale, dtype=np.float64)
        self.win_size = int(win_size)
        self.device = torch.device(device)
        self.threshold = threshold
        self.calibration = calibration or {}
        self.n_features = int(self.center.shape[0])

    # ------------------------------------------------------------------ #
    def _prepare(self, x, nan_policy):
        x = np.asarray(x, dtype=np.float64)
        if x.ndim != 2 or x.shape[1] != self.n_features:
            raise ValueError(f"Input cần shape (T, {self.n_features}), nhận {x.shape}")
        bad = ~np.isfinite(x)
        if bad.any():
            if nan_policy != "interpolate":
                raise ValueError(f"Input có {int(bad.sum())} giá trị NaN/Inf (nan_policy='raise')")
            x = x.copy()
            t = np.arange(len(x))
            for c in range(x.shape[1]):
                m = bad[:, c]
                if m.all():
                    raise ValueError(f"Kênh {c} toàn NaN/Inf, không thể nội suy")
                if m.any():
                    x[m, c] = np.interp(t[m], t[~m], x[~m, c])
        return ((x - self.center) / self.scale).astype(np.float32)

    @torch.no_grad()
    def score(self, x, stride=None, batch_size=256, seed=0, nan_policy="raise"):
        """
        x: (T, C) tín hiệu RAW (chưa scale)  ->  điểm bất thường theo từng điểm, shape (T,)

        stride mặc định = stride đã dùng lúc calibrate (lưu trong bundle), nếu bundle cũ chưa có thì = win_size.
        Ngưỡng chỉ có nghĩa khi score và calibrate dùng CÙNG stride. Window cuối luôn
        được dời để kết thúc đúng tại điểm cuối tín hiệu nên không mất đuôi; điểm nào được nhiều
        window phủ thì lấy trung bình.
        Model có lấy mẫu nhiễu khuếch tán, nên seed được cố định và RNG toàn cục được khôi phục sau đó
        -> cùng input luôn cho cùng kết quả.
        """
        x = self._prepare(x, nan_policy)
        T, win = len(x), self.win_size
        if T < win:
            raise ValueError(f"Tín hiệu ({T} steps) ngắn hơn win_size={win}")
        stride = int(stride or self.calibration.get("stride") or win)
        if stride < 1:
            raise ValueError("stride phải >= 1")

        starts = list(range(0, T - win + 1, stride))
        if starts[-1] != T - win:
            starts.append(T - win)

        acc, cnt = np.zeros(T), np.zeros(T)
        cuda_devs = [self.device.index or 0] if self.device.type == "cuda" else []
        self.model.eval()
        with torch.random.fork_rng(devices=cuda_devs):
            torch.manual_seed(seed)
            for i in range(0, len(starts), batch_size):
                idx = starts[i:i + batch_size]
                batch = torch.from_numpy(np.stack([x[s:s + win] for s in idx])).to(self.device)
                sc = self.model.anomaly_score(batch).float().cpu().numpy()      # (B, L)
                for s, row in zip(idx, sc):
                    acc[s:s + win] += row
                    cnt[s:s + win] += 1
        out = acc / cnt
        if not np.isfinite(out).all():
            raise RuntimeError("Model trả về điểm không hữu hạn (NaN/Inf)")
        return out

    def detect(self, x, **kw):
        """Trả về (scores, flags). flags = scores > threshold."""
        if self.threshold is None:
            raise RuntimeError("Detector chưa có ngưỡng; hãy calibrate hoặc nạp từ bundle")
        scores = self.score(x, **kw)
        return scores, scores > self.threshold

    def calibrate(self, raw_segments, percentile, **kw):
        """
        Ngưỡng = percentile của điểm trên dữ liệu bình thường (validation giữ lại), KHÔNG dùng label.
        percentile=99.5 nghĩa là ~0.5% điểm bình thường sẽ bị gắn cờ.
        """
        segs = [s for s in raw_segments if len(s) >= self.win_size]
        if not segs:
            raise ValueError("Không có đoạn validation nào đủ dài để calibrate ngưỡng")
        stride = int(kw.pop("stride", None) or self.win_size)     # stride dùng để calibrate, sẽ được lưu vào bundle
        scores = np.concatenate([self.score(s, stride=stride, **kw) for s in segs])
        self.threshold = float(np.percentile(scores, percentile))
        self.calibration = {
            "percentile": float(percentile),
            "stride": stride,
            "threshold": self.threshold,
            "n_points": int(len(scores)),
            "score_mean": float(scores.mean()),
            "score_std": float(scores.std()),
            "score_max": float(scores.max()),
            # Các percentile tham chiếu của điểm validation bình thường: để biết một ngưỡng bất kỳ
            # (vd. ngưỡng thử nghiệm ở predict.py --threshold) tương ứng mức báo động nhầm nào.
            **{f"p{q:g}": float(np.percentile(scores, q)) for q in (50, 90, 92.5, 95, 97, 99, 99.5)},
        }
        return self.calibration


# ---------------------------------------------------------------------- #
def save_bundle(path, detector, model_config, data_info=None):
    bundle = {
        "format_version": BUNDLE_VERSION,
        "created": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model_config": dict(model_config),
        "state_dict": {k: v.detach().cpu() for k, v in detector.model.state_dict().items()},
        "scaler": {"center": torch.from_numpy(detector.center.copy()),
                   "scale": torch.from_numpy(detector.scale.copy())},
        "win_size": int(detector.win_size),
        "calibration": dict(detector.calibration),
        "data_info": dict(data_info or {}),
    }
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    torch.save(bundle, tmp)
    os.replace(tmp, path)          # ghi nguyên tử: không bao giờ để lại bundle dở dang
    return path


def load_bundle(path, device="cpu"):
    from model.TCN_VAE_Diff import Model   # import muộn để utils không phụ thuộc model khi chỉ cần save/score

    if str(device).startswith("cuda") and not torch.cuda.is_available():
        print("[WARN] CUDA không khả dụng, chuyển sang CPU")
        device = "cpu"
    bundle = torch.load(path, map_location="cpu", weights_only=True)
    if bundle.get("format_version") != BUNDLE_VERSION:
        raise ValueError(f"Bundle version {bundle.get('format_version')} không được hỗ trợ (cần {BUNDLE_VERSION})")

    model = Model(**bundle["model_config"])
    model.load_state_dict(bundle["state_dict"])
    cal = bundle["calibration"]
    return Detector(
        model=model,
        scaler_center=bundle["scaler"]["center"].numpy(),
        scaler_scale=bundle["scaler"]["scale"].numpy(),
        win_size=bundle["win_size"],
        device=device,
        threshold=cal.get("threshold"),
        calibration=cal,
    )