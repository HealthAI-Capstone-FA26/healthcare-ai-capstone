import json

import numpy as np
import pytest

from service import postprocess as pp


def test_csv_header_time_column_and_nan():
    csv = b"time,ch1,ch2\n0,1.0,2.0\n1,,3.0\n2,1.5,2.5\n"
    x = pp.parse_csv(csv, 2)
    assert x.shape == (3, 2) and np.isnan(x[1, 0])


def test_csv_wrong_columns_and_garbage():
    with pytest.raises(pp.SignalFormatError):
        pp.parse_csv(b"1,2,3\n4,5,6\n", 2)
    with pytest.raises(pp.SignalFormatError):
        pp.parse_csv(b"1,2\n3,abc\n", 2)


def test_json_variants():
    rows = [[1, 2], [3, 4], [5, 6]]
    assert pp.parse_json(json.dumps(rows).encode(), 2).shape == (3, 2)
    assert pp.parse_json(json.dumps({"signal": rows}).encode(), 2).shape == (3, 2)
    assert pp.parse_json(json.dumps([[1, 3, 5], [2, 4, 6]]).encode(), 2).shape == (3, 2)   # (kênh, steps)
    d = {"leads": {"I": [1, 3, 5], "II": [2, 4, 6]}}
    assert pp.parse_json(json.dumps(d).encode(), 2, ["I", "II"]).shape == (3, 2)
    with pytest.raises(pp.SignalFormatError):
        pp.parse_signal(b"", "edf", 2)


def test_quality():
    x = np.random.RandomState(0).randn(100, 2)
    assert pp.check_quality(x) == (1.0, None)
    flat = x.copy(); flat[:, 1] = 3.0
    assert pp.check_quality(flat)[1] is not None
    nan = x.copy(); nan[:50] = np.nan
    assert "NaN" in pp.check_quality(nan)[1]


def test_segments_and_merge():
    f = np.array([0, 1, 1, 0, 0, 1, 0, 1, 1], dtype=bool)
    assert pp.flags_to_segments(f) == [(1, 2), (5, 5), (7, 8)]
    assert pp.flags_to_segments(f, merge_gap=1) == [(1, 2), (5, 8)]
    assert pp.flags_to_segments(f, merge_gap=2) == [(1, 8)]
    assert pp.flags_to_segments(np.zeros(5, bool)) == []


def test_build_result_contract():
    scores = np.array([0.1] * 10 + [0.9] * 5 + [0.1] * 5)       # ngưỡng bundle 0.5 -> 5 step vượt
    r = pp.build_result(scores, 0.5, 0.5, 100, 20, 10, ["a", "b"], severity="high")
    assert r["overallResult"] == "abnormal" and len(r["anomalies"]) == 1
    a = r["anomalies"][0]
    assert (a["startOffsetMs"], a["endOffsetMs"]) == (100, 150)      # step 10..14 @100Hz
    assert 0 <= a["score"] <= 1 and a["anomalyType"] is None and a["severity"] == "high"
    assert r["windowMs"] == 200 and r["strideMs"] == 100 and r["thresholdUsed"] == 0.5
    assert r["summaryMetrics"]["flaggedSteps"] == 5 and r["maxAnomalyScore"] <= 1


def test_build_result_normal_and_threshold_option():
    scores = np.full(30, 0.4)
    assert pp.build_result(scores, 0.5, 0.5, 100, 10, 5, ["a"])["overallResult"] == "normal"
    # hạ ngưỡng chuẩn hoá: 0.4/(2*0.5)=0.4 > 0.3 -> bất thường toàn bộ
    r = pp.build_result(scores, 0.5, 0.3, 100, 10, 5, ["a"])
    assert r["overallResult"] == "abnormal" and r["anomalies"][0]["endOffsetMs"] == 300


def test_non_decision():
    r = pp.non_decision_result("poor_signal", "x", 0.3)
    assert r["anomalies"] == [] and r["overallResult"] == "poor_signal"
