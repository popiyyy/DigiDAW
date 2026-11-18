# DigiDAW (Digital Twin for Dynamic Ambient Workflow)

Prototipe sistem pemantauan iklim mikro ruangan (*indoor environment monitoring*) terhubung langsung dengan representasi model digital 3D (*Digital Twin*) interaktif berbasis Web.

---

## Arsitektur Stack Layanan

| Layanan | Image / Base | Port Host | Fungsi |
| :--- | :--- | :--- | :--- |
| **Mosquitto** | `eclipse-mosquitto:2` | `1883` (TCP)<br>`9001` (WS) | Broker MQTT untuk telemetri ESP32 dan WebSocket untuk Web Twin |
| **InfluxDB** | `influxdb:2.7` | `8086` | Time-series database untuk pencatatan telemetri lingkungan |
| **Node-RED** | `nodered/node-red:latest` | `1880` | Pipeline data, integrasi broker MQTT ke InfluxDB, dan endpoint REST |
| **Web-Twin** | `nginx:alpine` | `8080` | Antarmuka visual 3D Three.js Digital Twin & dashboard metrik |

---

## Panduan Menjalankan Layanan (Docker)

### Prasyarat
- [Docker Engine & Docker Compose](https://docs.docker.com/get-docker/) terinstal dan berjalan pada sistem host.
- Port `1883`, `9001`, `8086`, `1880`, dan `8080`.

### 1. Menyiapkan Environment & Menjalankan Semua Layanan
Salin file template environment, lalu jalankan Docker Compose:

```bash
# Salin konfigurasi environment
cp .env.example .env

# Jalankan kontainer
docker compose up -d --build
```
### 2. Memeriksa Status Kontainer
```bash
docker compose ps
```

Semua 4 kontainer (`digidaw-mosquitto`, `digidaw-influxdb`, `digidaw-nodered`, `digidaw-web-twin`) berstatus `running` / `Up`.

### 3. Mengakses Dashboard Layanan

- **Web Digital Twin**: [http://localhost:8080](http://localhost:8080)
- **Node-RED Editor**: [http://localhost:1880](http://localhost:1880)
- **InfluxDB UI**: [http://localhost:8086](http://localhost:8086)
- **Mosquitto Broker**:
  - TCP (ESP32 / Node-RED): `localhost:1883`
  - WebSocket (Browser): `ws://localhost:9001`

### 4. Melihat Log Kontainer
```bash
# Seluruh log
docker compose logs -f

# Log layanan tertentu
docker compose logs -f mosquitto
docker compose logs -f nodered
docker compose logs -f influxdb
docker compose logs -f web-twin
```

### 5. Stop Layanan
```bash
# Menghentikan kontainer (data volume tetap tersimpan)
docker compose stop

# Hentikan sekaligus menghapus kontainer
docker compose down

# Menghapus kontainer beserta volume data (reset total)
docker compose down -v
```
---

## Konfigurasi Firmware ESP32
Sebelum mengunggah kode firmware ke board ESP32:
1. Buka config.h
2. Sesuaikan `WIFI_SSID` dan `WIFI_PASSWORD` dengan hotspot/Wi-Fi.
3. Ubah `MQTT_BROKER` ke alamat IP lokal komputer/server Docker.