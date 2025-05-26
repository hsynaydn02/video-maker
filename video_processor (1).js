const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');

const PexelsService = require('./pexelsService');

class VideoProcessor {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [new winston.transports.Console()]
    });

    this.pexelsService = new PexelsService();
    this.tempDir = path.join(__dirname, '../../temp');
    this.outputDir = path.join(__dirname, '../../output');
  }

  /**
   * Video oluştur
   * @param {Array} videoData - Sahne ve video verileri
   * @param {Object} settings - Video ayarları
   * @param {Function} progressCallback - İlerleme callback'i
   */
  async createVideo(videoData, settings, progressCallback) {
    const jobId = uuidv4();
    const outputFilename = `video_${jobId}_${Date.now()}.mp4`;
    const outputPath = path.join(this.outputDir, outputFilename);

    try {
      this.logger.info(`Video oluşturma başladı: ${jobId}`, { 
        scenes: videoData.length,
        settings 
      });

      // 1. Videoları indir
      if (progressCallback) progressCallback(10);
      const downloadedVideos = await this.downloadVideos(videoData, jobId, progressCallback);

      // 2. Videoları işle ve kırp
      if (progressCallback) progressCallback(40);
      const processedVideos = await this.processVideos(downloadedVideos, settings, progressCallback);

      // 3. Videoları birleştir
      if (progressCallback) progressCallback(70);
      await this.mergeVideos(processedVideos, outputPath, settings, progressCallback);

      // 4. Dosya bilgilerini al
      const stats = await fs.stat(outputPath);
      const duration = await this.getVideoInfo(outputPath);

      // 5. Geçici dosyaları temizle
      await this.cleanupTempFiles(downloadedVideos.concat(processedVideos));

      this.logger.info(`Video oluşturuldu: ${outputFilename}`, {
        duration: duration,
        fileSize: stats.size
      });

      return {
        filename: outputFilename,
        path: outputPath,
        duration: duration,
        fileSize: this.formatFileSize(stats.size),
        scenes: videoData.length
      };

    } catch (error) {
      this.logger.error(`Video oluşturma hatası: ${jobId}`, error);
      
      // Hata durumunda geçici dosyaları temizle
      try {
        await this.cleanupTempFiles([outputPath]);
      } catch (cleanupError) {
        this.logger.error('Temizlik hatası:', cleanupError);
      }

      throw error;
    }
  }

  /**
   * Videoları indir
   */
  async downloadVideos(videoData, jobId, progressCallback) {
    const downloadedVideos = [];
    const totalScenes = videoData.length;

    for (let i = 0; i < totalScenes; i++) {
      const scene = videoData[i];
      
      if (!scene.selectedVideo || !scene.selectedVideo.videoFile) {
        this.logger.warn(`Sahne ${i + 1} için video yok, atlanıyor`);
        continue;
      }

      try {
        const videoUrl = scene.selectedVideo.videoFile.link;
        const filename = `scene_${i + 1}_${jobId}.mp4`;
        
        this.logger.info(`Video indiriliyor: Sahne ${i + 1}/${totalScenes}`);
        
        const filePath = await this.pexelsService.downloadVideo(videoUrl, filename);
        
        downloadedVideos.push({
          scene: scene,
          filePath: filePath,
          sceneIndex: i
        });

        // Progress güncelle (indirme %10-40 arası)
        if (progressCallback) {
          const progress = 10 + Math.round((i + 1) / totalScenes * 30);
          progressCallback(progress);
        }

      } catch (error) {
        this.logger.error(`Sahne ${i + 1} indirme hatası:`, error);
        // Hata durumunda sahneyi atla
        continue;
      }
    }

    if (downloadedVideos.length === 0) {
      throw new Error('Hiç video indirilemedi');
    }

    return downloadedVideos;
  }

  /**
   * Videoları işle (kırpma, yeniden boyutlandırma)
   */
  async processVideos(downloadedVideos, settings, progressCallback) {
    const processedVideos = [];
    const totalVideos = downloadedVideos.length;

    for (let i = 0; i < totalVideos; i++) {
      const videoData = downloadedVideos[i];
      
      try {
        const processedPath = await this.processSingleVideo(videoData, settings, i);
        processedVideos.push(processedPath);

        // Progress güncelle (işleme %40-70 arası)
        if (progressCallback) {
          const progress = 40 + Math.round((i + 1) / totalVideos * 30);
          progressCallback(progress);
        }

      } catch (error) {
        this.logger.error(`Video işleme hatası: ${videoData.filePath}`, error);
        throw error;
      }
    }

    return processedVideos;
  }

  /**
   * Tek video işle
   */
  async processSingleVideo(videoData, settings, index) {
    const { filePath, scene } = videoData;
    const outputPath = path.join(this.tempDir, `processed_${index}_${Date.now()}.mp4`);

    const sceneDuration = scene.scene.duration || settings.duration || 5;
    const [width, height] = settings.resolution.split('x').map(Number);

    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .duration(sceneDuration)
        .size(`${width}x${height}`)
        .fps(settings.fps || 30)
        .videoCodec('libx264')
        .audioCodec('aac')
        .addOptions([
          '-preset fast',
          '-crf 23',
          '-pix_fmt yuv420p',
          '-vf scale=' + width + ':' + height + ':force_original_aspect_ratio=decrease,pad=' + width + ':' + height + ':(ow-iw)/2:(oh-ih)/2:black'
        ])
        .on('start', (commandLine) => {
          this.logger.info(`FFmpeg başladı: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            this.logger.debug(`Video işleme ilerlemesi: %${Math.round(progress.percent)}`);
          }
        })
        .on('end', () => {
          this.logger.info(`Video işlendi: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`Video işleme hatası: ${filePath}`, err);
          reject(new Error(`Video işleme başarısız: ${err.message}`));
        })
        .save(outputPath);
    });
  }

  /**
   * Videoları birleştir
   */
  async mergeVideos(processedVideos, outputPath, settings, progressCallback) {
    if (processedVideos.length === 1) {
      // Tek video varsa, sadece kopyala
      await fs.copyFile(processedVideos[0], outputPath);
      return;
    }

    return new Promise((resolve, reject) => {
      const command = ffmpeg();

      // Tüm videoları input olarak ekle
      processedVideos.forEach(videoPath => {
        command.addInput(videoPath);
      });

      // Geçiş efekti ayarları
      const transitionFilter = this.getTransitionFilter(processedVideos.length, settings.transition);

      command
        .complexFilter(transitionFilter)
        .outputOptions([
          '-preset fast',
          '-crf 23',
          '-pix_fmt yuv420p',
          '-r ' + (settings.fps || 30)
        ])
        .on('start', (commandLine) => {
          this.logger.info(`Video birleştirme başladı: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent && progressCallback) {
            const totalProgress = 70 + Math.round(progress.percent * 0.3);
            progressCallback(totalProgress);
          }
        })
        .on('end', () => {
          this.logger.info(`Video birleştirildi: ${outputPath}`);
          resolve();
        })
        .on('error', (err) => {
          this.logger.error('Video birleştirme hatası:', err);
          reject(new Error(`Video birleştirme başarısız: ${err.message}`));
        })
        .save(outputPath);
    });
  }

  /**
   * Geçiş efekti filtresi oluştur
   */
  getTransitionFilter(videoCount, transitionType = 'fade') {
    if (videoCount === 1) {
      return '[0:v][0:a]copy[v][a]';
    }

    let filterComplex = '';
    const transitionDuration = 0.5; // 0.5 saniye geçiş

    switch (transitionType) {
      case 'fade':
        // Fade geçiş efekti
        for (let i = 0; i < videoCount - 1; i++) {
          if (i === 0) {
            filterComplex += `[${i}:v][${i + 1}:v]xfade=transition=fade:duration=${transitionDuration}:offset=5[v${i}];`;
          } else if (i === videoCount - 2) {
            filterComplex += `[v${i - 1}][${i + 1}:v]xfade=transition=fade:duration=${transitionDuration}:offset=5[v];`;
          } else {
            filterComplex += `[v${i - 1}][${i + 1}:v]xfade=transition=fade:duration=${transitionDuration}:offset=5[v${i}];`;
          }
        }
        break;

      case 'slide':
        // Slide geçiş efekti
        for (let i = 0; i < videoCount - 1; i++) {
          if (i === 0) {
            filterComplex += `[${i}:v][${i + 1}:v]xfade=transition=slideleft:duration=${transitionDuration}:offset=5[v${i}];`;
          } else if (i === videoCount - 2) {
            filterComplex += `[v${i - 1}][${i + 1}:v]xfade=transition=slideleft:duration=${transitionDuration}:offset=5[v];`;
          } else {
            filterComplex += `[v${i - 1}][${i + 1}:v]xfade=transition=slideleft:duration=${transitionDuration}:offset=5[v${i}];`;
          }
        }
        break;

      default:
        // Basit concat (geçiş yok)
        const inputs = Array.from({ length: videoCount }, (_, i) => `[${i}:v][${i}:a]`).join('');
        filterComplex = `${inputs}concat=n=${videoCount}:v=1:a=1[v][a]`;
    }

    return filterComplex;
  }

  /**
   * Video bilgilerini al
   */
  async getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          this.logger.error('Video bilgi alma hatası:', err);
          reject(err);
          return;
        }

        const duration = metadata.format.duration;
        resolve(Math.round(duration));
      });
    });
  }

  /**
   * Geçici dosyaları temizle
   */
  async cleanupTempFiles(filePaths) {
    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
        this.logger.info(`Geçici dosya silindi: ${filePath}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.warn(`Geçici dosya silinemedi: ${filePath}`, error);
        }
      }
    }
  }

  /**
   * Dosya boyutunu formatla
   */
  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Video önizleme oluştur
   */
  async createPreview(videoPath, outputPath, options = {}) {
    const { width = 480, height = 270, duration = 10 } = options;

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .size(`${width}x${height}`)
        .duration(duration)
        .fps(15)
        .videoCodec('libx264')
        .addOptions(['-preset veryfast', '-crf 28'])
        .on('end', () => {
          this.logger.info(`Önizleme oluşturuldu: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error('Önizleme oluşturma hatası:', err);
          reject(err);
        })
        .save(outputPath);
    });
  }

  /**
   * Video thumbnail oluştur
   */
  async createThumbnail(videoPath, outputPath, timeOffset = '00:00:01') {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [timeOffset],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '320x180'
        })
        .on('end', () => {
          this.logger.info(`Thumbnail oluşturuldu: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error('Thumbnail oluşturma hatası:', err);
          reject(err);
        });
    });
  }
}

module.exports = VideoProcessor;