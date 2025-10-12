import express from "express";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 3000;

// Bộ nhớ cache để tránh gọi API gốc quá nhiều lần
let cache = {};
let lastUpdated = 0;
const CACHE_TTL = 5000; // làm mới mỗi 5 giây

// Hàm lấy dữ liệu nhiều mã cùng lúc
async function fetchStockData(symbols) {
    const now = Date.now();

    // Nếu cache còn hạn, trả lại dữ liệu cũ
    if (now - lastUpdated < CACHE_TTL && cache[symbols]) {
        console.log("🔁 Dùng lại cache");
        return cache[symbols];
    }

    console.log("🌐 Fetch mới từ API gốc...");
    const arr = symbols.split(",");
    const result = {};

    // Gọi lần lượt từng mã
    for (const symbol of arr) {
        try {
            const url = `https://vn-stock-api-bsjj.onrender.com/api/stock/${symbol}/price`;
            const res = await axios.get(url);
            result[symbol] = res.data;
        } catch (err) {
            result[symbol] = { error: "Fetch failed" };
        }
    }

    cache[symbols] = result;
    lastUpdated = now;
    return result;
}

// 🔹 Route kiểm tra trạng thái (Render/UptimeRobot health check)
app.get("/", (req, res) => {
    res.send("✅ SSE stock API is running");
});

// 🔹 Route health check (dành riêng cho monitor)
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// 🔸 Endpoint SSE (stream dữ liệu)
app.get("/api/stock/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const symbols = req.query.symbols || "ACB";
    console.log(`📡 Client subscribe symbols: ${symbols}`);

    // Gửi dữ liệu ban đầu
    const sendUpdate = async () => {
        const data = await fetchStockData(symbols);
        res.write(`data: ${JSON.stringify({ time: new Date(), data })}\n\n`);
    };

    await sendUpdate();
    const interval = setInterval(sendUpdate, 5000); // cập nhật mỗi 5s

    req.on("close", () => {
        clearInterval(interval);
        console.log("❌ Client disconnected");
    });
});

// 🔹 Lắng nghe cổng
app.listen(PORT, () => console.log(`✅ SSE server running on port ${PORT}`));
