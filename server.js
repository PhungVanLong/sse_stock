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
const PORT = process.env.PORT || 5001;

// Cấu hình CORS
app.use(cors());
app.use(express.json());

// =================================================================
// 3. CẤU HÌNH
// =================================================================
const CONFIG = {
    PYTHON_API_URL: process.env.PYTHON_API_URL || 'https://vn-stock-api-bsjj.onrender.com',
    UPDATE_INTERVAL: 10000, // 10 giây (tăng từ 5s để tránh spam Python API)
    MAX_SYMBOLS_PER_REQUEST: 10, // Giới hạn số mã tối đa
    REQUEST_TIMEOUT: 25000, // Timeout 25s
    CACHE_DURATION: 8000, // Cache 8 giây
    MAX_RETRY: 2,
    RETRY_DELAY: 2000
};

// =================================================================
// 4. CACHING SYSTEM
// =================================================================
const priceCache = new Map();

function getCachedData(symbols) {
    const cacheKey = symbols.sort().join(',');
    const cached = priceCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < CONFIG.CACHE_DURATION)) {
        console.log(`✅ Cache hit cho: ${cacheKey}`);
        return cached.data;
    }
    return null;
}

function setCachedData(symbols, data) {
    const cacheKey = symbols.sort().join(',');
    priceCache.set(cacheKey, {
        data,
        timestamp: Date.now()
    });

    // Tự động xóa cache cũ (giữ tối đa 50 entries)
    if (priceCache.size > 50) {
        const firstKey = priceCache.keys().next().value;
        priceCache.delete(firstKey);
    }
}

// =================================================================
// 5. HÀM LẤY DỮ LIỆU VỚI RETRY & CACHE
// =================================================================
async function fetchStockPrices(symbols, retryCount = 0) {
    // Kiểm tra cache trước
    const cachedData = getCachedData(symbols);
    if (cachedData) {
        return cachedData;
    }

    const apiUrl = `${CONFIG.PYTHON_API_URL}/api/stocks/price?symbols=${symbols.join(',')}`;
    console.log(`📡 Fetching: ${apiUrl}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

        const response = await fetch(apiUrl, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'SSE-Server/1.0'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Xử lý response từ Python API
        if (data.success) {
            const result = {
                success: true,
                data: data.data || {},
                errors: data.errors || {},
                timestamp: new Date().toISOString(),
                stats: {
                    total: data.total_requested || symbols.length,
                    successful: data.successful || 0,
                    failed: data.failed || 0
                }
            };

            // Lưu vào cache
            setCachedData(symbols, result);
            return result;
        } else {
            throw new Error(data.error || 'Unknown error from Python API');
        }

    } catch (error) {
        console.error(`❌ Lỗi khi fetch (attempt ${retryCount + 1}):`, error.message);

        // Retry logic
        if (retryCount < CONFIG.MAX_RETRY) {
            console.log(`🔄 Retrying in ${CONFIG.RETRY_DELAY / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            return fetchStockPrices(symbols, retryCount + 1);
        }

        // Trả về error response
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            data: {},
            errors: {}
        };
    }
}

// =================================================================
// 6. ENDPOINT SSE CHÍNH (TỐI ƯU)
// =================================================================
app.get('/stream-prices', async (req, res) => {
    const { symbols } = req.query;

    if (!symbols) {
        return res.status(400).json({
            error: 'Vui lòng cung cấp mã cổ phiếu. Ví dụ: ?symbols=ACB,FPT,VCB'
        });
    }

    const symbolList = symbols.split(',')
        .map(s => s.trim().toUpperCase())
        .filter(s => s.length > 0);

    // Validate số lượng symbols
    if (symbolList.length === 0) {
        return res.status(400).json({ error: 'Danh sách mã cổ phiếu trống' });
    }

    if (symbolList.length > CONFIG.MAX_SYMBOLS_PER_REQUEST) {
        return res.status(400).json({
            error: `Vượt quá giới hạn ${CONFIG.MAX_SYMBOLS_PER_REQUEST} mã/request`
        });
    }

    // Thiết lập SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Tắt buffering cho Nginx
    res.flushHeaders();

    console.log(`🔌 Client connected - Streaming: ${symbolList.join(', ')}`);

    // Gửi dữ liệu ngay lập tức
    const initialData = await fetchStockPrices(symbolList);
    res.write(`data: ${JSON.stringify(initialData)}\n\n`);

    // Interval để cập nhật định kỳ
    const intervalId = setInterval(async () => {
        if (res.writableEnded) {
            clearInterval(intervalId);
            return;
        }

        try {
            const priceData = await fetchStockPrices(symbolList);
            res.write(`data: ${JSON.stringify(priceData)}\n\n`);
        } catch (error) {
            console.error('❌ Error in interval:', error);
            // Gửi error message qua SSE
            res.write(`data: ${JSON.stringify({
                success: false,
                error: 'Internal error',
                timestamp: new Date().toISOString()
            })}\n\n`);
        }
    }, CONFIG.UPDATE_INTERVAL);

    // Heartbeat để giữ kết nối sống (mỗi 30s)
    const heartbeatId = setInterval(() => {
        if (!res.writableEnded) {
            res.write(': heartbeat\n\n');
        }
    }, 30000);

    // Xử lý khi client disconnect
    req.on('close', () => {
        console.log('🔌 Client disconnected');
        clearInterval(intervalId);
        clearInterval(heartbeatId);
        res.end();
    });
});

// =================================================================
// 7. ENDPOINT LẤY DỮ LIỆU ĐỒNG BỘ (REST API)
// =================================================================
app.get('/api/prices', async (req, res) => {
    const { symbols } = req.query;

    if (!symbols) {
        return res.status(400).json({
            error: 'Vui lòng cung cấp mã cổ phiếu. Ví dụ: ?symbols=ACB,FPT,VCB'
        });
    }

    const symbolList = symbols.split(',')
        .map(s => s.trim().toUpperCase())
        .filter(s => s.length > 0);

    if (symbolList.length > CONFIG.MAX_SYMBOLS_PER_REQUEST) {
        return res.status(400).json({
            error: `Vượt quá giới hạn ${CONFIG.MAX_SYMBOLS_PER_REQUEST} mã/request`
        });
    }

    const priceData = await fetchStockPrices(symbolList);
    res.json(priceData);
});

// =================================================================
// 8. HEALTH CHECK & MONITORING
// =================================================================
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        cache: {
            size: priceCache.size,
            maxSize: 50
        },
        config: {
            updateInterval: `${CONFIG.UPDATE_INTERVAL / 1000}s`,
            maxSymbols: CONFIG.MAX_SYMBOLS_PER_REQUEST,
            cacheDuration: `${CONFIG.CACHE_DURATION / 1000}s`
        }
    });
});

// =================================================================
// 9. ENDPOINT TRANG CHỦ
// =================================================================
app.get('/', (req, res) => {
    res.json({
        name: "VNStock SSE Server",
        version: "2.0",
        status: "✅ Đang hoạt động",
        python_api: CONFIG.PYTHON_API_URL,
        endpoints: {
            sse: {
                url: "/stream-prices?symbols=ACB,FPT,VCB",
                description: "Server-Sent Events stream (real-time)",
                update_interval: `${CONFIG.UPDATE_INTERVAL / 1000}s`,
                cache: `${CONFIG.CACHE_DURATION / 1000}s`
            },
            rest: {
                url: "/api/prices?symbols=ACB,FPT,VCB",
                description: "REST API (one-time request)"
            },
            health: {
                url: "/health",
                description: "Health check & monitoring"
            }
        },
        limits: {
            max_symbols: CONFIG.MAX_SYMBOLS_PER_REQUEST,
            request_timeout: `${CONFIG.REQUEST_TIMEOUT / 1000}s`,
            retry_attempts: CONFIG.MAX_RETRY
        },
        example_usage: {
            sse: `const eventSource = new EventSource('${req.protocol}://${req.get('host')}/stream-prices?symbols=ACB,FPT,VCB');`,
            rest: `fetch('${req.protocol}://${req.get('host')}/api/prices?symbols=ACB,FPT,VCB')`
        }
    });
});

// =================================================================
// 10. ERROR HANDLING
// =================================================================
app.use((err, req, res, next) => {
    console.error('💥 Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// =================================================================
// 11. GRACEFUL SHUTDOWN
// =================================================================
const server = app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🚀 VNStock SSE Server - Production Ready');
    console.log('='.repeat(60));
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`📡 Python API: ${CONFIG.PYTHON_API_URL}`);
    console.log(`⏱️  Update Interval: ${CONFIG.UPDATE_INTERVAL / 1000}s`);
    console.log(`💾 Cache Duration: ${CONFIG.CACHE_DURATION / 1000}s`);
    console.log(`📊 Max Symbols: ${CONFIG.MAX_SYMBOLS_PER_REQUEST}`);
    console.log('='.repeat(60));
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});