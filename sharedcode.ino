#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_Fingerprint.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_PWMServoDriver.h>
#include "HX711.h"

// --- Hardware Pin Definitions ---
#define SS_PIN          5
#define RST_PIN         4
#define SCK_PIN        18
#define MISO_PIN       19
#define MOSI_PIN       23

#define FINGER_RX      16
#define FINGER_TX      17

#define HX711_DOUT     13
#define HX711_SCK       2

#define BTN_ENROLL     27
#define BTN_NAV        32
#define BTN_SELECT     33

#define IR_CONTAINER   25 // LOW = Container Present, HIGH = Missing
#define IR_STOCK       26 // LOW = Stock Available, HIGH = Empty

#define SERVOMIN      150 // PCA9685 pulse width for 0 degrees
#define SERVOMAX      600 // PCA9685 pulse width for 180 degrees

// --- Hardware Peripheral Instantiations ---
MFRC522 rfid(SS_PIN, RST_PIN);
HardwareSerial fingerSerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fingerSerial);
LiquidCrystal_I2C lcd(0x27, 16, 2);
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);
HX711 scale;

// --- System State Machine & Variables ---
enum SystemState { IDLE, AUTHENTICATING, SELECT_ITEM, DISPENSING };
SystemState currentState = IDLE;

String scannedUID = "";
int authenticatedFpID = -1;
float localQuota = 5.0; // Default offline ration quota in kg
int selectedItem = 0;   // 0: Rice, 1: Wheat, 2: Sugar
const char* items[] = {"Rice", "Wheat", "Sugar"};
int nextEnrollID = 1;
unsigned long lastTelemetryTime = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==================================================");
  Serial.println("  OFFLINE SMART RATION SYSTEM - STANDALONE CODE   ");
  Serial.println("==================================================");

  // 1. Initialize GPIO Push Buttons & IR Sensors
  pinMode(BTN_ENROLL, INPUT_PULLUP);
  pinMode(BTN_NAV, INPUT_PULLUP);
  pinMode(BTN_SELECT, INPUT_PULLUP);
  pinMode(IR_CONTAINER, INPUT);
  pinMode(IR_STOCK, INPUT);

  // 2. Initialize Shared I2C Bus (LCD & PCA9685 Servo Driver)
  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("System Starting");

  pwm.begin();
  pwm.setPWMFreq(50);
  closeAllGates();

  // 3. Initialize HX711 Load Cell Scale
  scale.begin(HX711_DOUT, HX711_SCK);
  scale.set_scale(420.0); // Replace with your load cell calibration factor
  scale.tare();

  // 4. Initialize R307S Fingerprint Sensor
  fingerSerial.begin(57600, SERIAL_8N1, FINGER_RX, FINGER_TX);
  finger.begin(57600);
  if (finger.verifyPassword()) {
    Serial.println("[SYSTEM] Fingerprint Sensor Connected.");
  } else {
    Serial.println("[WARNING] Fingerprint Sensor Not Detected!");
  }

  // 5. Initialize MFRC522 RFID Reader (Software CS Pin Bypass Fix)
  pinMode(SS_PIN, OUTPUT);
  digitalWrite(SS_PIN, HIGH);
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, -1);
  SPI.setFrequency(1000000); // 1 MHz clock for SPI stability
  rfid.PCD_Init();
  delay(100);
  rfid.PCD_SetAntennaGain(MFRC522::RxGain_max);

  showIdleScreen();
}

void loop() {
  // --- Periodic Telemetry Output to Serial Monitor (500ms) ---
  if (millis() - lastTelemetryTime >= 500) {
    lastTelemetryTime = millis();
    printContinuousTelemetry();
  }

  // --- Check Enrollment/Signup Button ---
  if (digitalRead(BTN_ENROLL) == LOW) {
    delay(200); // Debounce
    runSignupWorkflow();
    showIdleScreen();
  }

  // --- Main System Navigation State Machine ---
  switch (currentState) {
    case IDLE:
      if (checkRFID()) {
        Serial.println("\n>>> [EVENT] RFID Card Scanned: " + scannedUID);
        lcd.clear();
        lcd.print("Card Scanned!");
        lcd.setCursor(0, 1);
        lcd.print("Place Finger...");
        currentState = AUTHENTICATING;
      }
      break;

    case AUTHENTICATING: {
      int fpResult = checkFingerprint();
      if (fpResult > 0) {
        authenticatedFpID = fpResult;
        Serial.printf("\n>>> [EVENT] Fingerprint Verified! ID: %d\n", fpResult);
        lcd.clear();
        lcd.print("Auth Success!");
        delay(1000);
        currentState = SELECT_ITEM;
        updateItemDisplay();
      }
      break;
    }

    case SELECT_ITEM:
      // Navigate Button (GPIO 32): Cycles between Rice -> Wheat -> Sugar
      if (digitalRead(BTN_NAV) == LOW) {
        delay(200);
        selectedItem = (selectedItem + 1) % 3;
        Serial.println(">>> [NAV] Switched Commodity To: " + String(items[selectedItem]));
        updateItemDisplay();
      }

      // Select Button (GPIO 33): Confirms item selection
      if (digitalRead(BTN_SELECT) == LOW) {
        delay(200);

        // Safety Interlock 1: Hopper Stock Level Check
        if (digitalRead(IR_STOCK) == HIGH) { // Sensor outputs HIGH when unobstructed (Empty)
          Serial.println("[SAFETY INTERLOCK] Stock Hopper Empty!");
          lcd.clear();
          lcd.print("Error: Hopper");
          lcd.setCursor(0, 1);
          lcd.print("Out of Stock!");
          delay(2000);
          updateItemDisplay();
          break;
        }

        // Safety Interlock 2: Container Presence Check
        if (digitalRead(IR_CONTAINER) == HIGH) { // HIGH = No Container detected under spout
          Serial.println("[SAFETY INTERLOCK] Container Missing!");
          lcd.clear();
          lcd.print("Place Container");
          lcd.setCursor(0, 1);
          lcd.print("Under Spout!");
          delay(2000);
          updateItemDisplay();
          break;
        }

        // Check Local Quota Balance
        if (localQuota >= 0.5) {
          currentState = DISPENSING;
        } else {
          lcd.clear();
          lcd.print("Quota Exceeded!");
          delay(2000);
          resetSystem();
        }
      }
      break;

    case DISPENSING:
      dispenseItem(selectedItem, 0.5); // Dispense 0.5 kg batch
      localQuota -= 0.5;
      Serial.printf(">>> [SYSTEM] Dispense Finished. Remaining Quota: %.2f kg\n", localQuota);
      resetSystem();
      break;
  }
}

// --- Serial Telemetry & Display Functions ---
void printContinuousTelemetry() {
  float weight = scale.get_units(1) / 1000.0;
  bool containerPresent = (digitalRead(IR_CONTAINER) == LOW);
  bool stockPresent     = (digitalRead(IR_STOCK) == LOW);
  bool btnEnroll        = (digitalRead(BTN_ENROLL) == LOW);
  bool btnNav           = (digitalRead(BTN_NAV) == LOW);
  bool btnSelect        = (digitalRead(BTN_SELECT) == LOW);

  Serial.printf("[STATE]: %-13s | [W]: %5.2fkg | [CONTAINER]: %-7s | [STOCK]: %-5s | [BTNS]: %s %s %s\n",
                getStateString(currentState).c_str(),
                weight < 0 ? 0.0 : weight,
                containerPresent ? "PRESENT" : "MISSING",
                stockPresent     ? "OK"      : "EMPTY",
                btnEnroll ? "[ENR]" : " - ",
                btnNav    ? "[NAV]" : " - ",
                btnSelect ? "[SEL]" : " - ");
}

String getStateString(SystemState state) {
  switch(state) {
    case IDLE:           return "IDLE";
    case AUTHENTICATING: return "AUTH_FP";
    case SELECT_ITEM:    return "SELECT_ITEM";
    case DISPENSING:     return "DISPENSING";
    default:             return "UNKNOWN";
  }
}

void showIdleScreen() {
  lcd.clear();
  lcd.print("Smart Ration System");
  lcd.setCursor(0, 1);
  lcd.print("Scan RFID Card");
}

void updateItemDisplay() {
  lcd.clear();
  lcd.print("Item: ");
  lcd.print(items[selectedItem]);
  lcd.setCursor(0, 1);
  lcd.print("Q: ");
  lcd.print(localQuota, 1);
  lcd.print("kg [SEL]");
}

void resetSystem() {
  scannedUID = "";
  authenticatedFpID = -1;
  currentState = IDLE;
  showIdleScreen();
}

// --- PCA9685 Servo Motor Operations ---
void setServoAngle(uint8_t channel, uint8_t angle) {
  uint16_t pulse = map(angle, 0, 180, SERVOMIN, SERVOMAX);
  pwm.setPWM(channel, 0, pulse);
}

void closeAllGates() {
  setServoAngle(0, 0); // Rice Gate Channel 0
  setServoAngle(1, 0); // Wheat Gate Channel 1
  setServoAngle(2, 0); // Sugar Gate Channel 2
}

// --- Sensor Drivers ---
bool checkRFID() {
  if (!rfid.PICC_IsNewCardPresent()) return false;
  if (!rfid.PICC_ReadCardSerial()) return false;

  scannedUID = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) scannedUID += "0";
    scannedUID += String(rfid.uid.uidByte[i], HEX);
  }
  scannedUID.toUpperCase();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  return true;
}

int checkFingerprint() {
  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) return -1;
  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) return -1;
  p = finger.fingerFastSearch();
  if (p == FINGERPRINT_OK) return finger.fingerID;
  return -1;
}

// --- Dispensing Logic with Real-time Weight & Safety Monitoring ---
void dispenseItem(uint8_t channel, float targetWeightKg) {
  lcd.clear();
  lcd.print("Dispensing ");
  lcd.print(items[channel]);
  
  scale.tare();
  delay(200);

  setServoAngle(channel, 90); // Open Servo Gate (90 degrees)
  Serial.printf(">>> [SERVO] Opening Gate on PCA9685 Channel %d\n", channel);

  float currentWeight = 0.0;
  bool aborted = false;

  while (currentWeight < targetWeightKg) {
    // Continuous Safety Interlock: Stop dispensing if container is moved away
    if (digitalRead(IR_CONTAINER) == HIGH) {
      setServoAngle(channel, 0); // Emergency gate close
      Serial.println("\n[EMERGENCY ABORT] Container pulled away mid-dispense!");
      lcd.clear();
      lcd.print("ABORTED!");
      lcd.setCursor(0, 1);
      lcd.print("Container Moved");
      aborted = true;
      delay(3000);
      break;
    }

    currentWeight = scale.get_units(3) / 1000.0; // Scale reading to Kg
    lcd.setCursor(0, 1);
    lcd.print("W: ");
    lcd.print(currentWeight, 2);
    lcd.print(" / ");
    lcd.print(targetWeightKg, 1);
    lcd.print("kg");
    delay(50);
  }

  setServoAngle(channel, 0); // Close Servo Gate (0 degrees)
  Serial.printf(">>> [SERVO] Closed Gate on PCA9685 Channel %d\n", channel);

  if (!aborted) {
    lcd.clear();
    lcd.print("Dispense Done!");
    delay(2000);
  }
}

// --- Offline User Signup Workflow ---
void runSignupWorkflow() {
  Serial.println("\n>>> [MODE] SIGNUP / ENROLLMENT STARTED");
  lcd.clear();
  lcd.print("MODE: New Signup");
  lcd.setCursor(0, 1);
  lcd.print("Scan RFID Card");

  String newUID = "";
  while (newUID == "") {
    if (checkRFID()) {
      newUID = scannedUID;
    }
    if (digitalRead(BTN_NAV) == LOW) { // Press NAV to abort setup
      Serial.println(">>> [MODE] Signup Aborted.");
      return; 
    }
    delay(100);
  }

  Serial.println(">>> [SIGNUP] RFID Card Tag Captured: " + newUID);
  lcd.clear();
  lcd.print("UID Captured!");
  lcd.setCursor(0, 1);
  lcd.print("Place Finger...");
  delay(1500);

  int newFpID = enrollFingerprint(nextEnrollID);
  if (newFpID <= 0) {
    Serial.println(">>> [SIGNUP] Fingerprint Enrollment Failed.");
    lcd.clear();
    lcd.print("Enroll Failed!");
    delay(2000);
    return;
  }

  Serial.printf(">>> [SIGNUP] SUCCESS! Enrolled Finger ID #%d to RFID Card: %s\n", newFpID, newUID.c_str());
  lcd.clear();
  lcd.print("User Enrolled!");
  lcd.setCursor(0, 1);
  lcd.print("ID: ");
  lcd.print(newFpID);
  nextEnrollID++;
  delay(2000);
}

int enrollFingerprint(int id) {
  int p = -1;
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) continue;
    if (p != FINGERPRINT_OK) return -1;
  }
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) return -1;

  lcd.clear();
  lcd.print("Remove Finger");
  delay(2000);
  while (p != FINGERPRINT_NOFINGER) { p = finger.getImage(); }

  lcd.clear();
  lcd.print("Place Same Again");
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) continue;
    if (p != FINGERPRINT_OK) return -1;
  }
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) return -1;

  p = finger.createModel();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.storeModel(id);
  if (p == FINGERPRINT_OK) return id;
  return -1;
}