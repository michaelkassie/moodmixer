import axios from "axios";

// use Vercel env var in production, localhost in dev
const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// sanity check
console.log("API BASE:", API_BASE);
