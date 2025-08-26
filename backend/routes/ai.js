const express = require("express");
const axios = require("axios");
const router = express.Router();

const ML_BASE = process.env.ML_BASE || "http://localhost:8001";

router.post("/infer-mood", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: "text required" });
    const { data } = await axios.post(`${ML_BASE}/sentiment`, { text });
    res.json(data); // forward Python result
  } catch (e) {
    console.error("infer-mood error:", e.message);
    res.status(500).json({ error: "proxy_failed" });
  }
});

module.exports = router;
