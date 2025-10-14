// =================================================================
// 1. IMPORT CÁC THƯ VIỆN
// =================================================================
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

// =================================================================
// 2. KHỞI TẠO ỨNG DỤNG EXPRESS
// =================================================================
const app = express();
// Render sẽ cung cấp cổng qua biến môi trường. Dùng 5001 làm dự phòng cho local.
const PORT = process.env.PORT || 5001;

// Cấu hình CORS để cho phép mọi kết nối
app.use(cors());

// =================================================================
// 3. HÀM HỖ TRỢ LẤY DỮ LIỆU (ĐÃ SỬA)
// =================================================================

/**
 * Gọi đến API Python đã được deploy trên Render để lấy giá cổ phiếu.
 * @param {string[]} symbols - Mảng các mã cổ phiếu, ví dụ ['ACB', 'FPT'].
 * @returns {Promise<object>} - Một object chứa dữ liệu giá.
 */
async function fetchStockPrices(symbols) {
    // ✨ FIX: Trỏ thẳng đến URL API Python đã hoạt động của bạn
    const pythonApiUrl = 'https://vn-stock-api-bsjj.onrender.com';
    const apiUrl = `${pythonApiUrl}/api/stocks/price?symbols=${symbols.join(',')}`;

    console.log(`Đang gọi API: ${apiUrl}`);

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            console.error(`Lỗi khi gọi API Python: ${response.status} ${response.statusText}`);
            return { error: `API Python trả về lỗi: ${response.statusText}` };
        }
        const data = await response.json();
        // API của bạn trả về dữ liệu trong key 'data'
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
    const { symbols } = req.query;
    if (!symbols) {
        return res.status(400).json({ error: 'Vui lòng cung cấp mã cổ phiếu qua query "symbols".' });
    }
    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());

    // Thiết lập headers cho SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log(`Client đã kết nối để stream mã: ${symbolList.join(', ')}`);

    // Gửi dữ liệu định kỳ
    const intervalId = setInterval(async () => {
        const priceData = await fetchStockPrices(symbolList);

        // Chỉ gửi dữ liệu nếu kết nối còn mở
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(priceData)}\n\n`);
        }
    }, 5000); // Cập nhật mỗi 5 giây

    // Xử lý khi client ngắt kết nối
    req.on('close', () => {
        console.log('Client đã ngắt kết nối.');
        clearInterval(intervalId); // Dừng việc gửi dữ liệu
        res.end();
    });
});

// =================================================================
// 5. ENDPOINT TRANG CHỦ VÀ KHỞI CHẠY SERVER
// =================================================================
app.get('/', (req, res) => {
    res.json({
        message: "Node.js SSE Server cho giá cổ phiếu.",
        status: "Đang hoạt động",
        usage: `Kết nối SSE tới /stream-prices?symbols=ACB,FPT,VCB`
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Node.js SSE Server đang chạy trên cổng ${PORT}`);
});
