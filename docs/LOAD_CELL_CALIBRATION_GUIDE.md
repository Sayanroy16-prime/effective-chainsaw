# HX711 5kg Load Cell Calibration Guide

This guide walks you through calibrating the HX711 strain gauge amplifier on your Smart Ration Dispenser to ensure accurate dispensing cutoff (within ±1 to 2 grams).

---

## Equipment Needed
1. Your assembled ESP32 + HX711 + 5kg Load Cell platform.
2. A known reference weight (e.g. A sealed 500g salt/sugar packet or an item weighed on a kitchen scale).
3. Arduino IDE with the **HX711 by Bogdan Necula** library installed.

---

## Calibration Sketch

Upload this calibration sketch to your ESP32:

```cpp
#include "HX711.h"

// Pin configuration
const int LOADCELL_DOUT_PIN = 32;
const int LOADCELL_SCK_PIN = 33;

HX711 scale;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== HX711 Load Cell Calibration ===");
  Serial.println("Ensure the scale platform is empty.");

  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  delay(500);

  if (!scale.is_ready()) {
    Serial.println("HX711 not found! Check wiring.");
    while (1);
  }

  // Set initial scale to 1 to read raw ADC counts
  scale.set_scale();
  scale.tare(); // Zero the scale
  Serial.println("Tare done. Place your known weight (e.g., 500g) on the scale platform now.");
}

void loop() {
  if (Serial.available()) {
    char temp = Serial.read();
    if (temp == 'c' || temp == 'C') {
      long rawReading = scale.get_units(10);
      Serial.print("Raw average reading: ");
      Serial.println(rawReading);

      // Example: If placing 500g gives raw reading of 209600
      // Calibration factor = rawReading / knownWeight
      // Factor = 209600 / 500 = 419.2
      Serial.println("Enter known weight in grams (e.g. 500):");
      while (!Serial.available());
      float knownWeight = Serial.parseFloat();

      float calibrationFactor = rawReading / knownWeight;
      Serial.print("Calculated CALIBRATION_FACTOR: ");
      Serial.println(calibrationFactor);
      Serial.println("Update this value in 'firmware/config.h' under CALIBRATION_FACTOR!");
    }
  }

  // Continuously print raw weight
  Serial.print("Current reading: ");
  Serial.println(scale.get_units(2));
  delay(500);
}
```

---

## Calibration Steps:
1. Upload the sketch and open Serial Monitor at **115200 baud**.
2. Make sure the load cell platform has nothing resting on it.
3. Once the sketch finishes taring, place your known weight (e.g., exactly 500g) on the platform.
4. Send `c` in the Serial Monitor input.
5. Enter the known weight (e.g. `500`).
6. Copy the resulting calibration factor (typically around `400.0` to `450.0`).
7. Open `firmware/config.h` and update:
   ```cpp
   #define CALIBRATION_FACTOR 419.2f
   ```
