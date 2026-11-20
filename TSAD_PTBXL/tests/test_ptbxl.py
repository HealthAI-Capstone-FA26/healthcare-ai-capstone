import os

import numpy as np
import pytest

wfdb = pytest.importorskip("wfdb")

from data_factory.data_loader import get_loader_segment
from data_factory.ptbxl_loader import PTBXLSegLoader, find_root, load_ptbxl, record_label

LEADS = ["I", "II", "III", "AVR", "AVL", "AVF", "V1", "V2", "V3", "V4", "V5", "V6"]


def make_ptbxl(root, n=60, T=1000, seed=0):
    """Dựng thư mục giả theo đúng cấu trúc PhysioNet, ghi bằng WFDB thật."""
    import pandas as pd
    rs = np.random.RandomState(seed)
    base = os.path.join(root, "ptbxl")
    rows, kinds = [], ["NORM", "NORM", "MI", "STTC", "CD", "HYP"]
    for i in range(n):
        ecg_id = i + 1
        kind = kinds[i % len(kinds)]
        t = np.arange(T)[:, None]
        sig = np.sin(t / 8.0 + np.arange(12)) + rs.randn(T, 12) * 0.05
        if kind != "NORM":
            sig = sig * 1.8 + 1.5 * (kind in ("MI", "STTC"))
        sub = f"records100/{(ecg_id // 1000) * 1000:05d}"
        os.makedirs(os.path.join(base, sub), exist_ok=True)
        name = f"{ecg_id:05d}_lr"
        wfdb.wrsamp(name, fs=100, units=["mV"] * 12, sig_name=LEADS, p_signal=sig, fmt=["16"] * 12,
                    write_dir=os.path.join(base, sub))
        codes = {"NORM": "{'NORM': 100.0, 'SR': 0.0}", "MI": "{'IMI': 100.0, 'SR': 0.0}",
                 "STTC": "{'NST_': 100.0}", "CD": "{'CLBBB': 100.0}", "HYP": "{'LVH': 100.0}"}[kind]
        rows.append(dict(ecg_id=ecg_id, patient_id=ecg_id, scp_codes=codes, strat_fold=i % 10 + 1,
                         filename_lr=f"{sub}/{name}"))
    pd.DataFrame(rows).to_csv(os.path.join(base, "ptbxl_database.csv"), index=False)
    pd.DataFrame({"": ["NORM", "SR", "IMI", "NST_", "CLBBB", "LVH"],
                  "diagnostic": [1, 0, 1, 1, 1, 1],
                  "diagnostic_class": ["NORM", None, "MI", "STTC", "CD", "HYP"]}
                 ).set_index("").to_csv(os.path.join(base, "scp_statements.csv"))
    return root


@pytest.fixture(scope="module")
def root(tmp_path_factory):
    return make_ptbxl(str(tmp_path_factory.mktemp("ptbxl")))


def test_finds_root_and_loads_12_leads(root):
    assert find_root(root).endswith("ptbxl")
    d = load_ptbxl(root, 100)
    assert d["X"].shape == (60, 1000, 12)
    assert [record_label(c) for c in d["classes"]][:6] == [0, 0, 1, 1, 1, 1]
    assert os.path.isfile(os.path.join(find_root(root), "ptbxl_cache_100.npz"))
    assert np.array_equal(load_ptbxl(root, 100)["X"], d["X"])               # đọc lại từ cache


def test_train_val_use_only_normal_records_of_the_right_folds(root):
    ds = PTBXLSegLoader(root, 100, 50, "train")
    d = load_ptbxl(root, 100)
    lab = np.array([record_label(c) for c in d["classes"]])
    for ids, folds in ((ds.train_ecg_ids, range(1, 9)), (ds.val_ecg_ids, [9])):
        sel = np.isin(d["ecg_id"], ids)
        assert (lab[sel] == 0).all() and np.isin(d["fold"][sel], list(folds)).all()
    assert not set(ds.train_ecg_ids) & set(ds.val_ecg_ids)
    assert ds.n_features == 12 and ds.scaler.center_.shape == (12,)


def test_windows_never_cross_record_boundaries(root):
    ds = PTBXLSegLoader(root, 100, 37, "train")
    ends = np.cumsum(ds.train_lengths)
    idx = np.searchsorted(ends, ds.train_starts, side="right")
    assert (ds.train_starts + 100 <= ends[idx]).all()


def test_test_records_are_fold10_with_record_labels(root):
    ds = PTBXLSegLoader(root, 100, 50, "train", load_test=True)
    assert ds.test_records and all(r["x"].shape == (1000, 12) for r in ds.test_records)
    assert {r["label"] for r in ds.test_records} == {0, 1}


def test_loader_batches_are_12_channel_and_shuffled_train(root):
    dl = get_loader_segment(root, 16, win_size=100, step=50, mode="train", dataset="PTBXL")
    xb, _ = next(iter(dl))
    assert xb.shape == (16, 100, 12)
    assert len(dl.dataset) > 16
