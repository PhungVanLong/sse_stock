import express from "express";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 3000;

// Cache tạm
let cacheData = {};
let lastFetchTime = 0;
const CACHE_TTL = 5000; // 5 giây

// Lấy dữ liệu từ API gốc
async function fetchStockData(symbols) {
    const now = Date.now();
    if (now - lastFetchTime < CACHE_TTL && cacheData[symbols]) {
        return cacheData[symbols];
    }

    try {
        const results = {};
        const arr = symbols.split(",");
        for (const symbol of arr) {
            const url = `https://vn-stock-api-bsjj.onrender.com/api/stock/${symbol}/price`;
            const res = await axios.get(url);
            results[symbol] = res.data;
        }
        cacheData[symbols] = results;
        lastFetchTime = now;
        return results;
    } catch (err) {
        console.error("Fetch failed:", err.message);
        return {};
    }
}

// SSE endpoint
app.get("/api/stock/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const symbols = req.query.symbols || "VNI";

    const sendUpdate = async () => {
        const data = await fetchStockData(symbols);
        res.write(`data: ${JSON.stringify({ updated: Date.now(), data })}\n\n`);
    };

    await sendUpdate(); // gửi ngay lần đầu
    const interval = setInterval(sendUpdate, 5000); // update mỗi 5 giây

    req.on("close", () => clearInterval(interval));
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
