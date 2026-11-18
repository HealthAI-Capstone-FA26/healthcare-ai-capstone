import os

import numpy as np
import pytest
import torch

from model.TCN_VAE_Diff import Model
from utils.deploy import Detector, load_bundle, save_bundle

WIN, C = 20, 3
CFG = dict(input_dim=C, in_channels=[4, 8], out_channels=[8, 4], kernel_size=[3], z_dim=8,
           dropout=0.1, causal=True, diff_steps=10, beta_kl=0.01, detach_gen=False, seq_len=WIN)


@pytest.fixture()
def detector():
    torch.manual_seed(0)
    return Detector(Model(**CFG), np.zeros(C) + 0.5, np.ones(C) * 2.0, WIN, "cpu")


def _signal(n=95):
    return np.random.RandomState(1).randn(n, C)


def test_score_shape_covers_tail_and_is_deterministic(detector):
    x = _signal(95)                       # 95 không chia hết cho win -> phải có window dời cuối
    a, b = detector.score(x), detector.score(x)
    assert a.shape == (95,) and np.isfinite(a).all()
    np.testing.assert_array_equal(a, b)   # cùng seed -> cùng kết quả dù model có noise khuếch tán


def test_score_does_not_disturb_global_rng(detector):
    torch.manual_seed(123)
    expected = torch.rand(3)
    torch.manual_seed(123)
    detector.score(_signal())
    assert torch.equal(torch.rand(3), expected)


def test_stride_and_validation(detector):
    x = _signal(95)
    assert detector.score(x, stride=5).shape == (95,)
    with pytest.raises(ValueError):
        detector.score(_signal(WIN - 1))
    with pytest.raises(ValueError):
        detector.score(np.zeros((50, C + 1)))


def test_nan_policy(detector):
    x = _signal()
    x[10, 1] = np.nan
    with pytest.raises(ValueError):
        detector.score(x)
    assert np.isfinite(detector.score(x, nan_policy="interpolate")).all()


def test_calibrate_and_detect(detector):
    segs = [_signal(60), _signal(80)]
    cal = detector.calibrate(segs, 99.0)
    assert cal["threshold"] == detector.threshold and cal["n_points"] == 140
    scores, flags = detector.detect(_signal(95))
    assert flags.dtype == bool and flags.shape == scores.shape
    with pytest.raises(ValueError):
        detector.calibrate([_signal(WIN - 1)], 99.0)


def test_bundle_roundtrip(detector, tmp_path):
    detector.calibrate([_signal(80)], 99.0)
    path = str(tmp_path / "m_deploy.pt")
    save_bundle(path, detector, CFG, {"sets": ["A"]})
    assert os.path.exists(path) and not os.path.exists(path + ".tmp")
    loaded = load_bundle(path, device="cpu")
    x = _signal(95)
    np.testing.assert_allclose(loaded.score(x), detector.score(x), rtol=1e-5, atol=1e-6)
    assert loaded.threshold == pytest.approx(detector.threshold)
    assert loaded.win_size == WIN and loaded.n_features == C

def test_calibration_stride_is_stored_and_used_as_default(detector, tmp_path):
    segs = [_signal(80)]
    cal = detector.calibrate(segs, 92.5, stride=5)
    assert cal["stride"] == 5 and "p92.5" in cal
    x = _signal(95)
    np.testing.assert_array_equal(detector.score(x), detector.score(x, stride=5))
    path = str(tmp_path / "s_deploy.pt")
    save_bundle(path, detector, CFG)
    loaded = load_bundle(path, device="cpu")
    assert loaded.calibration["stride"] == 5
    np.testing.assert_allclose(loaded.score(x), detector.score(x), rtol=1e-5, atol=1e-6)
    # calibrate lại không truyền stride -> quay về win_size, không thừa hưởng stride cũ
    assert detector.calibrate(segs, 92.5)["stride"] == WIN
