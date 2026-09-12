#ifndef BIOMETRIC_MANAGER_H
#define BIOMETRIC_MANAGER_H

#include <Arduino.h>
#include <Adafruit_Fingerprint.h>
#include "config.h"

class BiometricManager {
private:
  HardwareSerial fpSerial;
  Adafruit_Fingerprint finger;
  bool isInitialized;

public:
  BiometricManager() : fpSerial(2), finger(&fpSerial), isInitialized(false) {}

  bool begin() {
    fpSerial.begin(FP_BAUD_RATE, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
    delay(200);

    finger.begin(FP_BAUD_RATE);

    if (finger.verifyPassword()) {
      Serial.println(F("[R307S] Optical Fingerprint Sensor found!"));
      finger.getParameters();
      Serial.printf("[R307S] Capacity: %d templates | Security level: %d\n", finger.capacity, finger.security_level);
      isInitialized = true;
      return true;
    } else {
      Serial.println(F("[R307S] Warning: Did not find fingerprint sensor. Check UART2 wiring (GPIO 16/17)."));
      isInitialized = false;
      return false;
    }
  }

  // Returns matched template ID (>0) or -1 if no match / error
  int scanAndMatchFingerprint(uint32_t timeoutMs = 15000) {
    if (!isInitialized) return -1;

    Serial.println(F("[R307S] Waiting for valid finger..."));
    uint32_t start = millis();

    while (millis() - start < timeoutMs) {
      uint8_t p = finger.getImage();
      if (p == FINGERPRINT_OK) {
        Serial.println(F("[R307S] Image taken."));
        
        p = finger.image2Tz();
        if (p != FINGERPRINT_OK) {
          Serial.println(F("[R307S] Image conversion failed. Try again."));
          continue;
        }

        p = finger.fingerSearch();
        if (p == FINGERPRINT_OK) {
          Serial.printf("[R307S] Match found! ID #%d with confidence of %d\n", finger.fingerID, finger.confidence);
          return finger.fingerID;
        } else if (p == FINGERPRINT_NOTFOUND) {
          Serial.println(F("[R307S] Fingerprint did not match database!"));
          return -2; // Mismatch
        }
      }
      delay(50);
    }

    Serial.println(F("[R307S] Biometric scan timed out."));
    return -1; // Timeout
  }

  bool isAvailable() const {
    return isInitialized;
  }
};

#endif // BIOMETRIC_MANAGER_H
