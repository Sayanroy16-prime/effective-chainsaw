#ifndef API_CLIENT_H
#define API_CLIENT_H

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "config.h"

struct BeneficiaryAuthResult {
  bool success;
  bool alreadyCollected;
  char name[32];
  char rationCardNo[24];
  int fingerprintId;
  int riceQuotaG;
  int wheatQuotaG;
  int dalQuotaG;
  int sugarQuotaG;
  char errorMessage[64];
};

class ApiClient {
private:
  const char* ssid;
  const char* password;
  const char* serverUrl;
  Preferences prefs;
  bool wifiConnected;

public:
  ApiClient() : ssid(WIFI_SSID), password(WIFI_PASSWORD), serverUrl(BACKEND_SERVER), wifiConnected(false) {}

  void begin() {
    prefs.begin("ration_pds", false);
    connectWiFi();
  }

  void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      return;
    }

    Serial.printf("[WIFI] Connecting to SSID: %s ...\n", ssid);
    WiFi.begin(ssid, password);

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 8000) {
      delay(300);
      Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      Serial.printf("\n[WIFI] Connected! IP: %s (RSSI: %d dBm)\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
      wifiConnected = false;
      Serial.println(F("\n[WIFI] Connection failed. Operating in offline edge cache mode."));
    }
  }

  bool isConnected() {
    return WiFi.status() == WL_CONNECTED;
  }

  // 1. Verify Card UID and optional Biometric Fingerprint
  bool verifyCard(const char* cardUid, int fingerprintId, BeneficiaryAuthResult& result) {
    memset(&result, 0, sizeof(result));

    if (!isConnected()) {
      Serial.println(F("[API] Offline. Using local flash memory cache..."));
      // Basic offline fallback: check if UID matches last known card
      String storedUid = prefs.getString("card_uid", "");
      if (storedUid.length() > 0 && storedUid.equalsIgnoreCase(cardUid)) {
        result.success = true;
        result.alreadyCollected = prefs.getBool("collected", false);
        strncpy(result.name, prefs.getString("name", "Cardholder").c_str(), sizeof(result.name) - 1);
        strncpy(result.rationCardNo, prefs.getString("card_no", "TN-OFFLINE").c_str(), sizeof(result.rationCardNo) - 1);
        result.riceQuotaG = 500;
        result.wheatQuotaG = 500;
        result.dalQuotaG = 250;
        result.sugarQuotaG = 250;
        return true;
      }
      strncpy(result.errorMessage, "Offline & Card not cached", sizeof(result.errorMessage) - 1);
      return false;
    }

    HTTPClient http;
    String endpoint = String(serverUrl) + "/api/dispenser/verify";
    http.begin(endpoint);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> doc;
    doc["card_uid"] = cardUid;
    if (fingerprintId > 0) doc["fingerprint_id"] = fingerprintId;

    String requestBody;
    serializeJson(doc, requestBody);

    int httpCode = http.POST(requestBody);
    Serial.printf("[API POST] /verify -> HTTP %d\n", httpCode);

    if (httpCode == 200) {
      String response = http.getString();
      StaticJsonDocument<1024> resDoc;
      deserializeJson(resDoc, response);

      result.success = true;
      result.alreadyCollected = false;
      JsonObject ben = resDoc["beneficiary"];
      strncpy(result.name, ben["name"] | "Beneficiary", sizeof(result.name) - 1);
      strncpy(result.rationCardNo, ben["ration_card_no"] | "UNKNOWN", sizeof(result.rationCardNo) - 1);
      result.fingerprintId = ben["fingerprint_id"] | 0;
      result.riceQuotaG = ben["rice_quota_g"] | 500;
      result.wheatQuotaG = ben["wheat_quota_g"] | 500;
      result.dalQuotaG = ben["dal_quota_g"] | 250;
      result.sugarQuotaG = ben["sugar_quota_g"] | 250;

      // Cache to flash for offline resilience
      prefs.putString("card_uid", cardUid);
      prefs.putString("name", result.name);
      prefs.putString("card_no", result.rationCardNo);
      prefs.putBool("collected", false);

      http.end();
      return true;
    } else if (httpCode == 403) {
      // Duplicate collection prevented!
      result.success = false;
      result.alreadyCollected = true;
      strncpy(result.errorMessage, "Already collected this month", sizeof(result.errorMessage) - 1);
      http.end();
      return false;
    } else {
      result.success = false;
      result.alreadyCollected = false;
      strncpy(result.errorMessage, "Card verification failed", sizeof(result.errorMessage) - 1);
      http.end();
      return false;
    }
  }

  // 2. Commit Dispense Transaction
  bool postDispenseRecord(const char* cardUid, const char* commodity, float dispensedWeightG, const char* authMode = "RFID+BIOMETRIC") {
    if (!isConnected()) {
      Serial.println(F("[API] Storing transaction in flash queue for later sync..."));
      prefs.putBool("collected", true);
      prefs.putFloat("last_weight", dispensedWeightG);
      prefs.putString("last_comm", commodity);
      return true;
    }

    HTTPClient http;
    String endpoint = String(serverUrl) + "/api/dispenser/dispense";
    http.begin(endpoint);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> doc;
    doc["card_uid"] = cardUid;
    doc["commodity"] = commodity;
    doc["dispensed_weight_g"] = dispensedWeightG;
    doc["dispenser_id"] = DISPENSER_ID;
    doc["auth_mode"] = authMode;

    String requestBody;
    serializeJson(doc, requestBody);

    int httpCode = http.POST(requestBody);
    Serial.printf("[API POST] /dispense -> HTTP %d\n", httpCode);
    http.end();

    return (httpCode == 200);
  }

  // 3. Live Telemetry
  void sendTelemetry(const char* status, float weightG, float targetG, bool containerPresent, int activeServo) {
    if (!isConnected()) return;

    HTTPClient http;
    String endpoint = String(serverUrl) + "/api/dispenser/telemetry";
    http.begin(endpoint);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> doc;
    doc["status"] = status;
    doc["currentWeightG"] = weightG;
    doc["targetWeightG"] = targetG;
    doc["containerDetected"] = containerPresent;
    doc["activeServo"] = activeServo;
    doc["wifiRssi"] = WiFi.RSSI();

    String requestBody;
    serializeJson(doc, requestBody);
    http.POST(requestBody);
    http.end();
  }
};

#endif // API_CLIENT_H
