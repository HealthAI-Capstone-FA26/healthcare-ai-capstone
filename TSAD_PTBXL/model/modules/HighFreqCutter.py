import torch
import torch.nn as nn
import torch.nn.functional as F

A_STAR = 1.2785  # nghiệm của a * sigmoid(a) = 1, tức silu(a) = 1
class HighFreqWeight(nn.Module):
    """
    rFFT -> high-pass (loại low-frequency) -> amplitude -> chuẩn hóa -> a = clamp(SiLU(relu(amp - b) / s), 0, 1)

    Trả về:
        X : rFFT của input          (B, D, F) complex
        a : anomaly score theo bin  (B, D, F), không có gradient, a in [0, 1]

    Hành vi của a theo amp (sau chuẩn hóa):
        amp <= b            -> a = 0   (normal)
        b < amp < zero_at   -> a tăng trơn từ 0 lên 1
        amp >= zero_at      -> a = 1   (nghi anomaly/nhiễu)
    Bin low-freq bị mask => amp = 0 => a = 0 (luôn coi là normal).

    Khi dùng trong loss: trọng số = (1 - a), tức normal bị kéo mạnh về input,
    anomaly bị kéo nhẹ / ngắt gradient.
    Mặc định b = 0, zero_at = 1.2785 tương đương hàm 1 - silu(amp) ban đầu.
    """
    def __init__(self, seq_len: int, b: float = 0.0, zero_at: float = A_STAR,
                 norm_amp: bool = True, eps: float = 1e-6):
        super().__init__()
        assert zero_at > b >= 0, "cần zero_at > b >= 0"
        self.b = b
        self.s = (zero_at - b) / A_STAR          # a = 1 khi relu(amp - b) / s = A_STAR
        self.norm_amp, self.eps = norm_amp, eps
        self.high_pass_cut_freq_param = nn.Parameter(
            seq_len // 4 - torch.rand(1) * 0.5, requires_grad=False)

    @torch.no_grad()
    def forward(self, x):                                   # x: (B, D, L)
        X = torch.fft.rfft(x, dim=-1, norm="ortho")         # (B, D, F)
        W = x.size(-1)
        freq = torch.fft.rfftfreq(W, d=1 / W).to(x.device)
        mask = (freq.abs() >= self.high_pass_cut_freq_param.to(x.device)).to(X.real.dtype)
        amp = (X * mask).abs()                              # (B, D, F)
        if self.norm_amp:
            n_keep = mask.sum().clamp(min=1.0)
            amp = amp / (amp.sum(dim=-1, keepdim=True) / n_keep + self.eps)
        a = F.silu(F.relu(amp - self.b) / self.s)
        return X, a, mask