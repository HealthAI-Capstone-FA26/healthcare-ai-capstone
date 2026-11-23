import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { getStreamMaxUploadBytes } from './ecg-stream.config';

/**
 * Nâng giới hạn kích thước 1 message Socket.IO để nhận được tệp ECG upload qua socket (mặc định của Socket.IO chỉ 1MB).
 * PHẢI đặt ở adapter: Nest chỉ dùng option của gateway ĐẦU TIÊN để tạo server, các namespace sau dùng chung server đó nên
 * `maxHttpBufferSize` khai báo trong @WebSocketGateway của riêng '/ecg-stream' sẽ bị bỏ qua.
 * Lưu ý: giới hạn áp dụng cho MỌI namespace (kể cả '/queue-display' không cần đăng nhập).
 */
export class EcgStreamIoAdapter extends IoAdapter {
    createIOServer(port: number, options?: ServerOptions) {
        // + 64KB cho phần metadata JSON đi kèm tệp.
        return super.createIOServer(port, { ...options, maxHttpBufferSize: getStreamMaxUploadBytes() + 64 * 1024 });
    }
}
