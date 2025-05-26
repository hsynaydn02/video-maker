const express = require('express');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');

const PexelsService = require('../services/pexelsService');
const VideoProcessor = require('../services/videoProcessor');

const router = express.Router();
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Video işleme durumları
const videoJobs = new Map();

/**
 * Video oluşturma endpoint'i
 * POST /api/video/create
 */
router.post('/create', async (req, res) => {
  try {
    const { scenes, settings = {} } = req.body;

    // Validation
    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({
        error: 'Geçersiz sahne verisi',
        message: 'En az bir sahne gerekli'
      });
    }

    // Her sahne için validation
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (!scene.prompt || typeof scene.prompt !== 'string') {
        return res.status(400).json({
          error: `Sahne ${i + 1} için geçersiz prompt`,
          message: 'Her sahne için prompt gerekli'
        });
      }
    }

    const jobId = uuidv4();
    
    // Job durumunu kaydet
    videoJobs.set(jobId, {
      id: jobId,
      status: 'started',
      progress: 0,
      message: 'Video işleme başlatıldı',
      scenes: scenes.length,
      createdAt: new Date(),
      settings
    });

    logger.info(`Video job başlatıldı: ${jobId}`, { scenes: scenes.length });

    // Async olarak video işleme
    processVideoAsync(jobId, scenes, settings);

    res.json({
      jobId,
      status: 'started',
      message: 'Video işleme başlatıldı',
      estimatedTime: `${scenes.length * 15-30} saniye`
    });

  } catch (error) {
    logger.error('Video oluşturma hatası:', error);
    res.status(500).json({
      error: 'Video oluşturulamadı',
      message: error.message
    });
  }
});

/**
 * Video durumu sorgulama
 * GET /api/video/status/:id
 */
router.get('/status/:id', (req, res) => {
  const { id } = req.params;
  const job = videoJobs.get(id);

  if (!job) {
    return res.status(404).json({
      error: 'Job bulunamadı',
      message: 'Geçersiz job ID'
    });
  }

  res.json(job);
});

/**
 * Async video işleme fonksiyonu
 */
async function processVideoAsync(jobId, scenes, settings) {
  const job = videoJobs.get(jobId);
  
  try {
    // Pexels servisini başlat
    const pexelsService = new PexelsService();
    const videoProcessor = new VideoProcessor();

    // Settings
    const videoSettings = {
      duration: settings.duration || 5, // Her sahne için süre (saniye)
      resolution: settings.resolution || '1920x1080',
      fps: settings.fps || 30,
      transition: settings.transition || 'fade',
      backgroundColor: settings.backgroundColor || '#000000'
    };

    job.status = 'searching';
    job.message = 'Videolar aranıyor...';
    
    logger.info(`Video arama başladı: ${jobId}`);

    // Her sahne için video ara
    const videoData = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      
      job.progress = Math.round(((i + 1) / scenes.length) * 30); // %30'a kadar arama
      job.message = `Sahne ${i + 1}/${scenes.length} aranıyor: "${scene.prompt}"`;
      
      try {
        const videos = await pexelsService.searchVideos(scene.prompt, {
          per_page: 10,
          min_duration: videoSettings.duration
        });

        if (videos.length === 0) {
          logger.warn(`Sahne için video bulunamadı: ${scene.prompt}`);
          // Fallback: genel arama
          const fallbackVideos = await pexelsService.searchVideos('nature landscape', {
            per_page: 5,
            min_duration: videoSettings.duration
          });
          videos.push(...fallbackVideos);
        }

        videoData.push({
          scene: scene,
          videos: videos.slice(0, 3), // En iyi 3 video
          selectedVideo: videos[0] // İlk videoyu seç
        });

      } catch (error) {
        logger.error(`Sahne ${i + 1} arama hatası:`, error);
        // Hata durumunda placeholder video kullan
        videoData.push({
          scene: scene,
          videos: [],
          selectedVideo: null,
          error: error.message
        });
      }
    }

    // Video indirme ve işleme
    job.status = 'processing';
    job.message = 'Videolar işleniyor...';
    job.progress = 30;

    const result = await videoProcessor.createVideo(videoData, videoSettings, (progress) => {
      job.progress = 30 + Math.round(progress * 0.7); // %30-100 arası
      job.message = `Video oluşturuluyor... %${job.progress}`;
    });

    // Başarılı tamamlama
    job.status = 'completed';
    job.progress = 100;
    job.message = 'Video başarıyla oluşturuldu';
    job.outputFile = result.filename;
    job.downloadUrl = `/output/${result.filename}`;
    job.duration = result.duration;
    job.fileSize = result.fileSize;
    job.completedAt = new Date();

    logger.info(`Video tamamlandı: ${jobId}`, result);

  } catch (error) {
    logger.error(`Video işleme hatası: ${jobId}`, error);
    
    job.status = 'failed';
    job.message = 'Video oluşturulurken hata oluştu';
    job.error = error.message;
    job.failedAt = new Date();
  }
}

module.exports = router;