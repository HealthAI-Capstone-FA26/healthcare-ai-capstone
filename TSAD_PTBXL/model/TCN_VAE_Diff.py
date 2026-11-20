import math
# from model.modules.HighFreqCutter import AnomalyGate
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
        dataset: str = None,          # chỉ để tương thích version_capstone; model không dùng. Bundle deploy không lưu khóa này
        kernel_size: list = [3, 5, 7],
        z_dim: int = 32,
        dropout: float = 0.1,
        causal: bool = True,
        diff_steps: int = 100,
        beta_kl: float = 1e-2,
        detach_gen: bool = False,
        seq_len: int = 100,          # độ dài cửa sổ L, dùng để khởi tạo cutoff của high-pass,
    ):
        super().__init__()
        self.latent_dim = len(kernel_size) * in_channels[-1]
        self.z_dim, self.diff_steps = z_dim, diff_steps
        self.beta_kl = beta_kl
        self.detach_gen = detach_gen

        # self.freq_gate = AnomalyGate()

        # 1. Multi-kernel TCN encoder
        self.encoder = nn.ModuleList([
            TCNBlock(input_dim=input_dim, channels=in_channels, kernel_size=int(k),
                     dropout=dropout, causal=causal, dilation=True)
            for k in kernel_size
        ])

        # 2. VAE bottleneck
        self.to_mu = nn.Conv1d(self.latent_dim, z_dim, 1)
        self.to_logvar = nn.Conv1d(self.latent_dim, z_dim, 1)

        # 3. Decoder + head: DÙNG CHUNG cho VAE và Diffusion
        self.decoder = TCNBlock(input_dim=z_dim, channels=out_channels, kernel_size=3,
                                dropout=dropout, causal=causal, dilation=True)
        self.proj_head = nn.Linear(out_channels[-1], input_dim)

        # 4. Diffusion: chỉ thêm adapter đưa x_t về không gian z_dim của decoder
        self.noisy_proj = nn.Conv1d(input_dim, z_dim, 1)
        self.t_embed = nn.Sequential(nn.Linear(z_dim, z_dim), nn.SiLU(), nn.Linear(z_dim, z_dim))
        betas = torch.linspace(1e-4, 2e-2, diff_steps)
        self.register_buffer("alpha_bar", torch.cumprod(1.0 - betas, dim=0))

    def encode(self, x):                                    # (B, D, L) -> (B, latent_dim, L)
        return torch.cat([enc(x) for enc in self.encoder], dim=1)

    def embed(self, x):                                     # (B, D, L) -> (B, 2*proj_dim)
        h = self.con_mlp(x.permute(0, 2, 1))                # (B, L, proj_dim), MLP shared theo timestep
        h = torch.cat([h.mean(1), h.std(1)], dim=-1)        # stats pooling -> 1 vector/sample
        return F.normalize(h, dim=-1)

    def decode(self, z):                                    # z: (B, z_dim, L) -> (B, D, L)
            h = self.decoder(z)
            return self.proj_head(h.permute(0, 2, 1)).permute(0, 2, 1)

    def vae_branch(self, x):
        lat = self.encode(x)
        mu = self.to_mu(lat)
        if not self.training:
            return self.decode(mu), mu, None
        logvar = self.to_logvar(lat).clamp(-10, 10)
        z = mu + torch.randn_like(mu) * (0.5 * logvar).exp()
        return self.decode(z), mu, logvar

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
        x_gen, mu, logvar = self.vae_branch(x)

        if not self.training:
            return x_gen.permute(0, 2, 1)

        x_den = self.diffusion_branch(x)
        loss, parts = self.compute_loss(x, x_gen, x_den, mu, logvar)
        # loss, parts = self.compute_loss(x, x_gen, x_den, mu, logvar, lat)
        return {
            "generated": x_gen.permute(0, 2, 1),
            "denoised": x_den.permute(0, 2, 1),
            "mu": mu, "logvar": logvar,
            "loss": loss, "loss_parts": parts,
        }
    
    def compute_loss(self, x, x_gen, x_den, mu, logvar):
        ## Main version
        # ctx = self.freq_gate.prepare(x)                      # Haar + FFT + w, no grad, tính một lần
        # l_rec, rec_trend, rec_trans = self.freq_gate.loss_from(ctx, x_gen)
        # l_diff, den_trend, den_trans = self.freq_gate.loss_from(ctx, x_den)

        # --- [ABLATION] change by MSE ---
        l_rec = F.mse_loss(x_gen, x)
        l_diff = F.mse_loss(x_den, x)
        zero = x.new_zeros(())                             # giữ key log để training loop không lỗi
        rec_trend = rec_trans = den_trend = den_trans = zero

        l_kl = -0.5 * torch.mean(1 + logvar - mu.pow(2) - logvar.exp())

        loss = l_rec + l_diff + self.beta_kl * l_kl
        return loss, {"rec": l_rec.detach(), "diff": l_diff.detach(), "kl": l_kl.detach(),
                      "rec_trend": rec_trend, "rec_trans": rec_trans,
                      "den_trend": den_trend, "den_trans": den_trans}

    @torch.no_grad()
    def anomaly_score(self, x, alpha=0.5, t_eval=None, n_draws=4, use_freq=False):
        """x: (B, L, D) -> (B, L)"""
        # assert not self.freq_gate.training, "gọi model.eval() trước khi tính score"
        assert not self.training, "gọi model.eval() trước khi tính score"
        x = x.permute(0, 2, 1)                               # (B, D, L)
        # ctx = self.freq_gate.prepare(x)                      # eval: không cập nhật thống kê

        x_vae, _, _ = self.vae_branch(x)
        t_eval = self.diff_steps // 10 if t_eval is None else t_eval
        t = torch.full((x.size(0),), t_eval, device=x.device, dtype=torch.long)
        x_den = torch.stack([self.diffusion_branch(x, t) for _ in range(n_draws)]).mean(0)

        # if use_freq:
        #     e_rec = self.freq_gate.score_map(ctx, x_vae)
        #     e_diff = self.freq_gate.score_map(ctx, x_den)
        # else:                                                # ablation: gain = 1 (MSE thời gian thuần)
        #     e_rec = (x - x_vae).pow(2).mean(1)
        #     e_diff = (x - x_den).pow(2).mean(1)

        e_rec = (x - x_vae).pow(2).mean(1)
        e_diff = (x - x_den).pow(2).mean(1)
        return alpha * e_rec + (1 - alpha) * e_diff