// server.ts
import express from "express";
import { PrismaClient } from "@prisma/client";
import cors from "cors";
import cookieParser from "cookie-parser";


import partnerRouter from "./routes/partner";
import adminRouter from "./routes/admin";   // where /add-new-partner lives
import authRouter from "./routes/auth";
import apiRouter from "./routes/api";
const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT) || 3003;


app.use(express.json());
const ALLOWLIST = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",      // vite sometimes hops ports
  "http://localhost:4173",      // vite preview
  "https://faucet.hashport.network",
  "https://faucet.api.hashport.network",
  "https://hashpass.api.hashport.network",
]);
app.use(cookieParser());

const corsOptions: cors.CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, false); // or true if you want to allow curl/Postman
    cb(null, ALLOWLIST.has(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.use("/api/partner", partnerRouter);
app.use("/api/admin", adminRouter);
app.use("/api/auth", authRouter);
app.use("/api", apiRouter);

app.get("/health", async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: "ok", db: "connected" }); }
  catch { res.status(500).json({ status: "error", db: "disconnected" }); }
});

app.get("/", (_req, res) => res.send("HPAS API Key Service is running 🚀"));

app.listen(PORT, "0.0.0.0", async () => {
  await prisma.$connect();
  console.log(`✅ Prisma connected`);
  console.log(`🚀 Listening on http://localhost:${PORT}`);
});
