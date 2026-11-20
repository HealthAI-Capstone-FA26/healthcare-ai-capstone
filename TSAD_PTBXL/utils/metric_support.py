import numpy as np

# Mặc định của Tatbul et al. 2018 (bỏ nếu bản tsadmetrics của bạn đã có default)
_RANGE_KW = dict(p_alpha=0.0, r_alpha=0.0, p_bias="flat", r_bias="flat",
                 cardinality_mode="reciprocal")
_LOW_BETA_IS_PRECISION = {}

def _point_adjust(gt, pred):
    """Chỉ dùng để lấy Precision/Recall của PA (thư viện không trả về)."""
    adj = pred.copy()
    d = np.diff(np.concatenate([[0], gt, [0]]))
    for s, e in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
        if pred[s:e].any():
            adj[s:e] = 1
    return adj

def _low_beta_is_precision(cls, **kw):
    """Hiệu chuẩn: ví dụ nhỏ có Precision cao, Recall thấp."""
    if cls not in _LOW_BETA_IS_PRECISION:
        g = np.r_[np.zeros(10), np.ones(10)].astype(int)
        p = np.r_[np.zeros(10), np.ones(2), np.zeros(8)].astype(int)
        lo = cls(beta=1e-3, **kw).compute(g, p)
        hi = cls(beta=1e3, **kw).compute(g, p)
        _LOW_BETA_IS_PRECISION[cls] = True if abs(lo - hi) < 1e-6 else lo > hi
    return _LOW_BETA_IS_PRECISION[cls]


def _pr_f1_from_fbeta(cls, gt, pred, **kw):
    """tsadmetrics chỉ trả F-beta: suy P, R từ beta rất nhỏ / rất lớn."""
    lo = cls(beta=1e-3, **kw).compute(gt, pred)
    hi = cls(beta=1e3, **kw).compute(gt, pred)
    p, r = (lo, hi) if _low_beta_is_precision(cls, **kw) else (hi, lo)
    f1 = cls(beta=1.0, **kw).compute(gt, pred)
    return p, r, f1