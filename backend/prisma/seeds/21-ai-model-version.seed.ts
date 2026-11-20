import { PrismaService } from 'prisma/prisma.service';

/**
 * Registry model AI cho phân tích bất thường ECG (AiModelVersion). EcgAnalysisService.enqueue() chỉ chạy khi có ít nhất
 * 1 dòng status = 'active' cho taskType 'ecg_anomaly_detection'; nếu không, mọi bản ghi ECG bị bỏ qua phân tích.
 *
 * Seed mặc định đúng 1 model: TCN-VAE-Diffusion (pretrain PTB-XL -> finetune ECG_A..F, 2 kênh), triển khai bởi dịch vụ
 * Python TSAD_PTBXL/service (POST /v1/ecg/analyze). Idempotent (upsert theo [modelName, version]); chạy lại KHÔNG ghi đè
 * status/deployedAt đã chỉnh tay, chỉ bổ sung nếu dòng chưa tồn tại.
 *
 * defaultThreshold = 0.5 nằm trên thang ĐÃ CHUẨN HOÁ của dịch vụ AI: norm = clip(điểm_thô / (2 × ngưỡng_bundle), 0, 1), nên
 * 0.5 ≡ đúng ngưỡng calibrate trong bundle (xem service/postprocess.py). Phát hiện là nhị phân theo step (1/0).
 * Muốn đổi bundle/ngưỡng: train + calibrate lại rồi tạo version mới (vd. 1.1.0) và chuyển status — không sửa dòng cũ.
 *
 * Phụ thuộc: không (bảng độc lập) — tiền tố "21-" để chạy sau các seed danh mục.
 */
export async function seedAiModelVersion(prisma: PrismaService): Promise<void> {
    const modelName = 'ecg-tcn-vae-diffusion';
    const version = '1.0.0';

    const existing = await prisma.aiModelVersion.findUnique({ where: { modelName_version: { modelName, version } } });
    if (existing) {
        console.log(`AiModelVersion ${modelName}@${version} đã tồn tại (status=${existing.status}) — giữ nguyên.`);
        return;
    }

    await prisma.aiModelVersion.create({
        data: {
            modelName,
            version,
            taskType: 'ecg_anomaly_detection',
            architecture: 'TCN-VAE + Diffusion (unsupervised reconstruction)',
            inputSpec: {
                numLeads: 2,
                winSizeSteps: 100,
                signalFormats: ['csv', 'json'],
                note: 'Mỗi dòng tệp = 1 step (không resample); windowMs/strideMs do dịch vụ AI suy ra từ sampleRateHz của bản ghi.',
            },
            defaultThreshold: 0.5,
            artifactUrl: 'checkpoints/ECG_wsize100_deploy.pt',
            status: 'active',
            deployedAt: new Date(),
        },
    });
    console.log(`Đã seed AiModelVersion ${modelName}@${version} (active).`);
}
