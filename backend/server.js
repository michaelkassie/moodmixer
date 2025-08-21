const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const musicRoutes = require('./routes/music');
const connectDB = require('./db');

dotenv.config(); // load .env file

const app = express();

// Allow requests from your Vercel frontend + local dev
const allowedOrigins = [
  'http://localhost:5173',             // dev frontend (Vite default)
  process.env.FRONTEND_URL,            // production frontend on Vercel
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
app.get('/health', (req, res) => {
  res.send('ok');
});

// your routes
app.use('/music', musicRoutes);

// use PORT from env or fallback to 5000
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
