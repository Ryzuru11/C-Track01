import express, { Application, Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import routes from './routes';
import commentRoutes from './routes/commentRoutes';
import { initSocketHandlers } from './sockets';
import { errorHandler } from './middleware/errorHandler';
import { displayServerUrls } from './utils/network';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

// 🌟 TAMBAHAN IMPORT ROBOT CRON JOB
import { initCronJobs } from './utils/cronJobs'; 

// timezone
process.env.TZ = 'Asia/Jakarta';

dotenv.config();

const app: Application = express();
const httpServer = createServer(app);

/// ================= SOCKET =================
export const io = new Server(httpServer, {
  cors: {
    // 🔓 KEMBALIKAN KE MODE PALING BEBAS AGAR MOBILE BISA MASUK
    origin: "*", // Terima dari IP, localhost, atau Emulator mana pun
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  },
});

// ================= MIDDLEWARE =================
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow all origins (dev friendly)
      callback(null, true);
    },
    credentials: true,
  })
);

app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ================= STATIC FILE =================
const uploadsPath = path.join(__dirname, '../uploads');

app.use(
  '/uploads',
  (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(uploadsPath)
);

// alias /storage
const reportsPath = path.join(__dirname, '../uploads/reports');

app.use(
  '/storage',
  (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(reportsPath)
);

// ================= HEALTH =================
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
  });
});

// ================= ROUTES (🔥 PENTING) =================
app.use('/api', routes);
app.use("/api/comments", commentRoutes);

// ================= SWAGGER DOCUMENTATION =================
const swaggerDocument = YAML.load(path.join(__dirname, '../docs/swagger.yaml'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ================= ERROR HANDLER =================
app.use(errorHandler);

// ================= 404 (PALING BAWAH) =================
app.use((req: Request, res: Response) => {
  res.status(404).json({ message: 'Route not found' });
});

// ================= SOCKET INIT =================
initSocketHandlers(io);

// ================= START SERVER =================
const PORT = process.env.PORT || 8000;

if (process.env.NODE_ENV !== 'test') {
  // 🤖 NYALAKAN ROBOT PENJADWAL NOTIFIKASI DI SINI
  initCronJobs();

  httpServer.listen(PORT, () => {
    displayServerUrls(PORT);
  });
}

export { httpServer };
export default app;