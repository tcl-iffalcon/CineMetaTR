# 🇹🇷 Türkçe Dublaj Stremio Eklentisi

Cinemeta katalogunda Türkçe dublaj olan içeriklere 🇹🇷 bayrağı ekler.

## Özellikler
- Film ve dizileri destekler
- TMDB + OpenSubtitles kombinasyonu ile güvenilir dublaj tespiti
- 6-24 saatlik akıllı cache sistemi

---

## Kurulum

### 1. Gereksinimler
- Node.js 14+
- TMDB API Key → [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)

### 2. Yerel Çalıştırma
```bash
git clone https://github.com/KULLANICI_ADIN/tr-dub-addon
cd tr-dub-addon
npm install
cp .env.example .env
# .env dosyasını aç ve TMDB_API_KEY'i yaz
npm start
```
Eklenti URL: `http://localhost:7000/manifest.json`

---

## Render'a Deploy

1. GitHub'a push et
2. [render.com](https://render.com) → **New Web Service**
3. GitHub repo'nu bağla
4. Ayarlar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     - `TMDB_API_KEY` = senin TMDB key'in
5. Deploy et
6. Render sana bir URL verir: `https://tr-dub-addon.onrender.com`

---

## Nuvio'ya Ekleme

Render deploy sonrası URL'yi kopyala:
```
https://tr-dub-addon.onrender.com/manifest.json
```
Bu URL'yi Nuvio'da **Eklenti Ekle** bölümüne yapıştır.

---

## Kataloglar
| Katalog | Tür |
|---|---|
| 🇹🇷 Filmler (Türkçe Dublaj) | Film |
| 🇹🇷 Diziler (Türkçe Dublaj) | Dizi |
