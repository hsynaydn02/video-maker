# Video Maker API

Bu proje, Pexels API kullanarak sahne promptlarından otomatik video oluşturan bir Node.js uygulamasıdır. Docker container olarak çalışır ve FFmpeg ile video işleme yapar.

## 🚀 Özellikler

- **Pexels API Entegrasyonu**: Yüksek kaliteli stock videolar
- **Otomatik Video Oluşturma**: Sahne promptlarından video birleştirme
- **Esnek Video Ayarları**: Çözünürlük, FPS, süre ayarlanabilir
- **Geçiş Efektleri**: Fade, slide ve diğer geçiş efektleri
- **Docker Desteği**: Kolay kurulum ve dağıtım
- **Async İşleme**: Non-blocking video oluşturma
- **Otomatik Temizlik**: Geçici dosya yönetimi
- **Rate Limiting**: API kötüye kullanım koruması

## 📋 Gereksinimler

- Docker ve Docker Compose
- Pexels API anahtarı ([buradan alın](https://www.pexels.com/api/))
- En az 4GB RAM (video işleme için)
- En az 10GB disk alanı

## 🛠️ Kurulum

### 1. Projeyi klonlayın
```bash
git clone <repository-url>
cd video-maker-api
```

### 2. Environment dosyasını oluşturun
```bash
cp .env.example .env
```

`.env` dosyasını düzenleyin:
```env
PEXELS_API_KEY=your_pexels_api_key_here
PORT=3000
NODE_ENV=production
MAX_VIDEO_DURATION=60
DEFAULT_VIDEO_DURATION=10
VIDEO_RESOLUTION=1920x1080
VIDEO_FPS=30
CLEANUP_INTERVAL=30
```

### 3. Docker ile başlatın
```bash
# Sadece API
docker-compose up -d video-maker

# Nginx ile birlikte (önerilen)
docker-compose up -d
```

### 4. Sağlık kontrolü
```bash
curl http://localhost:3000/health
```

## 📖 API Kullanımı

### Video Oluşturma

**POST** `/api/video/create`

```json
{
  "scenes": [
    {
      "prompt": "beautiful sunset over mountains",
      "duration": 5
    },
    {
      "prompt": "ocean waves on beach",
      "duration": 6
    },
    {
      "prompt": "forest with sunlight",
      "duration": 4
    }
  ],
  "settings": {
    "resolution": "1920x1080",
    "fps": 30,
    "transition": "fade",
    "backgroundColor": "#000000"
  }
}
```

**Yanıt:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "started",
  "message": "Video işleme başlatıldı",
  "estimatedTime": "45-90 saniye"
}
```

### Video Durumu Sorgulama

**GET** `/api/video/status/{jobId}`

**Yanıt:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": 100,
  "message": "Video başarıyla oluşturuldu",
  "downloadUrl": "/output/video_550e8400_1640995200000.mp4",
  "duration": 15,
  "fileSize": "25.4 MB",
  "scenes": 3,
  "completedAt": "2024-01-01T12:00:00.000Z"
}
```

### Video İndirme

**GET** `/output/{filename}`

Video dosyasını doğrudan indirmenizi sağlar.

## 🎬 Sahne Formatı

Her sahne objesi aşağıdaki özellikleri içerebilir:

```json
{
  "prompt": "Arama terimi (zorunlu)",
  "duration": 5,  // Saniye (opsiyonel, varsayılan: settings.duration)
  "tags": ["nature", "landscape"]  // Opsiyonel etiketler
}
```

## ⚙️ Video Ayarları

```json
{
  "duration": 5,          // Her sahne için varsayılan süre (saniye)
  "resolution": "1920x1080", // Video çözünürlüğü
  "fps": 30,              // Frame rate
  "transition": "fade",   // Geçiş efekti: "fade", "slide", "none"
  "backgroundColor": "#000000" // Arka plan rengi
}
```

## 🔧 Docker Compose Konfigürasyonu

### Basit Kurulum (Sadece API)
```bash
docker-compose up -d video-maker
```

### Tam Kurulum (Nginx + Redis)
```bash
docker-compose up -d
```

Bu kurulum şunları içerir:
- **video-maker**: Ana API servisi
- **nginx**: Reverse proxy ve rate limiting
- **redis**: Cache (gelecek özellikler için)

## 📊 Monitoring ve Loglar

### Logları görüntüleme
```bash
# API logları
docker-compose logs -f video-maker

# Nginx logları
docker-compose logs -f nginx

# Tüm servis logları
docker-compose logs -f
```

### Disk kullanımı kontrol
```bash
# Container'a bağlan
docker exec -it video-maker-api sh

# Disk kullanımını kontrol et
du -sh /app/temp /app/output
```

## 🔒 Güvenlik

### Rate Limiting
- API genel: 10 istek/dakika
- Video oluşturma: 2 istek/dakika
- Burst limit: 20 istek (genel), 5 istek (video)

### Dosya Boyutu Limitleri
- Maksimum istek boyutu: 50MB
- Maksimum video süresi: 60 saniye (configurable)

## 🧹 Otomatik Temizlik

Sistem otomatik olarak eski dosyaları temizler:
- **Temp dosyalar**: 30 dakika sonra
- **Output dosyalar**: 24 saat sonra

Manuel temizlik:
```bash
# Container'a bağlan
docker exec -it video-maker-api node -e "require('./src/utils/cleanup').emergencyCleanup()"
```

## 🐛 Hata Ayıklama

### Yaygın