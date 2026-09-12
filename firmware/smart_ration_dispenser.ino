/**
 * Smart Ration Dispenser - Main ESP32 Firmware
 * Hardware: ESP32-WROOM-32, MFRC522 RFID, R307S Fingerprint, HX711 5kg Load Cell,
 *           4x MG995 Servos, 2x IR Sensors, DFPlayer Mini, 20x4 I2C LCD
 */

#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>
#include "config.h"
#include "audio_manager.h"
#include "display_manager.h"
#include "weighing_manager.h"
#include "servo_controller.h"
#include "biometric_manager.h"
#include "api_client.h"

// Hardware Instances
MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);
AudioManager audio;
DisplayManager display;
WeighingManager weighing;
ServoController servos;
BiometricManager biometric;
ApiClient api;

// State Machine States
enum DispenserState {
  STATE_IDLE,
  STATE_CARD_SCANNED,
  STATE_BIOMETRIC_AUTH,
  STATE_SELECT_GRAIN,
  STATE_WAIT_CONTAINER,
  STATE_DISPENSING,
  STATE_COMPLETE,
  STATE_ERROR
};

DispenserState currentState = STATE_IDLE;

// Active Session Variables
String currentCardUid = "";
BeneficiaryAuthResult currentBeneficiary;
String selectedCommodity = "rice";
int selectedServoId = 1;
float targetWeightG = 500.0f;
float finalDispensedWeightG = 0.0f;
unsigned long stateStartTime = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println(F("\n======================================================="));
  Serial.println(F("     SMART RATION DISPENSER (ESP32-WROOM-32)          "));
  Serial.println(F("======================================================="));

  // 1. Initialize IR Sensors (Input Only GPIOs 34, 35)
  pinMode(IR1_CONTAINER_PIN, INPUT);
  pinMode(IR2_HOPPER_PIN, INPUT);

  // 2. Initialize LCD Display
  display.begin();
  display.showWelcomeScreen();

  // 3. Initialize Audio
  audio.begin();
  audio.playPrompt(TRACK_WELCOME_SCAN_CARD);

  // 4. Initialize Servos
  servos.begin();

  // 5. Initialize Load Cell
  weighing.begin();

  // 6. Initialize Fingerprint Sensor
  biometric.begin();

  // 7. Initialize SPI & RFID Reader
  SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);
  rfid.PCD_Init();
  delay(100);
  rfid.PCD_DumpVersionToSerial();

  // 8. Connect to Wi-Fi and Edge Backend
  api.begin();

  Serial.println(F("[SYSTEM] All peripherals initialized. Ready for RFID scan."));
}

void loop() {
  switch (currentState) {
    
    // -------------------------------------------------------------
    // 1. IDLE: Wait for Beneficiary RFID Card
    // -------------------------------------------------------------
    case STATE_IDLE: {
      if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
        delay(50);
        return;
      }

      // Convert UID bytes to Hex String
      currentCardUid = "";
      for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) currentCardUid += "0";
        currentCardUid += String(rfid.uid.uidByte[i], HEX);
      }
      currentCardUid.toUpperCase();
      Serial.printf("\n[RFID] Scanned Card UID: %s\n", currentCardUid.c_str());

      rfid.PICC_HaltA();
      rfid.PCD_StopCrypto1();

      currentState = STATE_CARD_SCANNED;
      break;
    }

    // -------------------------------------------------------------
    // 2. CARD SCANNED: Verify Entitlement & Duplicate Collection
    // -------------------------------------------------------------
    case STATE_CARD_SCANNED: {
      display.showCardVerified("Authenticating...", "Checking Quota");

      bool verified = api.verifyCard(currentCardUid.c_str(), 0, currentBeneficiary);

      if (currentBeneficiary.alreadyCollected) {
        Serial.println(F("[FRAUD PREVENTED] Ration already collected this calendar month!"));
        display.showAlreadyCollected();
        audio.playPrompt(TRACK_ALREADY_COLLECTED);
        delay(4000);
        resetToIdle();
        return;
      }

      if (!verified) {
        Serial.println(F("[AUTH FAIL] Card UID not registered in ration database."));
        display.showError("INVALID CARD / UID", "அட்டை செல்லாது");
        audio.playPrompt(TRACK_INVALID_CARD);
        delay(3000);
        resetToIdle();
        return;
      }

      // Beneficiary is eligible!
      Serial.printf("[AUTH SUCCESS] Welcome %s (Ration: %s)\n", currentBeneficiary.name, currentBeneficiary.rationCardNo);
      display.showCardVerified(currentBeneficiary.name, currentBeneficiary.rationCardNo);
      audio.playPrompt(TRACK_AUTH_SUCCESS);
      delay(1500);

      // Check if biometric authentication is required
      if (biometric.isAvailable() && currentBeneficiary.fingerprintId > 0) {
        audio.playPrompt(TRACK_SCAN_FINGERPRINT);
        currentState = STATE_BIOMETRIC_AUTH;
        stateStartTime = millis();
      } else {
        // Biometric optional or bypassed
        currentState = STATE_SELECT_GRAIN;
      }
      break;
    }

    // -------------------------------------------------------------
    // 3. BIOMETRIC 2FA: R307S Fingerprint Verification
    // -------------------------------------------------------------
    case STATE_BIOMETRIC_AUTH: {
      Serial.println(F("[BIOMETRIC] Requesting finger scan on R307S..."));
      int matchedId = biometric.scanAndMatchFingerprint(12000); // 12s timeout

      if (matchedId == currentBeneficiary.fingerprintId || matchedId > 0) {
        Serial.printf("[BIOMETRIC PASS] Fingerprint ID #%d confirmed!\n", matchedId);
        currentState = STATE_SELECT_GRAIN;
      } else if (matchedId == -2) {
        Serial.println(F("[BIOMETRIC REJECT] Fingerprint template mismatch!"));
        display.showError("BIOMETRIC FAILED", "கைரேகை பொருந்தவில்லை");
        audio.playPrompt(TRACK_FP_MISMATCH);
        delay(3000);
        resetToIdle();
      } else {
        Serial.println(F("[BIOMETRIC TIMEOUT] No finger detected."));
        resetToIdle();
      }
      break;
    }

    // -------------------------------------------------------------
    // 4. GRAIN SELECTION: Menu & Entitlement Lookup
    // -------------------------------------------------------------
    case STATE_SELECT_GRAIN: {
      display.showCommodityMenu();
      audio.playPrompt(TRACK_SELECT_GRAIN);

      // In production, user presses pushbutton 1-4.
      // Default to Rice (Gate 1, 500g) for automated demonstration
      selectedCommodity = "rice";
      selectedServoId = 1;
      targetWeightG = currentBeneficiary.riceQuotaG > 0 ? currentBeneficiary.riceQuotaG : 500.0f;

      Serial.printf("[SELECTION] Auto-selected: %s (%0.1fg)\n", selectedCommodity.c_str(), targetWeightG);
      delay(1500);

      currentState = STATE_WAIT_CONTAINER;
      stateStartTime = millis();
      break;
    }

    // -------------------------------------------------------------
    // 5. WAIT CONTAINER: IR Sensor 1 (Container Presence) Check
    // -------------------------------------------------------------
    case STATE_WAIT_CONTAINER: {
      display.showWaitingContainer();
      audio.playPrompt(TRACK_PLACE_CONTAINER);

      unsigned long startWait = millis();
      bool containerDetected = false;

      while (millis() - startWait < CONTAINER_TIMEOUT_MS) {
        // IR Sensor 1: Active LOW when container placed beneath funnel
        if (digitalRead(IR1_CONTAINER_PIN) == LOW) {
          containerDetected = true;
          break;
        }
        delay(100);
      }

      if (!containerDetected) {
        Serial.println(F("[CONTAINER ERROR] Timeout: No container placed on platform."));
        display.showError("NO CONTAINER FOUND", "பாத்திரம் இல்லை");
        delay(2500);
        resetToIdle();
        return;
      }

      // Container detected! Settle and Tare Scale
      Serial.println(F("[IR-1] Container present. Auto-zeroing tare weight..."));
      delay(500);
      weighing.tare();

      currentState = STATE_DISPENSING;
      break;
    }

    // -------------------------------------------------------------
    // 6. DISPENSING: Open Servo Gate & Monitor Load Cell
    // -------------------------------------------------------------
    case STATE_DISPENSING: {
      Serial.printf("[DISPENSING] Opening Gate #%d for %s. Target: %.1fg\n", selectedServoId, selectedCommodity.c_str(), targetWeightG);
      audio.playPrompt(TRACK_DISPENSING);

      // Open servo flap
      servos.openGate(selectedServoId);

      float currentWeight = 0.0f;
      float cutoffThreshold = targetWeightG - OVERSHOOT_COMPENSATION_G;
      unsigned long dispenseStart = millis();

      while (currentWeight < cutoffThreshold) {
        // Continuous safety check: if container removed mid-dispense, instantly close gate!
        if (digitalRead(IR1_CONTAINER_PIN) == HIGH) {
          servos.closeAllGates();
          Serial.println(F("[SAFETY INTERRUPT] Container removed during dispensing!"));
          display.showError("CONTAINER REMOVED!", "பாத்திரம் எடுக்கப்பட்டது");
          audio.playPrompt(TRACK_CONTAINER_REMOVED_ERROR);
          delay(3000);
          resetToIdle();
          return;
        }

        currentWeight = weighing.getWeightGrams(1);
        display.showDispensing(selectedCommodity.c_str(), currentWeight, targetWeightG);

        // Update IoT backend telemetry every 300ms
        static unsigned long lastTelem = 0;
        if (millis() - lastTelem > 300) {
          lastTelem = millis();
          api.sendTelemetry("DISPENSING", currentWeight, targetWeightG, true, selectedServoId);
        }

        // Safety timeout: 25s max dispense duration
        if (millis() - dispenseStart > 25000) {
          Serial.println(F("[TIMEOUT] Dispense safety timeout reached."));
          break;
        }

        delay(30);
      }

      // Target reached! Instantly close servo flap
      servos.closeGate(selectedServoId);
      delay(400); // Allow grain in flight to settle on the pan

      finalDispensedWeightG = weighing.getWeightGrams(5);
      Serial.printf("[CUTOFF REACHED] Final scale reading: %.2fg\n", finalDispensedWeightG);

      currentState = STATE_COMPLETE;
      break;
    }

    // -------------------------------------------------------------
    // 7. COMPLETE: Commit Transaction & Audio Guidance
    // -------------------------------------------------------------
    case STATE_COMPLETE: {
      display.showComplete(finalDispensedWeightG);
      audio.playPrompt(TRACK_DISPENSE_COMPLETE);

      // Post transaction to Edge Backend / Cloud
      api.postDispenseRecord(
        currentCardUid.c_str(),
        selectedCommodity.c_str(),
        finalDispensedWeightG,
        "RFID+BIOMETRIC"
      );

      delay(3000);
      audio.playPrompt(TRACK_THANK_YOU);
      delay(2000);

      resetToIdle();
      break;
    }

    case STATE_ERROR:
    default:
      resetToIdle();
      break;
  }
}

void resetToIdle() {
  servos.closeAllGates();
  display.showWelcomeScreen();
  currentCardUid = "";
  currentState = STATE_IDLE;
  api.sendTelemetry("IDLE", 0, 0, false, 0);
  Serial.println(F("[SYSTEM] Reset to IDLE. Awaiting next beneficiary card."));
}
