"""
Xử lý trước/sau cho dịch vụ AI ECG — THUẦN numpy (không cần torch) để test độc lập.

Hợp đồng đầu ra khớp backend: backend/src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-provider.port.ts (EcgAnalyzeResult).

Quy ước điểm:
  Model trả điểm thô s theo từng step; bundle có ngưỡng T (calibrate trên validation, không dùng label).
  Điểm chuẩn hoá  norm = clip(s / (2*T), 0, 1)  -> s == T  <=>  norm == 0.5.
  `options.threshold` của backend (AiModelVersion.defaultThreshold, mặc định 0.5) là ngưỡng trên thang norm,
  nên 0.5 ≡ đúng ngưỡng của bundle. Detection là NHỊ PHÂN theo step (flag 1/0); không phân mức độ nghiêm trọng.
"""
import csv
import io
import json

import numpy as np

SUPPORTED_FORMATS = ("csv", "json", "npy")   # npy: mảng số 2 chiều (steps x kênh), khớp ECG_*_test.npy
_TIME_HEADERS = {"time", "t", "timestamp", "sample", "samples", "index", "idx", "step"}


class SignalFormatError(ValueError):
    """Tệp tín hiệu không đọc được / sai cấu trúc -> HTTP 422."""


# ----------------------------------------------------------------------------------------------------------------------
# Đọc tín hiệu
# ----------------------------------------------------------------------------------------------------------------------
def _to_float(s):
    s = s.strip()
    if s == "":
        return np.nan
    try:
        return float(s)
    except ValueError:
        raise ValueError(s)


def parse_csv(buf: bytes, n_leads: int):
    text = buf.decode("utf-8-sig", errors="replace")
    if not text.strip():
        raise SignalFormatError("Tệp CSV rỗng.")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
        delim = dialect.delimiter
    except csv.Error:
        delim = ","
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any(c.strip() for c in r)]
    header = None
    try:
        [_to_float(c) for c in rows[0]]
    except ValueError:
        header, rows = [c.strip().lower() for c in rows[0]], rows[1:]
    if not rows:
        raise SignalFormatError("CSV không có dòng dữ liệu.")
    try:
        data = np.array([[_to_float(c) for c in r] for r in rows], dtype=np.float64)
    except (ValueError, TypeError):
        raise SignalFormatError("CSV có ô không phải số, hoặc các dòng có số cột khác nhau.")
    if data.ndim != 2:
        raise SignalFormatError("CSV có các dòng với số cột khác nhau.")
    if data.shape[1] == n_leads + 1 and header and header[0] in _TIME_HEADERS:
        data = data[:, 1:]          # bỏ cột thời gian/chỉ số
    if data.shape[1] != n_leads:
        raise SignalFormatError(f"CSV có {data.shape[1]} cột nhưng model cần {n_leads} kênh.")
    return data


def parse_json(buf: bytes, n_leads: int, lead_names=None):
    try:
        obj = json.loads(buf.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise SignalFormatError(f"JSON không hợp lệ: {e}")
    if isinstance(obj, dict):
        if isinstance(obj.get("leads"), dict):                   # {"leads": {"I": [...], "II": [...]}}
            d = obj["leads"]
            keys = [k for k in (lead_names or []) if k in d] if lead_names else list(d)
            if len(keys) != n_leads:
                raise SignalFormatError(f"JSON.leads có {len(d)} kênh, cần {n_leads}.")
            obj = np.array([d[k] for k in keys], dtype=np.float64).T
        else:
            obj = obj.get("signal", obj.get("data"))
            if obj is None:
                raise SignalFormatError("JSON dạng object cần khóa 'signal', 'data' hoặc 'leads'.")
    try:
        data = np.array(obj, dtype=np.float64)
    except (ValueError, TypeError):
        raise SignalFormatError("JSON chứa giá trị không phải số hoặc mảng không đều.")
    if data.ndim != 2:
        raise SignalFormatError("Tín hiệu JSON phải là mảng 2 chiều (steps x kênh).")
    if data.shape[1] != n_leads and data.shape[0] == n_leads:
        data = data.T                                             # (kênh, steps) -> (steps, kênh)
    if data.shape[1] != n_leads:
        raise SignalFormatError(f"JSON có shape {data.shape}, model cần {n_leads} kênh.")
    return data


def parse_npy(buf: bytes, n_leads: int):
    try:
        data = np.load(io.BytesIO(buf), allow_pickle=False)
    except Exception as e:  # noqa: BLE001 — định dạng .npy hỏng / chứa object
        raise SignalFormatError(f"Không đọc được tệp .npy: {e}")
    if data.ndim != 2 or not np.issubdtype(data.dtype, np.number):
        raise SignalFormatError(f"NPY phải là mảng số 2 chiều (steps x kênh), nhận shape {data.shape}, dtype {data.dtype}.")
    data = data.astype(np.float64)
    if data.shape[1] != n_leads and data.shape[0] == n_leads:
        data = data.T
    if data.shape[1] != n_leads:
        raise SignalFormatError(f"NPY có shape {data.shape}, model cần {n_leads} kênh.")
    return data


def parse_signal(buf: bytes, fmt: str, n_leads: int, lead_names=None):
    if fmt == "csv":
        return parse_csv(buf, n_leads)
    if fmt == "json":
        return parse_json(buf, n_leads, lead_names)
    if fmt == "npy":
        return parse_npy(buf, n_leads)
    raise SignalFormatError(f"Định dạng '{fmt}' chưa được hỗ trợ (chỉ: {', '.join(SUPPORTED_FORMATS)}).")


# ----------------------------------------------------------------------------------------------------------------------
# Kiểm tra chất lượng
# ----------------------------------------------------------------------------------------------------------------------
def check_quality(x, min_finite=0.8):
    """Trả (signal_quality 0..1, lý do poor_signal hoặc None). Chất lượng = tỉ lệ ô hữu hạn."""
    finite = np.isfinite(x)
    quality = float(finite.mean()) if x.size else 0.0
    if quality < min_finite:
        return quality, f"quá nhiều giá trị NaN/Inf ({(1 - quality) * 100:.1f}%)"
    for c in range(x.shape[1]):
        col = x[finite[:, c], c]
        if col.size == 0:
            return quality, f"kênh {c} không có giá trị hợp lệ"
        if np.ptp(col) == 0:
            return quality, f"kênh {c} là đường phẳng (không có tín hiệu)"
    return quality, None


# ----------------------------------------------------------------------------------------------------------------------
# Điểm -> kết quả
# ----------------------------------------------------------------------------------------------------------------------
def normalize_scores(scores, bundle_threshold):
    t = max(float(bundle_threshold), 1e-12)
    return np.clip(np.asarray(scores, dtype=np.float64) / (2.0 * t), 0.0, 1.0)


def flags_to_segments(flags, merge_gap=0):
    """flags (T,) bool -> [(start, end_inclusive)]; gộp 2 đoạn cách nhau <= merge_gap step."""
    f = np.asarray(flags, dtype=bool)
    if not f.any():
        return []
    edges = np.diff(np.concatenate([[0], f.astype(np.int8), [0]]))
    starts, ends = np.where(edges == 1)[0], np.where(edges == -1)[0] - 1
    segs = [[int(starts[0]), int(ends[0])]]
    for s, e in zip(starts[1:], ends[1:]):
        if s - segs[-1][1] - 1 <= merge_gap:
            segs[-1][1] = int(e)
        else:
            segs.append([int(s), int(e)])
    return [(a, b) for a, b in segs]


def build_result(scores, bundle_threshold, norm_threshold, sample_rate_hz, win_size, stride, lead_names,
                 severity="high", merge_gap=0, signal_quality=1.0, latency_ms=None):
    """Tạo dict EcgAnalyzeResult. Mọi offset là ms tính từ đầu bản ghi (step * 1000 / fs)."""
    scores = np.asarray(scores, dtype=np.float64)
    norm = normalize_scores(scores, bundle_threshold)
    flags = norm > norm_threshold
    ms = lambda step: int(round(step * 1000.0 / sample_rate_hz))   # noqa: E731

    anomalies = []
    for a, b in flags_to_segments(flags, merge_gap):
        seg_norm = norm[a:b + 1]
        anomalies.append({
            "anomalyType": None,                       # model unsupervised: không phân loại bệnh
            "score": round(float(seg_norm.max()), 5),
            "severity": severity,                      # detection nhị phân -> không phân mức; hằng số cấu hình được
            "startOffsetMs": ms(a),
            "endOffsetMs": ms(b + 1),
            "affectedLeads": list(lead_names),
            "heartRateBpm": None,
            "details": {
                "startStep": a, "endStep": b, "steps": b - a + 1,
                "rawScoreMax": float(scores[a:b + 1].max()),
                "rawScoreMean": float(scores[a:b + 1].mean()),
            },
        })

    n_flag = int(flags.sum())
    return {
        "overallResult": "abnormal" if anomalies else "normal",
        "maxAnomalyScore": round(float(norm.max()), 5),
        "thresholdUsed": round(float(norm_threshold), 5),
        "windowMs": max(1, ms(win_size)),
        "strideMs": max(1, ms(stride)),
        "signalQuality": round(float(signal_quality), 4),
        "summaryMetrics": {
            "steps": int(len(scores)),
            "flaggedSteps": n_flag,
            "flaggedRatio": round(n_flag / max(1, len(scores)), 6),
            "abnormalDurationMs": int(sum(x["endOffsetMs"] - x["startOffsetMs"] for x in anomalies)),
            "bundleThresholdRaw": float(bundle_threshold),
            "effectiveThresholdRaw": float(2.0 * bundle_threshold * norm_threshold),
            "scoreScale": "norm = clip(raw / (2 * bundleThreshold), 0, 1)",
        },
        "inferenceLatencyMs": latency_ms,
        "anomalies": anomalies,
    }


def non_decision_result(overall, reason, signal_quality=None):
    """poor_signal / inconclusive: AI không kết luận (không có đoạn bất thường)."""
    return {
        "overallResult": overall, "maxAnomalyScore": None, "thresholdUsed": None, "windowMs": None, "strideMs": None,
        "signalQuality": None if signal_quality is None else round(float(signal_quality), 4),
        "summaryMetrics": {"reason": reason}, "inferenceLatencyMs": None, "anomalies": [],
    }
