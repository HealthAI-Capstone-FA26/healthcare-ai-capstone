Các folder được triển khai như sau:

- adapters: nơi thay đổi nguồn input cho research và production
- checkpoints: nơi chứa checkpoint sau khi train
- core: phần kiến trúc tổng quát, không phụ thuộc vào nguồn input
- docs: nơi ghi chú nội dung của dự án rag-diagnosis
- training/evaluation: folder đại diện cho quá trình training và evaluation của mô hình
- scripts: phục vụ cho setup, đóng gói và triển khai
- service: triển khai FastAPI cho production, để các module khác kết nối, fetch về
- tests: kiểm tra hiệu suất đầu ra xem ok để production chưa

Các files bổ trợ:

- pyproject.toml: file cấu hình chuẩn để chạy tài nguyên, thư viện,...
- .env.example: mẫu của env để triển khai, gọi biến bảo mật
- .env: bản thực tế của .env.example
- README.md: Tất tần tật mọi thứ có thể chi tiết
