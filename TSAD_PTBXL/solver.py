import torch
import torch.nn as nn
import numpy as np
import os
import time
from utils.cost import EvaluationCost
from utils.utils import *
from utils.deploy import Detector, save_bundle
from model.TCN_VAE_Diff import Model
from data_factory.data_loader import get_loader_segment
from sklearn.metrics import precision_score, recall_score
from tsadmetrics.metrics.spm import PointwiseFScore, PointwiseAucRoc, PointwiseAucPr
from tsadmetrics.metrics.tem.tpdm import PointadjustedFScore, RangebasedFScore
from tsadmetrics.metrics.tem.tstm import VusRoc, VusPr, AffiliationbasedFScore
from utils.metric_support import _RANGE_KW, _point_adjust, _pr_f1_from_fbeta


class EarlyStopping:
    def __init__(self, patience=7, verbose=False, dataset_name='', delta=0):
        self.patience = patience
        self.verbose = verbose
        self.counter = 0
        self.best_score = None
        self.early_stop = False
        self.val_loss_min = np.inf
        self.delta = delta
        self.dataset = dataset_name

    def __call__(self, win_size, val_loss, model, path):
        score = -val_loss
        if self.best_score is None:
            self.best_score = score
            self.save_checkpoint(win_size, val_loss, model, path)
        elif score < self.best_score + self.delta:
            self.counter += 1
            print(f'EarlyStopping counter: {self.counter} out of {self.patience}')
            if self.counter >= self.patience:
                self.early_stop = True
        else:
            self.best_score = score
            self.save_checkpoint(win_size, val_loss, model, path)
            self.counter = 0

    def save_checkpoint(self, win_size, val_loss, model, path):
        if self.verbose:
            print(f'Validation loss decreased ({self.val_loss_min:.6f} --> {val_loss:.6f}). Saving model ...')
        target = os.path.join(path, f"{self.dataset}_wsize{win_size}_checkpoint.pth")
        torch.save(model.state_dict(), target + ".tmp")
        os.replace(target + ".tmp", target)       # ghi nguyên tử, không để lại checkpoint dở dang
        self.val_loss_min = val_loss


class Solver(object):
    # Giá trị mặc định cho các khóa config mới, để Solver vẫn chạy được khi config thiếu chúng.
    DEFAULTS = {
        "mode": "train",
        "val_ratio": 0.2,
        "holdout_val": True,
        "threshold_percentile": 92.5,
        "patience": 5,
        "grad_clip": 0.0,
        "input_c": None,
        "sampling_rate": 100,
        "train_step": None,
        "device": "cuda",
    }
    MAX_BAD_BATCHES = 10      # số batch loss không hữu hạn liên tiếp cho phép trước khi dừng hẳn

    def __init__(self, config):
        self.__dict__.update(Solver.DEFAULTS, **config)

        requested = str(self.device)
        if requested.startswith("cuda") and not torch.cuda.is_available():
            print("[WARN] CUDA không khả dụng, chuyển sang CPU")
            requested = "cpu"
        self.device = torch.device("cuda:0" if requested == "cuda" else requested)
        self.criterion = nn.MSELoss()

        self._build_data()
        self.build_model()

    # ------------------------------------------------------------------ #
    def _loader(self, mode, load_test=False):
        return get_loader_segment(self.data_path, batch_size=self.batch_size, win_size=self.win_size,
                                  step=self.train_step, mode=mode, dataset=self.dataset,
                                  val_ratio=self.val_ratio, holdout_val=self.holdout_val,
                                  load_test=load_test, sampling_rate=self.sampling_rate)

    def _build_data(self):
        """Chỉ dựng loader mà mode hiện tại thật sự dùng (mỗi loader phải nạp và fit scaler lại)."""
        if self.dataset == 'PTBXL' and self.mode != 'train':
            raise ValueError("PTBXL có nhãn theo bản ghi, không theo điểm: đánh giá bằng "
                             "`python eval_ptbxl.py --bundle <...deploy.pt> --data_path <...>`")
        if self.mode == 'train':
            self.train_loader = self._loader('train')
            self.vali_loader = self._loader('val')
            ref = self.train_loader.dataset
            if len(self.train_loader.dataset) == 0:
                raise ValueError("Train không có window nào; kiểm tra win_size và độ dài các tập ECG")
            if len(self.vali_loader.dataset) == 0:
                raise ValueError(
                    "Validation không có window nào (đuôi mỗi tập ngắn hơn win_size). "
                    "Giảm --win_size hoặc tăng --val_ratio; nếu không early stopping sẽ vô nghĩa.")
        else:
            self.train_loader = self._loader('train', load_test=True)
            ref = self.train_loader.dataset
            if not ref.test_sets:
                raise ValueError("Không có tập test nào đủ dài so với win_size")

        # Số kênh lấy từ dữ liệu, không tin vào CLI
        if self.input_c is not None and int(self.input_c) != ref.n_features:
            raise ValueError(f"--input_c={self.input_c} nhưng dữ liệu có {ref.n_features} kênh")
        self.input_c = ref.n_features
        self.set_names, self.train_lengths = ref.set_names, ref.train_lengths

    def compute_flops_and_macs(self) -> dict:
        """Tinh cost 1 lan va LUU vao self.cost (ban cu bo mat ket qua tra ve)."""
        evaluator = EvaluationCost(
            model=self.model,
            input_shape=(1, self.win_size, self.input_c),
            device=self.device,
        )
        self.cost = evaluator.evaluate(verbose=True)
        return self.cost

    def build_model(self):
        self.model_config = dict(
            input_dim=self.input_c,
            in_channels=list(self.in_channels),
            out_channels=list(self.out_channels),
            kernel_size=list(self.kernel_size),
            z_dim=self.z_dim,
            dropout=self.dropout,
            causal=self.causal,
            diff_steps=self.diff_steps,
            beta_kl=self.beta_kl,
            detach_gen=self.detach_gen,
            seq_len=self.win_size,
        )
        self.model = Model(**self.model_config).to(self.device)
        self.optimizer = torch.optim.Adam(self.model.parameters(), lr=self.lr)

        scheduler_type = self.scheduler
        if scheduler_type == "cosine_restart":
            self.scheduler = torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(
                self.optimizer, T_0=5, T_mult=1, eta_min=1e-5)
        elif scheduler_type == "cosine":
            self.scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
                self.optimizer, T_max=self.num_epochs // 2, eta_min=1e-5)
        elif scheduler_type == "step":
            self.scheduler = torch.optim.lr_scheduler.StepLR(
                self.optimizer, step_size=10, gamma=0.5)
        else:
            self.scheduler = None

        if self.pretrained_model:
            state = torch.load(self.pretrained_model, map_location=self.device, weights_only=True)
            own = self.model.state_dict()
            # Pretrain PTB-XL (12 kênh) -> finetune ECG (2 kênh): các lớp phụ thuộc số kênh (conv đầu của encoder,
            # noisy_proj, proj_head) khác shape nên KHÔNG nạp được; chúng khởi tạo ngẫu nhiên, phần còn lại
            # (TCN sâu, bottleneck, decoder, t_embed) được chuyển giao. Key lạ (vd. freq_weight của model cũ) -> lỗi rõ ràng.
            unexpected = [k for k in state if k not in own]
            if unexpected:
                raise RuntimeError(
                    f"Checkpoint '{self.pretrained_model}' có key không thuộc model hiện tại: {unexpected[:3]}... "
                    "Thường do checkpoint sinh từ model CŨ (HighFreqWeight/freq_weight) -> phải pretrain lại bằng model mới.")
            loaded = {k: v for k, v in state.items() if own[k].shape == v.shape}
            skipped = [k for k in state if k not in loaded]
            own.update(loaded)
            self.model.load_state_dict(own)
            print(f"Pretrained: nạp {len(loaded)}/{len(own)} tensor; bỏ qua {len(skipped)} tensor khác shape "
                  f"(do số kênh đổi): {skipped}")
            print(f'Loaded pretrained model: {self.pretrained_model}')

    def vali(self, vali_loader):
        self.model.eval()

        loss = []
        with torch.no_grad():
            for i, (input_data, _) in enumerate(vali_loader):
                input = input_data.float().to(self.device)
                output = self.model(input)

                rec_loss = self.criterion(output, input)
                loss.append(rec_loss.item())

        if not loss:
            raise RuntimeError("Validation loader rỗng")
        return np.average(loss)

    def checkpoint_path(self):
        return os.path.join(self.model_save_path, f"{self.dataset}_wsize{self.win_size}_checkpoint.pth")

    def bundle_path(self):
        return os.path.join(self.model_save_path, f"{self.dataset}_wsize{self.win_size}_deploy.pt")

    def train(self):
        print("======================TRAIN MODE======================")

        start_time = time.time()
        time_now = time.time()
        path = self.model_save_path
        if not os.path.exists(path):
            os.makedirs(path)
        early_stopping = EarlyStopping(patience=self.patience, verbose=True, dataset_name=self.dataset)
        train_steps = len(self.train_loader)

        for epoch in range(self.num_epochs):
            iter_count = 0
            loss1_list = []
            bad_batches = 0

            epoch_time = time.time()
            self.model.train()
            for i, (input_data, labels) in enumerate(self.train_loader):

                self.optimizer.zero_grad()
                iter_count += 1
                input = input_data.float().to(self.device)

                output = self.model(input)       # model.train() -> dict
                loss = output["loss"]

                # Bỏ qua batch có loss NaN/Inf thay vì làm hỏng trọng số; quá nhiều thì dừng hẳn
                if not torch.isfinite(loss):
                    bad_batches += 1
                    print(f"[WARN] loss không hữu hạn ở epoch {epoch + 1}, batch {i + 1}; bỏ qua batch")
                    if bad_batches > self.MAX_BAD_BATCHES:
                        raise RuntimeError("Loss không hữu hạn liên tục; dừng train. "
                                           "Kiểm tra dữ liệu, giảm --lr hoặc đặt --grad_clip 1.0")
                    continue
                bad_batches = 0

                loss1_list.append(loss.item())

                if (i + 1) % 100 == 0:
                    speed = (time.time() - time_now) / iter_count
                    left_time = speed * ((self.num_epochs - epoch) * train_steps - i)
                    print('\tspeed: {:.4f}s/iter; left time: {:.4f}s'.format(speed, left_time))
                    iter_count = 0
                    time_now = time.time()

                loss.backward()
                if self.grad_clip and self.grad_clip > 0:
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.grad_clip)
                self.optimizer.step()
            if self.scheduler is not None:
                self.scheduler.step()

            if not loss1_list:
                raise RuntimeError(f"Epoch {epoch + 1}: không có batch hợp lệ nào")

            print("Epoch: {} cost time: {}".format(epoch + 1, time.time() - epoch_time))
            train_loss = np.average(loss1_list)

            vali_loss1 = self.vali(self.vali_loader)

            print(
                "Epoch: {0}, Steps: {1} | Train Loss: {2:.7f} Vali Loss: {3:.7f} ".format(
                    epoch + 1, train_steps, train_loss, vali_loss1))

            early_stopping(self.win_size, vali_loss1, self.model, path)

            if early_stopping.early_stop:
                print("Early stopping")
                break

        training_time = time.time() - start_time
        print(f"Total training time: {training_time:.2f}s")

        self.export_bundle()

    def export_bundle(self):
        """Nạp checkpoint tốt nhất, calibrate ngưỡng trên validation giữ lại, ghi bundle để deploy."""
        self.model.load_state_dict(
            torch.load(self.checkpoint_path(), map_location=self.device, weights_only=True))
        self.model.eval()

        ds = self.vali_loader.dataset
        detector = Detector(self.model, ds.scaler.center_, ds.scaler.scale_,
                            self.win_size, self.device)
        cal = detector.calibrate(ds.raw_val_segments, self.threshold_percentile)
        if not self.holdout_val:
            print("[WARN] holdout_val=False: validation nằm trong train nên ngưỡng có thể thấp hơn thực tế")

        data_info = {
            "sets": list(self.set_names),
            "train_lengths": [int(n) for n in self.train_lengths],
            "val_ratio": float(self.val_ratio),
            "holdout_val": bool(self.holdout_val),
        }
        out = save_bundle(self.bundle_path(), detector, self.model_config, data_info)
        print(f"Calibrated threshold = {cal['threshold']:.6f} "
              f"(p{cal['percentile']} trên {cal['n_points']} điểm validation)")
        print(f"Deploy bundle: {out}")

    def test(self):
        self.model.load_state_dict(
            torch.load(self.checkpoint_path(), map_location=self.device, weights_only=True))
        self.model.eval()

        print("======================TEST MODE (OPTIMIZING RATIO)======================")
        ds = self.train_loader.dataset
        detector = Detector(self.model, ds.scaler.center_, ds.scaler.scale_, self.win_size, self.device)

        # --- Bước 1: Energy trên train set ---
        train_energy = []
        with torch.no_grad():
            for input_data, _ in self.train_loader:
                x = input_data.float().to(self.device)
                train_energy.append(self.model.anomaly_score(x).cpu().numpy())
        train_energy = np.concatenate(train_energy, axis=0).reshape(-1)

        # --- Bước 2: Inference trên TỪNG tập test (không nối, window không băng ranh giới) ---
        energy_sets, label_sets = [], []
        inference_start = time.time()
        for name, x_raw, y in ds.test_sets:
            energy_sets.append(detector.score(x_raw))
            label_sets.append(y)
        inference_end = time.time()
        single_pass_inference_time = inference_end - inference_start

        test_energy = np.concatenate(energy_sets)
        test_labels = np.concatenate(label_sets).astype(int)
        combined_energy = np.concatenate([train_energy, test_energy], axis=0)
        gt = test_labels.copy()

        # --- Bước 3: Tìm ratio tối ưu (F1 tính bằng tsadmetrics) ---
        pw_f1_metric = PointwiseFScore(beta=1.0)
        pa_f1_metric = PointadjustedFScore(beta=1.0)

        best_no_pa = {"f1": -1, "ratio": None, "pred": None}
        best_pa = {"f1": -1, "ratio": None, "pred": None}

        for ratio in np.arange(0.1, 50.1, 0.5):
            thresh = np.percentile(combined_energy, 100 - ratio)
            pred = (test_energy > thresh).astype(int)

            f1 = pw_f1_metric.compute(gt, pred)
            if f1 > best_no_pa["f1"]:
                best_no_pa = {"f1": f1, "ratio": ratio, "pred": pred}

            f1_pa = pa_f1_metric.compute(gt, pred)
            if f1_pa > best_pa["f1"]:
                best_pa = {"f1": f1_pa, "ratio": ratio, "pred": pred}

        # Precision / Recall cho ratio tốt nhất (thư viện không có)
        pred_no_pa = best_no_pa.pop("pred")
        best_no_pa["precision"] = precision_score(gt, pred_no_pa, zero_division=0)
        best_no_pa["recall"] = recall_score(gt, pred_no_pa, zero_division=0)

        pred_pa = _point_adjust(gt, best_pa.pop("pred"))
        best_pa["precision"] = precision_score(gt, pred_pa, zero_division=0)
        best_pa["recall"] = recall_score(gt, pred_pa, zero_division=0)

        # --- Range-based & Affiliation (tại ratio tốt nhất của raw F1) ---
        range_p, range_r, range_f1 = _pr_f1_from_fbeta(
            RangebasedFScore, gt, pred_no_pa, **_RANGE_KW)
        aff_p, aff_r, aff_f1 = _pr_f1_from_fbeta(
            AffiliationbasedFScore, gt, pred_no_pa)

        # --- Bước 4: AUC & VUS (score liên tục) ---
        auc_roc = PointwiseAucRoc().compute(gt, test_energy)
        auc_pr = PointwiseAucPr().compute(gt, test_energy)
        vus_roc_val = VusRoc(window=100).compute(gt, test_energy)
        vus_pr_val = VusPr(window=100).compute(gt, test_energy)

        model_stats = self.compute_flops_and_macs()

        common_metrics = {
            'auc_roc': auc_roc,
            'auc_pr': auc_pr,
            'vus_roc': vus_roc_val,
            'vus_pr': vus_pr_val,
            'range_p': range_p, 'range_r': range_r, 'range_f1': range_f1,
            'aff_p': aff_p, 'aff_r': aff_r, 'aff_f1': aff_f1,
            'single_pass_time': single_pass_inference_time,
            'params': model_stats.get('params'),
            'macs': model_stats.get('macs'),
            'flops': model_stats.get('flops'),
            'latency_ms': model_stats.get('latency_ms'),
            'throughput_fps': model_stats.get('throughput_fps'),
            'peak_memory_mb': model_stats.get('peak_memory_mb'),
        }

        best_no_pa.update(common_metrics)
        best_pa.update(common_metrics)

        self.print_results(best_no_pa, best_pa)

        ratio_thresh = float(np.percentile(combined_energy, 100 - best_no_pa["ratio"]))
        self.print_per_set(ds.test_sets, energy_sets, ratio_thresh)

    def print_per_set(self, test_sets, energy_sets, ratio_thresh):
        """
        Kết quả theo từng tập test, ở 2 ngưỡng:
          - ratio : ngưỡng tối ưu F1 trên label (chỉ để nghiên cứu, lạc quan)
          - deploy: ngưỡng calibrate trên validation, KHÔNG dùng label -> sát thực tế production nhất
        """
        deploy_thresh = None
        if os.path.isfile(self.bundle_path()):
            bundle = torch.load(self.bundle_path(), map_location="cpu", weights_only=True)
            deploy_thresh = bundle["calibration"].get("threshold")

        def prf(gt, pred):
            p = precision_score(gt, pred, zero_division=0)
            r = recall_score(gt, pred, zero_division=0)
            return p, r, (2 * p * r / (p + r) if p + r > 0 else 0.0)

        def auc(fn, gt, e):
            return float(fn().compute(gt, e)) if 0 < gt.sum() < len(gt) else float("nan")

        header = f"{'set':<6}{'steps':>8}{'anom%':>8}{'AUC-ROC':>9}{'AUC-PR':>8}{'P@ratio':>9}{'R@ratio':>9}{'F1@ratio':>9}"
        if deploy_thresh is not None:
            header += f"{'P@deploy':>10}{'R@deploy':>10}{'F1@deploy':>10}"
        print("\n---------------- PER-SET RESULTS ----------------")
        print(header)

        rows = list(zip([n for n, _, _ in test_sets], [y for _, _, y in test_sets], energy_sets))
        rows.append(("ALL", np.concatenate([y for _, y, _ in rows]), np.concatenate([e for _, _, e in rows])))
        for name, y, e in rows:
            p1, r1, f1 = prf(y, (e > ratio_thresh).astype(int))
            line = (f"{name:<6}{len(y):>8}{y.mean() * 100:>8.2f}"
                    f"{auc(PointwiseAucRoc, y, e):>9.4f}{auc(PointwiseAucPr, y, e):>8.4f}"
                    f"{p1:>9.4f}{r1:>9.4f}{f1:>9.4f}")
            if deploy_thresh is not None:
                p2, r2, f2 = prf(y, (e > deploy_thresh).astype(int))
                line += f"{p2:>10.4f}{r2:>10.4f}{f2:>10.4f}"
            print(line)
        if deploy_thresh is not None:
            print(f"(deploy threshold = {deploy_thresh:.6f}, calibrate trên validation, không dùng label)")
        print("-------------------------------------------------\n")

    def print_results(self, res_no_pa: dict, res_pa: dict) -> None:
        # ---------------- 1. FORMATTING HELPERS ----------------
        def format_large_num(val) -> str:
            """K, M, G cho Params / MACs / FLOPs."""
            if val is None:
                return "N/A"
            for p, s in ((1e12, "T"), (1e9, "G"), (1e6, "M"), (1e3, "K")):
                if val >= p:
                    return f"{val / p:.3f} {s}"
            return f"{val:.0f}"

        def format_bytes(val) -> str:
            """Dung luong theo don vi nhi phan (KiB, MiB, GiB)."""
            if val is None:
                return "N/A"
            for p, s in ((1024 ** 3, "GiB"), (1024 ** 2, "MiB"), (1024, "KiB")):
                if val >= p:
                    return f"{val / p:.2f} {s}"
            return f"{val:.0f} B"

        def format_num(val, spec: str = ".2f", unit: str = "") -> str:
            if val is None:
                return "N/A"
            return f"{val:{spec}}" + (f" {unit}" if unit else "")

        # ---------------- 2. GET DATA ----------------
        res_no_pa = res_no_pa or {}
        res_pa = res_pa or {}
        # Cost lay tu self.cost; neu res_no_pa co cung key thi res_no_pa uu tien
        cost = {**getattr(self, "cost", {}), **res_no_pa}

        ratio_no_pa = res_no_pa.get("ratio", 0.0)
        prec_no_pa = res_no_pa.get("precision", 0.0)
        rec_no_pa = res_no_pa.get("recall", 0.0)
        f1_no_pa = res_no_pa.get("f1", 0.0)

        ratio_pa = res_pa.get("ratio", 0.0)
        prec_pa = res_pa.get("precision", 0.0)
        rec_pa = res_pa.get("recall", 0.0)
        f1_pa = res_pa.get("f1", 0.0)

        auc_roc = res_no_pa.get("auc_roc", 0.0)
        auc_pr = res_no_pa.get("auc_pr", 0.0)
        vus_roc = res_no_pa.get("vus_roc", 0.0)
        vus_pr = res_no_pa.get("vus_pr", 0.0)

        range_p = res_no_pa.get("range_p", 0.0)
        range_r = res_no_pa.get("range_r", 0.0)
        range_f1 = res_no_pa.get("range_f1", 0.0)
        aff_p = res_no_pa.get("aff_p", 0.0)
        aff_r = res_no_pa.get("aff_r", 0.0)
        aff_f1 = res_no_pa.get("aff_f1", 0.0)

        params = cost.get("params")
        trainable = cost.get("trainable_params")
        param_bytes = cost.get("param_bytes")
        buffer_bytes = cost.get("buffer_bytes")
        model_bytes = cost.get("model_bytes")
        sd_bytes = cost.get("state_dict_bytes")
        macs = cost.get("macs")
        flops = cost.get("flops")
        lat = cost.get("latency_ms")
        tp = cost.get("throughput_fps")
        mem = cost.get("peak_memory_mb")
        single_pass = res_no_pa.get("single_pass_time", 0.0)

        # ---------------- 3. PRINT ----------------
        print("\n====================== BEST RESULTS ======================")
        print("--- 1. OPTIMIZED BY RAW (NO PA) ---")
        print(f"Best Ratio : {ratio_no_pa:.1f}")
        print(f"Precision  : {prec_no_pa:.4f}")
        print(f"Recall     : {rec_no_pa:.4f}")
        print(f"F1 Score   : {f1_no_pa:.4f}\n")

        print("--- 2. OPTIMIZED BY POINT ADJUSTMENT (PA) ---")
        print(f"Best Ratio : {ratio_pa:.1f}")
        print(f"Precision  : {prec_pa:.4f}")
        print(f"Recall     : {rec_pa:.4f}")
        print(f"F1 Score   : {f1_pa:.4f}")

        print("---------------- GLOBAL METRICS ----------------")
        print(f"AUC-ROC        : {auc_roc:.4f} | AUC-PR: {auc_pr:.4f}")
        print(f"VUS-ROC        : {vus_roc:.4f} | VUS-PR: {vus_pr:.4f}")

        print("------- RANGE-BASED / AFFILIATION (at best raw ratio) -------")
        print(f"Range-P        : {range_p:.4f}")
        print(f"Range-R        : {range_r:.4f}")
        print(f"Range-F1       : {range_f1:.4f}")
        print(f"Aff-P          : {aff_p:.4f}")
        print(f"Aff-R          : {aff_r:.4f}")
        print(f"Aff-F1         : {aff_f1:.4f}")

        print("---------------- MODEL SIZE ----------------")
        print(f"Parameters     : {format_large_num(params)} ({format_num(params, ',.0f', 'params')})")
        print(f"  Trainable    : {format_num(trainable, ',.0f')}")
        print(f"Param bytes    : {format_bytes(param_bytes)} ({format_num(param_bytes, ',.0f', 'B')})")
        print(f"Buffer bytes   : {format_bytes(buffer_bytes)}")
        print(f"Total bytes    : {format_bytes(model_bytes)}")
        print(f"state_dict file: {format_bytes(sd_bytes)}")

        print("---------------- MODEL COMPLEXITY (per sample) ----------------")
        print(f"MACs           : {format_large_num(macs)} ({format_num(macs, ',.0f', 'MACs')})")
        print(f"FLOPs (2xMACs) : {format_large_num(flops)} ({format_num(flops, ',.0f', 'FLOPs')})")
        print(f"Latency        : {format_num(lat, '.2f', 'ms/batch')}")
        print(f"Throughput     : {format_num(tp, '.2f', 'sample/sec')}")
        print(f"Peak GPU Memory: {format_num(mem, '.2f', 'MiB')}")

        print("---------------- INFERENCE TIME ----------------")
        print(f"Inference Time : {single_pass:.4f} sec (Model Pass Only)")
        print("=========================================================\n")