import math
from model.modules.HighFreqCutter import HighFreqWeight
import torch
import torch.nn as nn
import torch.nn.functional as F
from model.modules.TCN_Block import TCNBlock


class Model(nn.Module):
    def __init__(
        self,
        input_dim: int,
        in_channels: list,
        out_channels: list,
        kernel_size: list = [3, 5, 7],
        z_dim: int = 32,
        dropout: float = 0.1,
        causal: bool = True,
        diff_steps: int = 100,
        detach_gen: bool = False,
        seq_len: int = 100,          # độ dài cửa sổ L, dùng để khởi tạo cutoff của high-pass
    ):
        super().__init__()
        self.latent_dim = len(kernel_size) * in_channels[-1]
        self.z_dim, self.diff_steps = z_dim, diff_steps
        self.detach_gen = detach_gen

        # 1. Multi-kernel TCN encoder
        self.encoder = nn.ModuleList([
            TCNBlock(input_dim=input_dim, channels=in_channels, kernel_size=int(k),
                     dropout=dropout, causal=causal, dilation=True)
            for k in kernel_size
        ])

        # 2. AE bottleneck (deterministic)
        self.to_z = nn.Conv1d(self.latent_dim, z_dim, 1)

        # 3. Decoder + head: DÙNG CHUNG cho AE và Diffusion
        self.decoder = TCNBlock(input_dim=z_dim, channels=out_channels, kernel_size=3,
                                dropout=dropout, causal=causal, dilation=True)
        self.proj_head = nn.Linear(out_channels[-1], input_dim)

        # 4. Diffusion: chỉ thêm adapter đưa x_t về không gian z_dim của decoder
        self.noisy_proj = nn.Conv1d(input_dim, z_dim, 1)
        self.t_embed = nn.Sequential(nn.Linear(z_dim, z_dim), nn.SiLU(), nn.Linear(z_dim, z_dim))
        betas = torch.linspace(1e-4, 2e-2, diff_steps)
        self.register_buffer("alpha_bar", torch.cumprod(1.0 - betas, dim=0))

        # 5. Frequency weighting
        self.freq_weight = HighFreqWeight(seq_len)

    def encode(self, x):                                    # (B, D, L) -> (B, latent_dim, L)
        return torch.cat([enc(x) for enc in self.encoder], dim=1)

    def decode(self, z):                                    # z: (B, z_dim, L) -> (B, D, L)
        h = self.decoder(z)
        return self.proj_head(h.permute(0, 2, 1)).permute(0, 2, 1)

    # ---------- AE branch ----------
    def ae_branch(self, x):
        z = self.to_z(self.encode(x))                       # (B, z_dim, L), không lấy mẫu
        return self.decode(z), z

    # ---------- Diffusion branch ----------
    def sinusoidal_t(self, t):                              # (B,) -> (B, z_dim)
        half = self.z_dim // 2
        freqs = torch.exp(-math.log(10000) * torch.arange(half, device=t.device) / half)
        args = t.float()[:, None] * freqs[None]
        emb = torch.cat([args.sin(), args.cos()], dim=-1)
        return F.pad(emb, (0, self.z_dim - emb.size(-1)))

    def q_sample(self, x0, t):
        ab = self.alpha_bar[t].view(-1, 1, 1)
        return ab.sqrt() * x0 + (1 - ab).sqrt() * torch.randn_like(x0)

    def diffusion_branch(self, x, t=None):                  # trả về x0_hat (B, D, L)
        if t is None:
            t = torch.randint(0, self.diff_steps, (x.size(0),), device=x.device)
        x_t = self.q_sample(x, t)
        z_t = self.noisy_proj(x_t) + self.t_embed(self.sinusoidal_t(t)).unsqueeze(-1)
        return self.decode(z_t)                             # dùng chung decoder + proj_head

    # ---------- Forward ----------
    def forward(self, x: torch.Tensor):
        x = x.permute(0, 2, 1)                              # (B, D, L)
        x_gen, z = self.ae_branch(x)

        if not self.training:
            return x_gen.permute(0, 2, 1)

        x_den = self.diffusion_branch(x)
        loss, parts = self.compute_loss(x, x_gen, x_den)
        return {
            "generated": x_gen.permute(0, 2, 1),
            "denoised": x_den.permute(0, 2, 1),
            "z": z,
            "loss": loss, "loss_parts": parts,
        }

    def compute_loss(self, x, x_gen, x_den):
        X, a, _ = self.freq_weight(x)                       # a: anomaly score, no grad
        w = torch.where(a <= 1.0, 1.0 - a, 1.0 / a.clamp(min=1.0))

        X_gen = torch.fft.rfft(x_gen, dim=-1, norm="ortho")
        X_den = torch.fft.rfft(x_den, dim=-1, norm="ortho")

        # 1. consistency: gen vs diffusion-denoised, trọng số = a
        X_gen_t = X_gen.detach() if self.detach_gen else X_gen
        l_cons = (a * (X_den - X_gen_t).abs().pow(2)).mean()

        # 2. reconstruction (gen vs input), trọng số = w
        l_rec = (w * (X_gen - X).abs().pow(2)).mean()

        # 3. diffusion (denoising) loss, trọng số = w
        l_diff = (w * (X_den - X).abs().pow(2)).mean()

        loss = l_cons + l_rec + l_diff
        return loss, {"cons": l_cons.detach(), "rec": l_rec.detach(),
                      "diff": l_diff.detach()}