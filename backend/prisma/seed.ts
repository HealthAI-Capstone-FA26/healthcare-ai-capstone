import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

// Prisma 7 bắt buộc phải truyền driver adapter khi khởi tạo PrismaClient (không còn tự dùng
// query-engine binary theo connection string mặc định nữa) — PHẢI khởi tạo giống hệt cách
// PrismaService (prisma/prisma.service.ts) đang làm, nếu không sẽ gặp lỗi:
// "PrismaClient was instantiated without any options. A driver adapter is required...".
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not defined. Please add it to your .env file.');
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Bắt đầu quá trình tự động Seed tất cả các file...');

  const seedsDir = path.join(__dirname, 'seeds');

  if (!fs.existsSync(seedsDir)) {
    console.error(`Thư mục không tồn tại: ${seedsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(seedsDir);

  // QUAN TRỌNG: fs.readdirSync() KHÔNG đảm bảo trả về theo thứ tự bảng chữ cái — thứ tự phụ
  // thuộc filesystem/OS (đã thực tế gặp lỗi do thứ tự sai trên Windows, dù các seed đã được
  // đặt tên với tiền tố số 01-, 02-, ... theo đúng chuỗi phụ thuộc). Vì vậy PHẢI tự sort() rõ
  // ràng ở đây, không được tin vào thứ tự trả về của readdirSync.
  //
  // Quy ước tiền tố số (xem comment đầu mỗi file *.seed.ts để biết lý do thứ tự):
  //   01 role -> 02 permission -> 03 department -> 04 consent-policy -> 05 lab-room ->
  //   06 test-catalog -> 07 lab-result-parameter -> 08 vital-sign-item ->
  //   09 vital-sign-threshold -> 10 icd10 -> 20 lab-parameter-threshold ->
  //   70 diagnosis-test-recommendation.
  // Khi thêm seed mới, đặt tên theo dạng "<NN>-ten-bang.seed.ts" với NN lớn hơn số của mọi
  // seed mà nó phụ thuộc (để dành khoảng trống chèn seed mới ở giữa mà không phải đổi tên
  // hàng loạt, không nhất thiết phải liền số).
  const seedFiles = files
    .filter(
      (file) =>
        (file.endsWith('.seed.ts') || file.endsWith('.seed.js')) &&
        !file.startsWith('.'),
    )
    .sort((a, b) => a.localeCompare(b, 'en'));

  console.log(`Tìm thấy ${seedFiles.length} file seed (theo thứ tự sẽ chạy):`, seedFiles);

  for (const file of seedFiles) {
    const filePath = path.join(seedsDir, file);

    console.log(`Đang thực thi: ${file}`);

    try {
      // LƯU Ý: dự án này biên dịch theo CommonJS (tsconfig.json: "module": "commonjs", không có
      // "type": "module" trong package.json). Với cấu hình đó, ts-node/TypeScript hạ cấp cú pháp
      // import() xuống thành require() ở runtime — mà require() KHÔNG hiểu URL dạng "file://...",
      // nó cần đường dẫn hệ thống file bình thường (kể cả đường dẫn tuyệt đối kiểu Windows
      // "D:\...\seeds\xxx.seed.ts" là hợp lệ với require()). Vì vậy truyền thẳng filePath, KHÔNG
      // qua pathToFileURL() — làm vậy sẽ lỗi "Cannot find module 'file:///D:/...'" (đã gặp thực tế).
      // (Nếu sau này đổi dự án sang ESM thuần — package.json có "type": "module" — thì mới cần
      // pathToFileURL() để import() hoạt động đúng trên Windows.)
      const seedModule = await import(filePath);

      const seedFunc =
        seedModule.default ||
        seedModule.seed ||
        Object.values(seedModule).find(
          (exp) => typeof exp === 'function',
        );

      if (typeof seedFunc === 'function') {
        await seedFunc(prisma);
        console.log(`Hoàn thành: ${file}`);
      } else {
        console.warn(
          `Bỏ qua ${file}: Không tìm thấy function seed được export!`,
        );
      }
    } catch (error) {
      console.error(`Lỗi khi chạy seed file ${file}:`, error);
      throw error;
    }
  }

  console.log('Đã chạy xong tất cả các file seed!');
}

main()
  .catch((e) => {
    console.error('Lỗi quá trình Seed tổng:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
