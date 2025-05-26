const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

/**
 * Geçici dosyaları temizle
 */
async function cleanupTempFiles() {
  const tempDir = path.join(__dirname, '../../temp');
  const outputDir = path.join(__dirname, '../../output');
  
  try {
    await cleanupDirectory(tempDir, 30 * 60 * 1000); // 30 dakika
    await cleanupDirectory(outputDir, 24 * 60 * 60 * 1000); // 24 saat
    
    logger.info('Geçici dosya temizliği tamamlandı');
  } catch (error) {
    logger.error('Geçici dosya temizliği hatası:', error);
  }
}

/**
 * Belirtilen dizindeki eski dosyaları temizle
 */
async function cleanupDirectory(dirPath, maxAge) {
  try {
    const files = await fs.readdir(dirPath);
    const now = Date.now();
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      
      try {
        const stats = await fs.stat(filePath);
        const fileAge = now - stats.mtime.getTime();

        if (fileAge > maxAge) {
          await fs.unlink(filePath);
          deletedCount++;
          logger.info(`Eski dosya silindi: ${file}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn(`Dosya işleme hatası: ${file}`, error);
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`${deletedCount} eski dosya ${dirPath} dizininden silindi`);
    }

  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`Dizin temizleme hatası: ${dirPath}`, error);
    }
  }
}

/**
 * Disk kullanımını kontrol et
 */
async function checkDiskUsage() {
  const tempDir = path.join(__dirname, '../../temp');
  const outputDir = path.join(__dirname, '../../output');
  
  try {
    const tempSize = await getDirSize(tempDir);
    const outputSize = await getDirSize(outputDir);
    
    const usage = {
      temp: {
        size: tempSize,
        formatted: formatFileSize(tempSize)
      },
      output: {
        size: outputSize,
        formatted: formatFileSize(outputSize)
      },
      total: {
        size: tempSize + outputSize,
        formatted: formatFileSize(tempSize + outputSize)
      }
    };

    logger.info('Disk kullanımı:', usage);
    return usage;

  } catch (error) {
    logger.error('Disk kullanımı kontrol hatası:', error);
    return null;
  }
}

/**
 * Dizin boyutunu hesapla
 */
async function getDirSize(dirPath) {
  let totalSize = 0;
  
  try {
    const files = await fs.readdir(dirPath);
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      
      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          totalSize += stats.size;
        } else if (stats.isDirectory()) {
          totalSize += await getDirSize(filePath);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn(`Dosya boyutu alma hatası: ${file}`, error);
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`Dizin boyutu hesaplama hatası: ${dirPath}`, error);
    }
  }

  return totalSize;
}

/**
 * Dosya boyutunu formatla
 */
function formatFileSize(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Acil temizlik - disk dolduğunda
 */
async function emergencyCleanup() {
  const tempDir = path.join(__dirname, '../../temp');
  const outputDir = path.join(__dirname, '../../output');
  
  try {
    logger.warn('Acil temizlik başlatıldı');
    
    // Tüm geçici dosyaları sil
    await cleanupDirectory(tempDir, 0);
    
    // 1 saatten eski output dosyalarını sil
    await cleanupDirectory(outputDir, 60 * 60 * 1000);
    
    logger.info('Acil temizlik tamamlandı');
    
  } catch (error) {
    logger.error('Acil temizlik hatası:', error);
  }
}

module.exports = {
  cleanupTempFiles,
  cleanupDirectory,
  checkDiskUsage,
  getDirSize,
  formatFileSize,
  emergencyCleanup
};