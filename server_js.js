const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;

const videoRoutes = require('./routes/video');
const { cleanupTempFiles } = require('./utils/cleanup');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Logger konfigürasyonu
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static dosyalar
app.use('/output', express.static(path.join(__dirname, '../output')));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url} - ${req.ip}`);
  next();
});

// Routes
app.use('/api/video', videoRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Video Maker API',
    version: '1.0.0',
    endpoints: {
      'POST /api/video/create': 'Video oluştur',
      'GET /api/video/status/:id': 'Video durumu sorgula',
      'GET /output/:filename': 'Video indir',
      'GET /health': 'Sistem durumu'
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({
    error: 'Bir şeyler ters gitti!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Sunucu hatası'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint bulunamadı' });
});

// Geçici dosya temizleme
const cleanupInterval = parseInt(process.env.CLEANUP_INTERVAL || '30') * 60 * 1000;
setInterval(cleanupTempFiles, cleanupInterval);

// Dizinleri oluştur
const createDirectories = async () => {
  const dirs = ['temp', 'output', 'logs'];
  for (const dir of dirs) {
    try {
      await fs.mkdir(path.join(__dirname, '..', dir), { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        logger.error(`Dizin oluşturulamadı: ${dir}`, err);
      }
    }
  }
};

// Server başlat
const startServer = async () => {
  try {
    await createDirectories();
    
    app.listen(PORT, () => {
      logger.info(`Server ${PORT} portunda çalışıyor`);
      logger.info(`Ortam: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Server başlatılamadı:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM alındı, server kapatılıyor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT alındı, server kapatılıyor...');
  process.exit(0);
});