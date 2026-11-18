import os
import argparse
import random
from torch.backends import cudnn
from utils.utils import *

from solver import Solver



def str2bool(v):
    if isinstance(v, bool):
        return v
    return v.lower() in ('true', '1', 'yes', 'y')


def main(config):
    cudnn.benchmark = True
    if not os.path.exists(config.model_save_path):
        mkdir(config.model_save_path)

    solver = Solver(vars(config))

    if config.mode == 'train':
        solver.train()
    elif config.mode == 'test':
        solver.test()

    return solver


if __name__ == '__main__':
    parser = argparse.ArgumentParser()

    parser.add_argument('--device', type=str, default="cuda")
    # ---------------- Training ----------------
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--lr', type=float, default=1e-4)
    parser.add_argument('--num_epochs', type=int, default=10)
    parser.add_argument('--batch_size', type=int, default=256)
    parser.add_argument('--patience', type=int, default=5,
                        help='Early stopping: số epoch không cải thiện validation loss')
    parser.add_argument('--grad_clip', type=float, default=0.0,
                        help='Gradient clipping theo norm (0 = tắt)')
    parser.add_argument('--pretrained_model', type=str, default=None)
    parser.add_argument(
        "--scheduler",
        type=str,
        default=None,
        choices=["cosine_restart", "cosine", "step"],
        help="Strategy for learning rate scheduler (cosine_restart, cosine, step, or None)",
    )

    # ---------------- Data ----------------
    parser.add_argument('--dataset', type=str, default='ECG', choices=['ECG', 'PTBXL'],
                        help='ECG: 6 tập ECG_A..F; PTBXL: train thẳng trên PTB-XL (12 kênh, chỉ bản ghi NORM)')
    parser.add_argument('--data_path', type=str, default='./dataset')
    parser.add_argument('--win_size', type=int, default=100,
                        help='Độ dài sample/window')
    parser.add_argument('--input_c', type=int, default=None,
                        help='Số kênh; mặc định tự lấy từ dữ liệu (nếu đặt mà sai sẽ báo lỗi)')
    parser.add_argument('--output_c', type=int, default=None)
    parser.add_argument('--val_ratio', type=float, default=0.2,
                        help='Tỉ lệ đuôi của MỖI tập ECG dùng làm validation')
    parser.add_argument('--holdout_val', type=str2bool, default=True,
                        help='true: validation tách khỏi train, scaler chỉ fit trên phần train; '
                             'false: hành vi cũ (val nằm trong train)')
    parser.add_argument('--threshold_percentile', type=float, default=92.5,
                        help='Ngưỡng deploy = percentile này của điểm trên validation (không dùng label)')

    parser.add_argument('--sampling_rate', type=int, default=100, choices=[100, 500],
                        help='PTBXL: dùng records100 hay records500')
    parser.add_argument('--train_step', type=int, default=None,
                        help='Bước giữa các window (ECG mặc định 1; PTBXL mặc định win_size//2)')

    # ---------------- Mode / IO ----------------
    parser.add_argument('--mode', type=str, default='train', choices=['train', 'test'])
    parser.add_argument('--model_save_path', type=str, default='checkpoints')

    # ---------------- TCN Encoder / Decoder ----------------
    parser.add_argument('--in_channels', type=int, nargs='+', default=[32, 64, 128],
                        help='Channels của từng TCN block trong encoder')
    parser.add_argument('--out_channels', type=int, nargs='+', default=[128, 64, 32],
                        help='Channels của từng TCN block trong decoder (dùng chung VAE + diffusion)')
    parser.add_argument('--kernel_size', type=int, nargs='+', default=[3, 5, 7],
                        help='Các kernel của encoder (Inception-style)')
    parser.add_argument('--dropout', type=float, default=0.1)
    parser.add_argument('--causal', type=str2bool, default=True)

    # # ---------------- SOCA ---------------
    # parser.add_argument('--cond_dim', type=int, default=64)
    # parser.add_argument('--cond_drop', type=float, default=0.3)

    # ---------------- VAE ----------------
    parser.add_argument('--z_dim', type=int, default=32)
    parser.add_argument('--beta_kl', type=float, default=5e-2)

    # ---------------- Diffusion ----------------
    parser.add_argument('--diff_steps', type=int, default=100)

    # ---------------- Loss weights ----------------
    # parser.add_argument('--lambda_cons', type=float, default=1.0,
    #                     help='Consistency: MSE(denoised, generated)')
    parser.add_argument('--detach_gen', type=str2bool, default=False,
                        help='Stop-gradient nhánh VAE trong loss consistency')

    config = parser.parse_args()
    set_seed(config.seed)

    args = vars(config)
    print('------------ Options -------------')
    for k, v in sorted(args.items()):
        print('%s: %s' % (str(k), str(v)))
    print('-------------- End ----------------')

    main(config)