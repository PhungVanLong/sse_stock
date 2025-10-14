// =================================================================
// 1. IMPORT CÁC THƯ VIỆN
// =================================================================
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch'; // Để gọi API lấy dữ liệu

// =================================================================
// 2. KHỞI TẠO ỨNG DỤNG EXPRESS
// =================================================================
const app = express();
const PORT = 5001; // Chạy trên một cổng khác để tránh xung đột với server Python

// Cấu hình CORS để cho phép mọi kết nối
app.use(cors());

// =================================================================
// 3. HÀM HỖ TRỢ LẤY DỮ LIỆU
// =================================================================

/**
 * Gọi đến API Flask/Python đã tạo để lấy giá của nhiều mã cổ phiếu.
 * @param {string[]} symbols - Mảng các mã cổ phiếu, ví dụ ['ACB', 'FPT'].
 * @returns {Promise<object>} - Một object chứa dữ liệu giá.
 */
// Trước khi sửa:
// const apiUrl = `http://localhost:5000/api/stocks/price?symbols=${symbols.join(',')}`;

// SAU KHI SỬA:
async function fetchStockPrices(symbols) {
    // Lấy URL của Python API từ biến môi trường, có giá trị dự phòng cho local dev
    const pythonApiUrl = process.env.PYTHON_API_URL || `http://localhost:5000`;
    const apiUrl = `${pythonApiUrl}/api/stocks/price?symbols=${symbols.join(',')}`;

    console.log(`Đang gọi API: ${apiUrl}`);

    try {
        // ... phần còn lại của hàm giữ nguyên
        const response = await fetch(apiUrl);
        if (!response.ok) {
            console.error(`Lỗi khi gọi API Python: ${response.statusText}`);
            return { error: `API Python trả về lỗi: ${response.statusText}` };
        }
        const data = await response.json();
        return data.data || {};
    } catch (error) {
        console.error('Không thể kết nối đến server Python lấy dữ liệu.', error);
        return { error: 'Không thể kết nối đến server Python.' };
    }
}
// =================================================================
// 4. ENDPOINT SSE CHÍNH
// =================================================================
app.get('/stream-prices', (req, res) => {
    // Lấy danh sách mã từ query parameter
    const { symbols } = req.query;
    if (!symbols) {
        return res.status(400).json({ error: 'Vui lòng cung cấp mã cổ phiếu qua query "symbols".' });
    }
    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());

    // Bước 1: Thiết lập headers cho SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Gửi headers ngay lập tức cho client

    console.log(`Client đã kết nối để stream mã: ${symbolList.join(', ')}`);

    // Bước 2: Gửi dữ liệu định kỳ
    const intervalId = setInterval(async () => {
        const priceData = await fetchStockPrices(symbolList);

        // Format dữ liệu theo chuẩn SSE: "data: <json_string>\n\n"
        res.write(`data: ${JSON.stringify(priceData)}\n\n`);
    }, 5000); // Cập nhật mỗi 5 giây

    // Bước 3: Xử lý khi client ngắt kết nối
    req.on('close', () => {
        console.log('Client đã ngắt kết nối.');
        clearInterval(intervalId); // Dừng việc gửi dữ liệu
        res.end(); // Kết thúc response
    });
});


// =================================================================
// 5. ENDPOINT TRANG CHỦ VÀ KHỞI CHẠY SERVER
// =================================================================
app.get('/', (req, res) => {
    res.json({
        message: "Node.js SSE Server cho giá cổ phiếu.",
        usage: `Kết nối SSE tới /stream-prices?symbols=ACB,FPT,VCB`
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Node.js SSE Server đang chạy tại http://localhost:${PORT}`);
    console.log("Đảm bảo server Python (Flask/FastAPI) cũng đang chạy tại http://localhost:5000");
});