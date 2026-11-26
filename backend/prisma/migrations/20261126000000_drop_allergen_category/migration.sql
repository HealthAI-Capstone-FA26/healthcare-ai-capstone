-- Bỏ nhóm allergen: không có nguồn chính thức cho mapping thuốc -> nhóm.
ALTER TABLE "drug_catalog" DROP COLUMN IF EXISTS "allergen_category_id";
DROP TABLE IF EXISTS "allergen_categories";
