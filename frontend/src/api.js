import axios from "axios";


const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

console.log("API BASE:", API_BASE);
