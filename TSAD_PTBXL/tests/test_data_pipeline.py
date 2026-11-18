import os

import numpy as np
import pytest

from data_factory.data_loader import ECG_SETS, ECGSegLoader, get_loader_segment

LENS = [100, 137, 250, 64, 300, 98]
C = 3


@pytest.fixture()
def ecg_dir(tmp_path):
    for i, (s, n) in enumerate(zip(ECG_SETS, LENS)):
        os.makedirs(tmp_path / f"ECG_{s}")
        x = np.random.randn(n, C) + 10 * i
        np.save(tmp_path / f"ECG_{s}" / "ECG_train.npy", x)
        m = 50 + 10 * i
        y = np.zeros(m, int)
        y[5:9] = 1
        np.save(tmp_path / f"ECG_{s}" / "ECG_test.npy", np.random.randn(m, C) + 10 * i)
        np.save(tmp_path / f"ECG_{s}" / "ECG_test_label.npy", y.reshape(-1, 1))   # label dạng (T, 1)
        (tmp_path / f"ECG_{s}" / "ECG_train.pkl").write_text("not a npy")          # .pkl phải bị bỏ qua
    return str(tmp_path)


def _ids(ds, which):
    lens = ds.train_lengths if which == "train" else ds.val_lengths
    return np.concatenate([np.full(n, i) for i, n in enumerate(lens)])


@pytest.mark.parametrize("win,step", [(5, 1), (20, 7), (30, 1)])
@pytest.mark.parametrize("holdout", [True, False])
def test_no_window_crosses_set_boundary(ecg_dir, win, step, holdout):
    ds = ECGSegLoader(ecg_dir, win, step, "train", holdout_val=holdout)
    for which, starts in (("train", ds.train_starts), ("val", ds.val_starts)):
        ids = _ids(ds, which)
        for s in starts:
            assert len(set(ids[s:s + win])) == 1


def test_last_window_of_each_set_reaches_set_end(ecg_dir):
    win = 5
    ds = ECGSegLoader(ecg_dir, win, 1, "train")
    off = 0
    for n in ds.train_lengths:
        inside = [s for s in ds.train_starts if off <= s < off + n]
        assert max(inside) + win == off + n
        off += n


def test_holdout_val_is_disjoint_and_scaler_uses_train_only(ecg_dir):
    ds = ECGSegLoader(ecg_dir, 5, 1, "train", holdout_val=True)
    for s, n_train, seg in zip(ds.set_names, ds.train_lengths, ds.raw_val_segments):
        raw = np.load(os.path.join(ecg_dir, f"ECG_{s}", "ECG_train.npy"))
        assert n_train + len(seg) == len(raw)
        np.testing.assert_allclose(seg, raw[n_train:])
    assert ds.scaler.center_.shape == (C,)


def test_short_sets_are_skipped(ecg_dir):
    ds = ECGSegLoader(ecg_dir, 100, 1, "train", holdout_val=False)
    assert "D" not in ds.set_names and "F" not in ds.set_names


def test_nan_in_train_is_rejected(ecg_dir):
    p = os.path.join(ecg_dir, "ECG_B", "ECG_train.npy")
    x = np.load(p)
    x[3, 0] = np.nan
    np.save(p, x)
    with pytest.raises(ValueError, match="NaN"):
        ECGSegLoader(ecg_dir, 5, 1, "train")


def test_only_ecg_supported(ecg_dir):
    with pytest.raises(ValueError):
        get_loader_segment(ecg_dir, 8, dataset="SMD")


def test_test_sets_loaded_per_set_not_concatenated(ecg_dir):
    ds = ECGSegLoader(ecg_dir, 20, 1, "train", load_test=True)
    assert [n for n, _, _ in ds.test_sets] == ECG_SETS
    for i, (n, x, y) in enumerate(ds.test_sets):
        assert x.shape == (50 + 10 * i, C) and y.shape == (50 + 10 * i,) and y.sum() == 4


def test_test_not_loaded_by_default_and_short_test_skipped(ecg_dir):
    assert ECGSegLoader(ecg_dir, 20, 1, "train").test_sets == []
    ds = ECGSegLoader(ecg_dir, 60, 1, "train", holdout_val=False, load_test=True)
    assert [n for n, _, _ in ds.test_sets] == ["B", "C", "D", "E", "F"]   # A chỉ có 50 steps


def test_label_length_mismatch_rejected(ecg_dir):
    np.save(os.path.join(ecg_dir, "ECG_C", "ECG_test_label.npy"), np.zeros(7, int))
    with pytest.raises(ValueError, match="label"):
        ECGSegLoader(ecg_dir, 20, 1, "train", load_test=True)


def test_wrong_data_path_gives_clear_error(tmp_path):
    with pytest.raises(FileNotFoundError, match="ECG_A"):
        ECGSegLoader(str(tmp_path), 20, 1, "train")