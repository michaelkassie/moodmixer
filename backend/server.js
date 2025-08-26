// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./db');

// existing routes
const musicRoutes = require('./routes/music');

// NEW routes (add these files if you haven’t yet)
const aiRoutes = require('./routes/ai');             // POST /api/ai/infer-mood
const recRoutes = require('./routes/recs');          // GET  /api/recs/personalized
const analyticsRoutes = require('./routes/analytics'); // GET  /api/analytics/overview
//const devRoutes = require('./routes/dev');           // POST /api/dev/seed-basic (temporary)

dotenv.config(); // load .env file

const app = express();

// Allow requests from your Vercel frontend + local dev
const allowedOrigins = [
  'http://localhost:5173',            // dev frontend (Vite default)
  process.env.FRONTEND_URL || '',     // production frontend on Vercel
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS blocked: ' + origin));
    }
  },
  credentials: true,
}));

app.use(express.json());

// connect to MongoDB
connectDB();

// health check route (Render will ping this)
app.get('/health', (_req, res) => res.send('ok'));

// existing routes
app.use('/music', musicRoutes);

// NEW: DS/ML feature routes
app.use('/api/ai', aiRoutes);             // -> Python /sentiment
app.use('/api/recs', recRoutes);          // -> Python /recommend
app.use('/api/analytics', analyticsRoutes);
//app.use('/api/dev', devRoutes);           // temporary seeding helper

// basic error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// use PORT from env or fallback to 5000
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
