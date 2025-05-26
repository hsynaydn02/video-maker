const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

class PexelsService {
  constructor() {
    this.apiKey = process.env.PEXELS_API_KEY;
    this.baseURL = 'https://api.pexels.com/videos';
    
    if (!this.apiKey) {
      throw new Error('PEXELS_API_KEY environment variable gerekli');
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': this.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [new winston.transports.Console()]
    });
  }

  /**
   * Video arama
   * @param {string} query - Arama sorgusu
   * @param {object} options - Arama seçenekleri
   */
  async searchVideos(query, options = {}) {
    try {
      const params = {
        query: query,
        per_page: options.per_page || 15,
        page: options.page || 1,
        min_width: options.min_width || 1920,
        min_height: options.min_height || 1080,
        min_duration: options.min_duration || 5,
        max_duration: options.max_duration || 60,
        orientation: options.orientation || 'landscape'
      };

      this.logger.info(`Video aranıyor: "${query}"`, params);

      const response = await this.client.get('/search', { params });
      
      if (response.data && response.data.videos) {
        const videos = response.data.videos.map(video => this.formatVideoData(video));
        
        this.logger.info(`${videos.length} video bulundu: "${query}"`);
        return videos;
      }

      return [];

    } catch (error) {
      this.logger.error(`Video arama hatası: "${query}"`, {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });

      if (error.response?.status === 429) {
        throw new Error('API rate limit aşıldı. Lütfen bekleyin.');
      }

      throw new Error(`Video arama başarısız: ${error.message}`);
    }
  }

  /**
   * Popüler videoları getir
   */
  async getPopularVideos(options = {}) {
    try {
      const params = {
        per_page: options.per_page || 15,
        page: options.page || 1,
        min_width: options.min_width || 1920,
        min_height: options.min_height || 1080,
        min_duration: options.min_duration || 5
      };

      const response = await this.client.get('/popular', { params });
      
      if (response.data && response.data.videos) {
        const videos = response.data.videos.map(video => this.formatVideoData(video));
        this.logger.info(`${videos.length} popüler video getirildi`);
        return videos;
      }

      return [];

    } catch (error) {
      this.logger.error('Popüler video getirme hatası:', error.message);
      throw new Error(`Popüler videolar getirilemedi: ${error.message}`);
    }
  }

  /**
   * Video indirme
   * @param {string} videoUrl - Video URL
   * @param {string} filename - Kaydedilecek dosya adı
   */
  async downloadVideo(videoUrl, filename) {
    try {
      this.logger.info(`Video indiriliyor: ${videoUrl}`);

      const response = await axios({
        method: 'GET',
        url: videoUrl,
        responseType: 'stream',
        timeout: 300000, // 5 dakika timeout
        headers: {
          'User-Agent': 'Video-Maker-API/1.0'
        }
      });

      const filePath = path.join(__dirname, '../../temp', filename);
      const writer = require('fs').createWriteStream(filePath);

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          this.logger.info(`Video indirildi: ${filename}`);
          resolve(filePath);
        });
        
        writer.on('error', (error) => {
          this.logger.error(`Video indirme hatası: ${filename}`, error);
          reject(error);
        });

        // Progress tracking
        if (response.headers['content-length']) {
          const totalSize = parseInt(response.headers['content-length']);
          let downloadedSize = 0;

          response.data.on('data', (chunk) => {
            downloadedSize += chunk.length;
            const progress = Math.round((downloadedSize / totalSize) * 100);
            
            if (progress % 10 === 0) { // Her %10'da log
              this.logger.info(`İndirme ilerlemesi: ${progress}% - ${filename}`);
            }
          });
        }
      });

    } catch (error) {
      this.logger.error(`Video indirme hatası: ${videoUrl}`, error.message);
      throw new Error(`Video indirilemedi: ${error.message}`);
    }
  }

  /**
   * Video verisini formatla
   */
  formatVideoData(video) {
    // En uygun kaliteyi seç (HD öncelikli)
    const videoFiles = video.video_files || [];
    let selectedFile = null;

    // HD kalite ara
    selectedFile = videoFiles.find(file => 
      file.quality === 'hd' && 
      file.width >= 1920 && 
      file.height >= 1080
    );

    // HD bulunamazsa, en yüksek çözünürlüklü olanı seç
    if (!selectedFile) {
      selectedFile = videoFiles.reduce((prev, current) => {
        const prevSize = (prev?.width || 0) * (prev?.height || 0);
        const currentSize = (current?.width || 0) * (current?.height || 0);
        return currentSize > prevSize ? current : prev;
      }, videoFiles[0]);
    }

    return {
      id: video.id,
      width: video.width,
      height: video.height,
      duration: video.duration,
      url: video.url,
      image: video.image,
      user: {
        id: video.user?.id,
        name: video.user?.name,
        url: video.user?.url
      },
      videoFile: selectedFile ? {
        id: selectedFile.id,
        quality: selectedFile.quality,
        file_type: selectedFile.file_type,
        width: selectedFile.width,
        height: selectedFile.height,
        link: selectedFile.link
      } : null,
      tags: video.tags || []
    };
  }

  /**
   * API kullanım bilgilerini kontrol et
   */
  async checkApiUsage() {
    try {
      // Basit bir arama yaparak API durumunu kontrol et
      const response = await this.client.get('/search', {
        params: { query: 'test', per_page: 1 }
      });

      return {
        status: 'active',
        rateLimit: response.headers['x-ratelimit-limit'],
        remaining: response.headers['x-ratelimit-remaining'],
        reset: response.headers['x-ratelimit-reset']
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message
      };
    }
  }
}

module.exports = PexelsService;