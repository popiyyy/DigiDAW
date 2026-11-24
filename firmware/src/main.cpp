#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <DHT.h>
#include <BH1750.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "config.h"

DHT dht(DHT_PIN, DHT_TYPE);
BH1750 lightMeter(BH1750_ADDR);
WiFiClient espClient;
PubSubClient mqttClient(espClient);

float tempHistory[TREND_WINDOW_SAMPLES];
int historyCount = 0;
int historyIndex = 0;

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

void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    Serial.printf("\n[WiFi] Menghubungkan ke SSID: '%s'...\n", WIFI_SSID);
    
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int retry = 0;
    while (WiFi.status() != WL_CONNECTED && retry < 20) {
        vTaskDelay(pdMS_TO_TICKS(500));
        Serial.print(".");
        retry++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.print("\n[WiFi] TERHUBUNG! IP ESP32: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.printf("\n[WiFi] Belum terhubung (Status: %d), mencoba lagi nanti...\n", WiFi.status());
    }
}

bool connectMQTT() {                                                                             
        if (mqttClient.connected()) return true;
        espClient.setTimeout(2); 
        Serial.printf("[MQTT] Menghubungkan ke broker (%s:%d)...", MQTT_BROKER, MQTT_PORT);                                           
        if (mqttClient.connect(MQTT_CLIENT_ID)) {                                                    
            Serial.println(" Terhubung!");                                                           
            return true;                                                                             
        } else {                                                                                     
            Serial.printf(" Gagal (rc=%d), akan coba lagi nanti.\n", mqttClient.state());            
            return false;                                                                            
        }                                                                                            
}

// RING BUFFER LOGIC & RULE-BASED FUSION
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

// TASK 1: SENSOR ACQUISITION & EDGE PROCESSING
void sensorTask(void *pvParameters) {
    uint32_t sequenceCounter = 0;
    Serial.println("[SENSOR] Task sensor dimulai...");

    vTaskDelay(pdMS_TO_TICKS(2000));

    for (;;) {
        TickType_t xLastWakeTime = xTaskGetTickCount();

        float rh = dht.readHumidity();
        float temp = dht.readTemperature();
        float lux = lightMeter.readLightLevel();

        if (isnan(temp) || isnan(rh)) {
            vTaskDelay(pdMS_TO_TICKS(250));
            rh = dht.readHumidity();
            temp = dht.readTemperature();
        }

        bool dhtValid = !isnan(temp) && !isnan(rh);
        bool luxValid = (lux >= 0.0f);

        float trend5m = 0.0f;
        if (dhtValid) {
            trend5m = updateAndComputeTrend(temp);
        }

        String tState = classifyThermalState(temp, trend5m, dhtValid);
        String lState = classifyLightState(lux, luxValid);
        sequenceCounter++;

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
                      sequenceCounter, 
                      dhtValid ? temp : -999.0f, 
                      dhtValid ? rh : -999.0f, 
                      trend5m, tState.c_str(), 
                      luxValid ? lux : -1.0f, 
                      lState.c_str());

        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(SAMPLE_INTERVAL_MS));
    }
}

// TASK 2: WI-FI TELEMETRY & MQTT PUBLISH
void mqttTask(void *pvParameters) {
    uint32_t lastPublishedSeq = 0;

    for (;;) {
        connectWiFi();

        if (WiFi.status() != WL_CONNECTED) {
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }
        
        if (!mqttClient.connected()) {                                                           
            connectMQTT();                                                                       
            vTaskDelay(pdMS_TO_TICKS(2000));             
            continue;                                                                            
        }
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

void scanI2CDevices() {
    Serial.println("[I2C] Memindai bus I2C (SDA=21, SCL=22)...");
    byte count = 0;
    for (byte addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            Serial.printf("[I2C] Ditemukan perangkat pada alamat 0x%02X!\n", addr);
            count++;
        }
    }
    if (count == 0) {
        Serial.println("[I2C] PERINGATAN: Tidak ada perangkat I2C yang merespons!");
    }
}

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== DigiDAW Edge Node Booting ===");

    dht.begin();
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    Wire.setClock(100000); 
    delay(100);

    scanI2CDevices();

    if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x23, &Wire)) {
        Serial.println("[INIT] BH1750 siap pada alamat 0x23.");
    } else if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x5C, &Wire)) {
        Serial.println("[INIT] BH1750 siap pada alamat 0x5C.");
    } else {
        Serial.println("[ERROR] BH1750 tidak merespons perintah konfigurasi I2C!");
    }

    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setBufferSize(512);
    mqttClient.setSocketTimeout(3);

    dataMutex = xSemaphoreCreateMutex();
    latestData.seqId = 0;

    xTaskCreatePinnedToCore(sensorTask, "SensorTask", 4096, NULL, 2, NULL, 1);
    xTaskCreatePinnedToCore(mqttTask,   "MqttTask",   4096, NULL, 1, NULL, 0);
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(1000));
}
