#ifndef WEIGHING_MANAGER_H
#define WEIGHING_MANAGER_H

#include <Arduino.h>
#include <HX711.h>
#include "config.h"

class WeighingManager {
private:
  HX711 scale;
  float calibrationFactor;
  float tareOffsetGrams;
  bool isReady;

public:
  WeighingManager() : calibrationFactor(CALIBRATION_FACTOR), tareOffsetGrams(0.0f), isReady(false) {}

  bool begin() {
    scale.begin(HX711_DOUT_PIN, HX711_SCK_PIN);
    delay(200);

    if (scale.wait_ready_timeout(1000)) {
      scale.set_scale(calibrationFactor);
      scale.tare(); // Zero the scale
      isReady = true;
      Serial.println(F("[HX711] Load cell ready. Calibration factor set."));
      return true;
    } else {
      Serial.println(F("[HX711] Warning: Load cell not detected. Check DOUT/SCK pins."));
      isReady = false;
      return false;
    }
  }

  void tare() {
    if (scale.is_ready()) {
      scale.tare(5); // Average 5 readings for clean tare
      Serial.println(F("[HX711] Scale tared to 0.0g"));
    }
  }

  float getWeightGrams(uint8_t readCount = 2) {
    if (!scale.is_ready()) return 0.0f;
    float reading = scale.get_units(readCount);
    // Ignore small negative drift
    if (reading < 0.0f && reading > -1.5f) reading = 0.0f;
    return reading;
  }

  void setCalibrationFactor(float factor) {
    calibrationFactor = factor;
    scale.set_scale(factor);
  }

  bool isLoadCellReady() const {
    return isReady;
  }
};

#endif // WEIGHING_MANAGER_H
