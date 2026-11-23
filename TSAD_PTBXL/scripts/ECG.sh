export CUDA_VISIBLE_DEVICES=0

# ====================== CHIẾN LƯỢC: pretrain PTB-XL -> finetune ECG_A..F gộp -> test từng tập ======================
# Model dùng: model/TCN_VAE_Diff.py (bản version_capstone: loss MSE, score = alpha*e_rec + (1-alpha)*e_diff).
# Hai bước dùng CÙNG kiến trúc (in/out_channels, kernel_size, z_dim, diff_steps). PTB-XL 12 kênh -> ECG 2 kênh: solver chỉ nạp các tensor cùng shape,
# các lớp phụ thuộc số kênh (conv đầu encoder, noisy_proj, proj_head) khởi tạo lại. Checkpoint model CŨ (HighFreqWeight) bị từ chối -> phải chạy lại bước 1.

# ---- Bước 1: PRETRAIN trên PTB-XL (chỉ bản ghi NORM; fold 1-8 train, fold 9 val) ----
# Ghi checkpoints/ptbxl/PTBXL_wsize100_checkpoint.pth  (+ PTBXL_wsize100_deploy.pt, chỉ dùng để eval_ptbxl.py)
# bash scripts/PTBXL.sh   # hoặc chạy lệnh dưới
py main.py --mode train --dataset PTBXL --data_path E:/Capstone/ecg/ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.1 --sampling_rate 100 \
  --win_size 100 --train_step 50 \
  --in_channels 32 64 128 --out_channels 128 64 32 --kernel_size 3 5 7 \
  --z_dim 32 --dropout 0.1 --causal true --diff_steps 100 --beta_kl 0.01 --detach_gen false \
  --lr 5e-4 --batch_size 256 --num_epochs 50 --patience 5 --grad_clip 1.0 --seed 42 \
  --model_save_path checkpoints/ptbxl

# ---- Bước 2: FINETUNE trên ECG_A..F gộp theo thời gian (input_c tự lấy từ dữ liệu) ----
# Khởi tạo từ checkpoint bước 1. Kết thúc train ghi checkpoints/ECG_wsize100_deploy.pt (model + scaler + ngưỡng).
py main.py --mode train --dataset ECG --data_path dataset --win_size 100 \
  --pretrained_model checkpoints/ptbxl/PTBXL_wsize100_checkpoint.pth \
  --in_channels 32 64 128 --out_channels 128 64 32 --kernel_size 3 5 7 \
  --z_dim 32 --dropout 0.1 --causal true --diff_steps 100 --beta_kl 0.01 --detach_gen false \
  --lr 1e-4 --batch_size 256 --num_epochs 50 --patience 5 --grad_clip 1.0 --seed 42 \
  --val_ratio 0.3 --holdout_val true --threshold_percentile 97.5

# ---- Bước 3: TEST trên từng tập ECG riêng (cần dataset/ECG_x/ECG_test.npy và ECG_test_label.npy) ----
# Bảng PER-SET RESULTS in ra ở cuối.
# py main.py --mode test --dataset ECG --data_path dataset --win_size 100 \
#   --in_channels 32 64 128 --out_channels 128 64 32 --kernel_size 3 5 7 \
#   --z_dim 32 --dropout 0.1 --causal true --diff_steps 100 --beta_kl 0.01 --detach_gen false

# Suy luận production + đánh giá (ngưỡng calibrate trên validation, không dùng label):
# py predict.py --bundle checkpoints/ECG_wsize100_deploy.pt --data_path dataset
# py predict.py --bundle checkpoints/ECG_wsize100_deploy.pt --input signal.npy
#
# Bundle calibrate ở percentile khác -> tạo bundle p92.5 mà không cần train lại:
# py recalibrate.py --bundle checkpoints/ECG_wsize100_deploy.pt --data_path dataset --val_frac 0.2 --percentile 92.5 \
#   --out checkpoints/ECG_wsize100_deploy_p92.5.pt
