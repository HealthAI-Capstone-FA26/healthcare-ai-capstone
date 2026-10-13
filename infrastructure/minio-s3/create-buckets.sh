#!/bin/sh
# Chờ MinIO Server khởi động hoàn toàn
sleep 5;

# Kết nối tới MinIO Server (Dùng tên service 'minio' trong mạng Docker)
/usr/bin/mc alias set myminio http://minio:9000 minioadmin 12345678;

# Tạo bucket tự động nếu chưa có
/usr/bin/mc mb --ignore-existing myminio/healthcare-bucket;

# Phân quyền tải xuống công khai cho thư mục /processed (nếu cần)
/usr/bin/mc anonymous set download myminio/healthcare-bucket/processed;

exit 0;