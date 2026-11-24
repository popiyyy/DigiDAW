#ifndef CONFIG_H
#define CONFIG_H

// KONFIGURASI JARINGAN WI-FI & MQTT
#define WIFI_SSID       "far"
#define WIFI_PASSWORD   "88888888"

#define MQTT_BROKER     "10.204.169.238"
#define MQTT_PORT       1883
#define MQTT_CLIENT_ID  "esp32-digidaw-01"
#define MQTT_TOPIC_PUB  "digidaw/room1/telemetry"

// MAPPING PIN HARDWARE (ESP32 DEVKIT)
#define DHT_PIN         18
#define DHT_TYPE        DHT22
#define I2C_SDA_PIN     21
#define I2C_SCL_PIN     22
#define BH1750_ADDR     0x23

// PARAMETER EDGE PROCESSING & THRESHOLD
#define SAMPLE_INTERVAL_MS    2500   
#define TREND_WINDOW_SAMPLES  120    

// Ambang batas gradien suhu 5 menit 
#define COOLING_TREND_THRESH -0.25f
#define WARMING_TREND_THRESH  0.20f
#define COOL_STABLE_MAX_TEMP 24.50f

// Ambang batas pencahayaan BH1750 
#define LUX_DARK_MAX         20.0f
#define LUX_DIM_MAX         150.0f

#endif