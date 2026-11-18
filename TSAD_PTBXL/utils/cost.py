"""
evaluation_cost.py
Do: params, bytes, MACs, FLOPs, latency, throughput, peak GPU memory.
Dung chung model_complexity.py (dat cung thu muc hoac trong package).
"""
from __future__ import annotations

import statistics
import time
from typing import Dict, Optional, Tuple

import torch
import torch.nn as nn

from utils.model_complexity import complexity, human, model_size


class EvaluationCost:
    def __init__(
        self,
        model: nn.Module,
        input_shape: Tuple[int, ...],
        device: Optional[torch.device] = None,
        warmup: int = 10,
        runs: int = 50,
        dtype: torch.dtype = torch.float32,
    ):
        self.model = model
        self.input_shape = tuple(input_shape)
        self.device = torch.device(device) if device is not None else next(model.parameters()).device
        self.warmup = warmup
        self.runs = runs
        self.dtype = dtype

    # ------------------------------------------------------------------ #
    def _dummy(self) -> torch.Tensor:
        return torch.randn(*self.input_shape, device=self.device, dtype=self.dtype)

    def _sync(self) -> None:
        if self.device.type == "cuda":
            torch.cuda.synchronize(self.device)

    @torch.no_grad()
    def _latency_and_memory(self) -> Tuple[float, float, Optional[float]]:
        x = self._dummy()
        was_training = self.model.training
        self.model.eval()
        try:
            for _ in range(self.warmup):
                self.model(x)
            self._sync()

            peak_mb = None
            if self.device.type == "cuda":
                torch.cuda.reset_peak_memory_stats(self.device)

            times = []
            for _ in range(self.runs):
                self._sync()
                t0 = time.perf_counter()
                self.model(x)
                self._sync()
                times.append(time.perf_counter() - t0)

            if self.device.type == "cuda":
                peak_mb = torch.cuda.max_memory_allocated(self.device) / 1024 ** 2
        finally:
            self.model.train(was_training)

        lat_ms = statistics.median(times) * 1000.0
        batch = self.input_shape[0]
        throughput = batch / (lat_ms / 1000.0)
        return lat_ms, throughput, peak_mb

    # ------------------------------------------------------------------ #
    def evaluate(self, verbose: bool = False) -> Dict[str, Optional[float]]:
        size = model_size(self.model, measure_state_dict=True)

        # MACs/FLOPs tinh PER-SAMPLE (da chia batch)
        cx = complexity(self.model, self._dummy())
        if cx.macs_torch is not None:
            macs, flops = cx.macs_torch, cx.flops_torch   # bao gom ca matmul/attention
        else:
            macs, flops = cx.macs_hook, cx.flops_hook

        lat_ms, tp, peak_mb = self._latency_and_memory()

        res = {
            # --- size ---
            "params": size.total_params,
            "trainable_params": size.trainable_params,
            "param_bytes": size.param_bytes,
            "buffer_bytes": size.buffer_bytes,
            "model_bytes": size.total_bytes,
            "state_dict_bytes": size.state_dict_bytes,
            # --- complexity (per sample) ---
            "macs": macs,
            "flops": flops,
            "macs_hook": cx.macs_hook,
            "flops_torch": cx.flops_torch,
            # --- speed / memory (theo batch cua input_shape) ---
            "latency_ms": lat_ms,
            "throughput_fps": tp,
            "peak_memory_mb": peak_mb,
        }

        if verbose:
            print(f"[Cost] Params {human(res['params'])} | Size {size.total_mib:.2f} MiB | "
                  f"MACs {human(macs)} | FLOPs {human(flops)} | "
                  f"Latency {lat_ms:.2f} ms | Throughput {tp:.1f} samples/s")
            if cx.flops_torch and abs(cx.flops_hook - cx.flops_torch) / cx.flops_torch > 0.01:
                print("[Cost] Luu y: hook (Conv/Linear) lech >1% so voi FlopCounterMode "
                      "-> mo hinh co matmul/attention ngoai nn.Linear; da dung ket qua FlopCounterMode.")
        return res