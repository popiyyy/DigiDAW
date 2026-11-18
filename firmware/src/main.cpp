#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <DHT.h>
#include <BH1750.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "config.h"

// Inisialisasi objek sensor & jaringan
DHT dht(DHT_PIN, DHT_TYPE);
BH1750 lightMeter(BH1750_ADDR);
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Ring buffer untuk menyimpan riwayat suhu selama 5 menit
float tempHistory[TREND_WINDOW_SAMPLES];
int historyCount = 0;
int historyIndex = 0;

// Variabel shared antar-task FreeRTOS
struct SensorPayload {
    float roomTemp;
    float roomRh;
    float tempTrend5m;
    String thermalState;
    float lightLux;
    String lightState;
    uint32_t seqId;
    bool valid;
};

SensorPayload latestData;
SemaphoreHandle_t dataMutex;

// FUNGSI KONEKSI WI-FI & MQTT
void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    Serial.print("[WiFi] Menghubungkan ke ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    while (WiFi.status() != WL_CONNECTED) {
        vTaskDelay(pdMS_TO_TICKS(500));
        Serial.print(".");
    }
    Serial.print("\n[WiFi] Terhubung! IP: ");
    Serial.println(WiFi.localIP());
}

void connectMQTT() {
    while (!mqttClient.connected()) {
        Serial.print("[MQTT] Menghubungkan ke broker...");
        if (mqttClient.connect(MQTT_CLIENT_ID)) {
            Serial.println(" Terhubung!");
        } else {
            Serial.print(" Gagal (rc=");
            Serial.print(mqttClient.state());
            Serial.println("), coba lagi dalam 3 detik...");
            vTaskDelay(pdMS_TO_TICKS(3000));
        }
    }
}

// LOGIKA RING BUFFER & RULE-BASED FUSION
float updateAndComputeTrend(float currentTemp) {
    float oldestTemp = currentTemp;

    if (historyCount < TREND_WINDOW_SAMPLES) {
        if (historyCount > 0) {
            oldestTemp = tempHistory[0];
        }
        tempHistory[historyCount] = currentTemp;
        historyCount++;
    } else {
        oldestTemp = tempHistory[historyIndex];
        tempHistory[historyIndex] = currentTemp;
        historyIndex = (historyIndex + 1) % TREND_WINDOW_SAMPLES;
    }

    return currentTemp - oldestTemp;
}

String classifyThermalState(float temp, float trend5m, bool isValid) {
    if (!isValid) return "SENSOR_ERROR";
    if (trend5m <= COOLING_TREND_THRESH) return "ACTIVE_COOLING";
    if (trend5m >= WARMING_TREND_THRESH) return "WARMING_TREND";
    if (temp < COOL_STABLE_MAX_TEMP) return "COOL_STABLE";
    return "AMBIENT_STABLE";
}

String classifyLightState(float lux, bool isValid) {
    if (!isValid || lux < 0.0f) return "SENSOR_ERROR";
    if (lux < LUX_DARK_MAX) return "DARK";
    if (lux <= LUX_DIM_MAX) return "DIM";
    return "BRIGHT";
}

// TASK 1: AKUISISI SENSOR & EDGE PROCESSING (CORE 1)
void sensorTask(void *pvParameters) {
    uint32_t sequenceCounter = 0;

    for (;;) {
        TickType_t xLastWakeTime = xTaskGetTickCount();

        float rh = dht.readHumidity();
        float temp = dht.readTemperature();
        float lux = lightMeter.readLightLevel();

        bool dhtValid = !isnan(temp) && !isnan(rh);
        bool luxValid = (lux >= 0.0f);

        float trend5m = 0.0f;
        if (dhtValid) {
            trend5m = updateAndComputeTrend(temp);
        }

        String tState = classifyThermalState(temp, trend5m, dhtValid);
        String lState = classifyLightState(lux, luxValid);
        sequenceCounter++;

        // Simpan ke variabel global secara thread-safe
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            latestData.roomTemp     = dhtValid ? round(temp * 100.0f) / 100.0f : -999.0f;
            latestData.roomRh       = dhtValid ? round(rh * 100.0f) / 100.0f : -999.0f;
            latestData.tempTrend5m  = dhtValid ? round(trend5m * 100.0f) / 100.0f : 0.0f;
            latestData.thermalState = tState;
            latestData.lightLux     = luxValid ? round(lux * 10.0f) / 10.0f : -1.0f;
            latestData.lightState   = lState;
            latestData.seqId        = sequenceCounter;
            latestData.valid        = (dhtValid && luxValid);
            xSemaphoreGive(dataMutex);
        }

        Serial.printf("[SENSOR #%lu] T=%.2fC | RH=%.1f%% | dT_5m=%.2fC (%s) | Lux=%.1f (%s)\n",
                      sequenceCounter, temp, rh, trend5m, tState.c_str(), lux, lState.c_str());

        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(SAMPLE_INTERVAL_MS));
    }
}

// TASK 2: TELEMETRI WI-FI & MQTT PUBLISH (CORE 0)
void mqttTask(void *pvParameters) {
    uint32_t lastPublishedSeq = 0;

    for (;;) {
        connectWiFi();
        connectMQTT();
        mqttClient.loop();

        SensorPayload snapshot;
        bool hasNewData = false;

        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            if (latestData.seqId != lastPublishedSeq) {
                snapshot = latestData;
                lastPublishedSeq = latestData.seqId;
                hasNewData = true;
            }
            xSemaphoreGive(dataMutex);
        }

        if (hasNewData) {
            JsonDocument doc;
            doc["device_id"]     = MQTT_CLIENT_ID;
            doc["seq"]           = snapshot.seqId;
            doc["uptime_ms"]     = millis();
            doc["room_temp"]     = snapshot.roomTemp;
            doc["room_rh"]       = snapshot.roomRh;
            doc["temp_trend_5m"] = snapshot.tempTrend5m;
            doc["thermal_state"] = snapshot.thermalState;
            doc["light_lux"]     = snapshot.lightLux;
            doc["light_state"]   = snapshot.lightState;

            char jsonBuffer[320];
            serializeJson(doc, jsonBuffer);

            if (mqttClient.publish(MQTT_TOPIC_PUB, jsonBuffer)) {
                Serial.printf("[MQTT] Published -> %s\n", jsonBuffer);
            } else {
                Serial.println("[MQTT] Gagal mengirim payload!");
            }
        }

        vTaskDelay(pdMS_TO_TICKS(200));
    }
}

// MAIN SETUP
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== DigiDAW Edge Node Booting ===");

    dht.begin();
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
        Serial.println("[INIT] BH1750 siap pada alamat 0x23.");
    } else {
        Serial.println("[ERROR] BH1750 tidak terdeteksi! Periksa wiring SDA/SCL.");
    }

    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setBufferSize(512);

    dataMutex = xSemaphoreCreateMutex();
    latestData.seqId = 0;

    // Jalankan Sensor Task di Core 1 dan Network/MQTT Task di Core 0
    xTaskCreatePinnedToCore(sensorTask, "SensorTask", 4096, NULL, 2, NULL, 1);
    xTaskCreatePinnedToCore(mqttTask,   "MqttTask",   4096, NULL, 1, NULL, 0);
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(1000));
}
