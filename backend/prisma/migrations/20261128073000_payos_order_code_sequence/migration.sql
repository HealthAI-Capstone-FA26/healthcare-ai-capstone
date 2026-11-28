-- Sinh mã giao dịch PayOS (orderCode) duy nhất trực tiếp tại tầng PostgreSQL.
-- Bắt đầu từ 1000000001 (10 chữ số) để không trùng với các mã 9 chữ số cũ (Date.now().slice(-9)).
CREATE SEQUENCE IF NOT EXISTS payos_order_code_seq
  AS BIGINT
  START WITH 1000000001
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
