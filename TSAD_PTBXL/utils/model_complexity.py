"""
model_complexity.py
===================
Tinh kich thuoc va do phuc tap cua mo hinh PyTorch.

1. MODEL SIZE
   - So tham so (params): tong / trainable / frozen.
   - Dung luong (Bytes): sum(numel * element_size) theo dtype thuc te,
     tinh rieng parameters va buffers (vd: BN running_mean/var).
   - Tham so dung chung (weight tying) chi tinh 1 lan.

2. COMPLEXITY (MACs, FLOPs)
   Quy uoc (theo ResNet - He et al., CVPR 2016; Molchanov et al., ICLR 2017):
       1 MAC = 1 phep nhan + 1 phep cong tich luy
       FLOPs ~= 2 x MACs   (cho conv / linear / matmul)
   Hai phuong phap, dung de doi chieu nhau:
     (A) Hook theo cong thuc giai tich cho Conv/ConvTranspose/Linear.
     (B) torch.utils.flop_counter.FlopCounterMode (thu vien chinh thuc cua
         PyTorch, bat duoc ca conv, mm, bmm, addmm, scaled_dot_product_attention).

   Khong tinh: BN, ReLU, pooling, softmax, bias-add... (chiem ty trong rat nho,
   cung la quy uoc cua fvcore / FlopCounterMode / hau het bai bao CNN).
   Mac dinh bao cao tren MOT mau (per-sample).
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple, Union

import torch
import torch.nn as nn
from torch.nn.modules.conv import _ConvNd

try:  # PyTorch >= 2.1
    from torch.utils.flop_counter import FlopCounterMode
except ImportError:  # pragma: no cover
    FlopCounterMode = None


# --------------------------------------------------------------------------- #
# 1. MODEL SIZE
# --------------------------------------------------------------------------- #
@dataclass
class ModelSize:
    total_params: int
    trainable_params: int
    frozen_params: int
    buffer_elems: int
    param_bytes: int
    buffer_bytes: int
    state_dict_bytes: Optional[int] = None  # kich thuoc thuc khi torch.save

    @property
    def total_bytes(self) -> int:
        return self.param_bytes + self.buffer_bytes

    @property
    def total_mib(self) -> float:
        return self.total_bytes / 1024 ** 2


def model_size(model: nn.Module, measure_state_dict: bool = False) -> ModelSize:
    # parameters()/buffers() mac dinh loai bo tensor trung lap (shared weights)
    params = [p for p in model.parameters()]
    buffers = [b for b in model.buffers()]

    total = sum(p.numel() for p in params)
    trainable = sum(p.numel() for p in params if p.requires_grad)

    sd_bytes = None
    if measure_state_dict:
        buf = io.BytesIO()
        torch.save(model.state_dict(), buf)
        sd_bytes = buf.getbuffer().nbytes

    return ModelSize(
        total_params=total,
        trainable_params=trainable,
        frozen_params=total - trainable,
        buffer_elems=sum(b.numel() for b in buffers),
        param_bytes=sum(p.numel() * p.element_size() for p in params),
        buffer_bytes=sum(b.numel() * b.element_size() for b in buffers),
        state_dict_bytes=sd_bytes,
    )


# --------------------------------------------------------------------------- #
# 2A. MACs bang hook (cong thuc giai tich)
# --------------------------------------------------------------------------- #
def macs_conv(m: _ConvNd, x: torch.Tensor, y: torch.Tensor) -> int:
    """
    Conv thuong : MACs = |y| * (Cin / groups) * prod(kernel)
                  (|y| = N * Cout * prod(out_spatial))
    ConvTranspose: MACs = |x| * (Cout / groups) * prod(kernel)
    """
    k = math.prod(m.kernel_size)
    if m.transposed:
        return x.numel() * (m.out_channels // m.groups) * k
    return y.numel() * (m.in_channels // m.groups) * k


def macs_linear(m: nn.Linear, x: torch.Tensor, y: torch.Tensor) -> int:
    """MACs = |y| * in_features (|y| gom ca cac chieu dau, vd seq_len)."""
    return y.numel() * m.in_features


_HOOKED = ((_ConvNd, macs_conv), (nn.Linear, macs_linear))


def _hook_macs(model: nn.Module, inputs) -> Tuple[int, Dict[str, int]]:
    per_layer: Dict[str, int] = {}
    handles = []

    def make_hook(name, fn):
        def hook(m, args, out):
            per_layer[name] = per_layer.get(name, 0) + int(fn(m, args[0], out))
        return hook

    for name, m in model.named_modules():
        for cls, fn in _HOOKED:
            if isinstance(m, cls):
                handles.append(m.register_forward_hook(make_hook(name, fn)))
                break
    try:
        model(*inputs)
    finally:
        for h in handles:
            h.remove()
    return sum(per_layer.values()), per_layer


# --------------------------------------------------------------------------- #
# 2B. FLOPs bang FlopCounterMode (PyTorch chinh thuc)
# --------------------------------------------------------------------------- #
def _torch_flops(model: nn.Module, inputs) -> Optional[int]:
    if FlopCounterMode is None:
        return None
    with FlopCounterMode(display=False) as fc:
        model(*inputs)
    return int(fc.get_total_flops())


# --------------------------------------------------------------------------- #
# API chinh
# --------------------------------------------------------------------------- #
@dataclass
class Complexity:
    macs_hook: int                       # per-sample
    flops_hook: int                      # = 2 * macs_hook
    flops_torch: Optional[int]           # per-sample, FlopCounterMode
    macs_torch: Optional[int]            # = flops_torch / 2
    per_layer_macs: Dict[str, int] = field(default_factory=dict)


@torch.no_grad()
def complexity(model: nn.Module, *inputs: torch.Tensor) -> Complexity:
    """inputs: tensor(s) co chieu batch o dau (nen dung batch=1)."""
    batch = inputs[0].shape[0] if inputs and torch.is_tensor(inputs[0]) else 1
    was_training = model.training
    model.eval()
    try:
        macs, per_layer = _hook_macs(model, inputs)
        flops_t = _torch_flops(model, inputs)
    finally:
        model.train(was_training)

    return Complexity(
        macs_hook=macs // batch,
        flops_hook=2 * macs // batch,
        flops_torch=None if flops_t is None else flops_t // batch,
        macs_torch=None if flops_t is None else flops_t // (2 * batch),
        per_layer_macs={k: v // batch for k, v in per_layer.items()},
    )


def human(n: Union[int, float], unit: str = "") -> str:
    for p, s in ((1e12, "T"), (1e9, "G"), (1e6, "M"), (1e3, "K")):
        if abs(n) >= p:
            return f"{n / p:.3f} {s}{unit}"
    return f"{n:.0f} {unit}"


def report(model: nn.Module, *inputs: torch.Tensor) -> None:
    s = model_size(model, measure_state_dict=True)
    c = complexity(model, *inputs)
    print("=== MODEL SIZE ===")
    print(f"Params total     : {s.total_params:,} ({human(s.total_params)})")
    print(f"  trainable      : {s.trainable_params:,}")
    print(f"  frozen         : {s.frozen_params:,}")
    print(f"Param bytes      : {s.param_bytes:,} B ({s.param_bytes / 1024**2:.2f} MiB)")
    print(f"Buffer bytes     : {s.buffer_bytes:,} B")
    print(f"Total bytes      : {s.total_bytes:,} B ({s.total_mib:.2f} MiB)")
    print(f"state_dict file  : {s.state_dict_bytes:,} B")
    print("=== COMPLEXITY (per sample) ===")
    print(f"MACs  (hook)     : {c.macs_hook:,} ({human(c.macs_hook, 'MACs')})")
    print(f"FLOPs (hook,2xMAC): {c.flops_hook:,} ({human(c.flops_hook, 'FLOPs')})")
    if c.flops_torch is not None:
        print(f"FLOPs (torch)    : {c.flops_torch:,} ({human(c.flops_torch, 'FLOPs')})")
        print(f"MACs  (torch)    : {c.macs_torch:,} ({human(c.macs_torch, 'MACs')})")
        if c.flops_hook:
            diff = abs(c.flops_hook - c.flops_torch) / c.flops_torch * 100
            print(f"Chenh lech hook vs torch: {diff:.2f}%  "
                  "(>0 neu mo hinh co attention/matmul ngoai nn.Linear/Conv)")


if __name__ == "__main__":
    import torchvision

    net = torchvision.models.resnet50()
    report(net, torch.randn(1, 3, 224, 224))