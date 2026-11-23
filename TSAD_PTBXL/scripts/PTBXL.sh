export CUDA_VISIBLE_DEVICES=0

# Bước 1 (PRETRAIN) của chiến lược pretrain PTB-XL -> finetune ECG -> test từng tập: xem scripts/ECG.sh.
# Chỉ bản ghi NORM của fold 1-8 để train, fold 9 để validation.
# --data_path: thư mục chứa (hoặc bao quanh) ptbxl_database.csv, scp_statements.csv, records100/.
# 12 kênh -> input_c tự lấy từ dữ liệu. win_size 100 @100Hz = 1 giây (~1 nhịp tim); --train_step 50 = window chồng 50%.
py main.py --mode train --dataset PTBXL --data_path E:/Capstone/ecg/ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.1 --sampling_rate 100 \
  --win_size 100 --train_step 50 \
  --in_channels 32 64 128 --out_channels 128 64 32 --kernel_size 3 5 7 \
  --z_dim 32 --dropout 0.1 --causal true --diff_steps 100 --beta_kl 0.01 --detach_gen false \
  --lr 5e-4 --batch_size 256 --num_epochs 50 --patience 5 --grad_clip 1.0 --seed 42 \
  --model_save_path checkpoints/ptbxl

# Đánh giá cấp bản ghi trên fold 10
py eval_ptbxl.py --bundle checkpoints/ptbxl/PTBXL_wsize100_deploy.pt --data_path E:/Capstone/ecg/ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.1 --sampling_rate 100
