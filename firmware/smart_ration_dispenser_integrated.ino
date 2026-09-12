/**
 * =====================================================================
 * SMART RATION DISPENSER — IOT SUPABASE & LOCALHOST INTEGRATED FIRMWARE
 * =====================================================================
 * Hardware:
 *   - ESP32-WROOM-32 Dev Module
 *   - MFRC522 RFID (SS:5, RST:4, SCK:18, MISO:19, MOSI:23)
 *   - R307S Optical Fingerprint Sensor (UART2: RX=16, TX=17)
 *   - PCA9685 16-Channel PWM Servo Driver (I2C: SDA=21, SCL=22, Addr=0x40)
 *   - 16x2 I2C LCD Display (I2C: SDA=21, SCL=22, Addr=0x27)
 *   - HX711 Load Cell Amplifier (DOUT=13, SCK=2)
 *   - Pushbuttons: Enroll=GPIO 27, Nav=GPIO 32, Select/Confirm=GPIO 33
 *   - IR Sensors: Container=GPIO 25, Stock=GPIO 26
 * 
 * Cloud / Local Connectivity:
 *   - Communicates with Localhost backend (http://<MAC_IP>:3001/rest/v1)
 *     OR Cloud Supabase (https://<PROJECT_ID>.supabase.co/rest/v1)
 *   - User eligibility verification (GET /users?card_uid=eq.X)
 *   - Online enrollment registration (POST /users)
 *   - Dispense transaction logging (POST /transactions)
 * =====================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_Fingerprint.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_PWMServoDriver.h>
#include "HX711.h"

// =========================================================
// Network & Backend Configuration
// =========================================================
// Replace with your 2.4GHz Wi-Fi credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";

// Option A (Local Dashboard): "http://10.9.3.247:3001/rest/v1" (Mac LAN IP)
// Option B (Supabase Cloud):  "https://<YOUR-PROJECT-ID>.supabase.co/rest/v1"
const char* SUPABASE_URL  = "http://10.9.3.247:3001/rest/v1";
const char* SUPABASE_KEY  = "local-token"; // Supabase anon key if using cloud

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

#define SERVOMIN      150 // PCA9685 pulse width for 0 degrees (Closed)
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
int expectedFpID = -1;
String beneficiaryName = "";
bool isUserEligible = false;
int authenticatedFpID = -1;

float localQuota = 5.0; // Default offline ration quota in kg
int selectedItem = 0;   // 0: Rice, 1: Wheat, 2: Sugar
const char* items[] = {"Rice", "Wheat", "Sugar"};
int nextEnrollID = 1;
unsigned long lastTelemetryTime = 0;

// Function Prototypes
bool verifyUserWithDatabase(String uid);
bool logTransactionToDatabase(String uid, const char* item, float weightDispensed);
bool registerUserToDatabase(String uid, int fpId, String name);
int checkFingerprint();
bool checkRFID();
void printContinuousTelemetry();
String getStateString(SystemState state);
void showIdleScreen();
void updateItemDisplay();
void resetSystem();
void setServoAngle(uint8_t channel, uint8_t angle);
void closeAllGates();
void dispenseItem(uint8_t channel, float targetWeightKg);
void runSignupWorkflow();
int enrollFingerprint(int id);

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==================================================");
  Serial.println("  SMART RATION SYSTEM - SUPABASE & LOCALHOST CODE ");
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

  // 3. Connect to Wi-Fi
  lcd.setCursor(0, 1);
  lcd.print("WiFi Connecting.");
  Serial.printf("[WIFI] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 12000) {
    delay(400);
    Serial.print(".");
    lcd.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! ESP32 IP: %s\n", WiFi.localIP().toString().c_str());
    lcd.clear();
    lcd.print("WiFi Connected!");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP());
    delay(1500);
  } else {
    Serial.println("\n[WIFI] Warning: Connection timeout. System will operate with offline checks.");
    lcd.clear();
    lcd.print("WiFi Timeout");
    lcd.setCursor(0, 1);
    lcd.print("Offline Mode");
    delay(1500);
  }

  // 4. Initialize HX711 Load Cell Scale
  scale.begin(HX711_DOUT, HX711_SCK);
  scale.set_scale(420.0); // Replace with your calibrated factor
  scale.tare();

  // 5. Initialize R307S Fingerprint Sensor
  fingerSerial.begin(57600, SERIAL_8N1, FINGER_RX, FINGER_TX);
  finger.begin(57600);
  if (finger.verifyPassword()) {
    Serial.println("[SYSTEM] Fingerprint Sensor Connected.");
  } else {
    Serial.println("[WARNING] Fingerprint Sensor Not Detected! Check GPIO 16/17.");
  }

  // 6. Initialize MFRC522 RFID Reader
  pinMode(SS_PIN, OUTPUT);
  digitalWrite(SS_PIN, HIGH);
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, -1);
  SPI.setFrequency(1000000);
  rfid.PCD_Init();
  delay(100);
  rfid.PCD_SetAntennaGain(MFRC522::RxGain_max);

  showIdleScreen();
}

void loop() {
  // Periodic Telemetry Output to Serial Monitor
  if (millis() - lastTelemetryTime >= 500) {
    lastTelemetryTime = millis();
    printContinuousTelemetry();
  }

  // Check Enrollment / Signup Button
  if (digitalRead(BTN_ENROLL) == LOW) {
    delay(200); // Debounce
    runSignupWorkflow();
    showIdleScreen();
  }

  // Main System State Machine
  switch (currentState) {
    case IDLE:
      if (checkRFID()) {
        Serial.println("\n>>> [EVENT] RFID Card Scanned: " + scannedUID);
        lcd.clear();
        lcd.print("Card Scanned!");
        lcd.setCursor(0, 1);
        lcd.print("Checking DB...");

        // Verify with Supabase / Localhost database
        if (WiFi.status() == WL_CONNECTED) {
          bool found = verifyUserWithDatabase(scannedUID);
          if (!found) {
            lcd.clear();
            lcd.print("Card Not Found!");
            lcd.setCursor(0, 1);
            lcd.print("Please Enroll");
            Serial.println("[AUTH] Card not registered in database.");
            delay(2500);
            resetSystem();
            break;
          }

          if (!isUserEligible) {
            lcd.clear();
            lcd.print("Quota Collected!");
            lcd.setCursor(0, 1);
            lcd.print("Access Denied");
            Serial.println("[AUTH] Beneficiary has already collected this month's quota.");
            delay(2500);
            resetSystem();
            break;
          }
        }

        // Card verified and eligible -> Proceed to Biometric Auth
        lcd.clear();
        lcd.print("Card: OK");
        lcd.setCursor(0, 1);
        lcd.print("Place Finger...");
        currentState = AUTHENTICATING;
      }
      break;

    case AUTHENTICATING: {
      int fpResult = checkFingerprint();
      if (fpResult > 0) {
        // If DB supplied expected fingerprint ID, ensure match
        if (expectedFpID > 0 && fpResult != expectedFpID) {
          Serial.printf("\n[SECURITY ALERT] Fingerprint mismatch! Scanned: %d, Expected: %d\n", fpResult, expectedFpID);
          lcd.clear();
          lcd.print("Finger Mismatch!");
          lcd.setCursor(0, 1);
          lcd.print("Access Denied");
          delay(2500);
          resetSystem();
          break;
        }

        authenticatedFpID = fpResult;
        Serial.printf("\n>>> [EVENT] Fingerprint Verified! ID: %d\n", fpResult);
        lcd.clear();
        lcd.print("Auth Success!");
        if (beneficiaryName != "") {
          lcd.setCursor(0, 1);
          lcd.print(beneficiaryName.substring(0, 16));
        }
        delay(1200);
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
        if (digitalRead(IR_STOCK) == HIGH) { // HIGH = Sensor unobstructed (Empty)
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
        if (digitalRead(IR_CONTAINER) == HIGH) { // HIGH = No Container detected
          Serial.println("[SAFETY INTERLOCK] Container Missing!");
          lcd.clear();
          lcd.print("Place Container");
          lcd.setCursor(0, 1);
          lcd.print("Under Spout!");
          delay(2000);
          updateItemDisplay();
          break;
        }

        currentState = DISPENSING;
      }
      break;

    case DISPENSING:
      float targetKg = (selectedItem == 1) ? 0.25 : 0.5; // 500g or 250g batch
      dispenseItem(selectedItem, targetKg);
      
      // Log transaction to Supabase / Localhost
      logTransactionToDatabase(scannedUID, items[selectedItem], targetKg);

      Serial.printf(">>> [SYSTEM] Dispense Finished for %s.\n", items[selectedItem]);
      resetSystem();
      break;
  }
}

// =========================================================
// Supabase / Localhost REST API Client
// =========================================================

bool verifyUserWithDatabase(String uid) {
  if (WiFi.status() != WL_CONNECTED) return true; // Fallback if offline

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/users?card_uid=eq." + uid + "&select=*";
  Serial.printf("[HTTP GET] %s\n", url.c_str());

  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));

  int httpCode = http.GET();
  bool userFound = false;

  if (httpCode == 200) {
    String payload = http.getString();
    Serial.printf("[HTTP RES] %s\n", payload.c_str());

    DynamicJsonDocument doc(2048);
    DeserializationError error = deserializeJson(doc, payload);

    if (!error && doc.size() > 0) {
      userFound = true;
      beneficiaryName = doc[0]["name"].as<String>();
      expectedFpID = doc[0]["fingerprint_id"].as<int>();
      isUserEligible = doc[0]["eligible"].as<bool>();
      Serial.printf("[DB USER] Name: %s | FpID: %d | Eligible: %s\n",
                    beneficiaryName.c_str(), expectedFpID, isUserEligible ? "YES" : "NO");
    }
  } else {
    Serial.printf("[HTTP ERROR] GET failed, code: %d\n", httpCode);
  }

  http.end();
  return userFound;
}

bool logTransactionToDatabase(String uid, const char* item, float weightDispensed) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/transactions";
  Serial.printf("[HTTP POST] Logging transaction to %s\n", url.c_str());

  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument doc(256);
  doc["user_id"] = uid;
  doc["item_dispensed"] = item;
  doc["dispensed_weight_g"] = (int)(weightDispensed * 1000.0);
  doc["status"] = "SUCCESS";

  String body;
  serializeJson(doc, body);
  int httpCode = http.POST(body);
  Serial.printf("[HTTP RES] Transaction logged! HTTP Code: %d\n", httpCode);

  http.end();
  return (httpCode == 200 || httpCode == 201);
}

bool registerUserToDatabase(String uid, int fpId, String name) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/users";
  Serial.printf("[HTTP POST] Enrolling user to %s\n", url.c_str());

  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument doc(256);
  doc["card_uid"] = uid;
  doc["fingerprint_id"] = fpId;
  doc["name"] = name;
  doc["eligible"] = true;

  String body;
  serializeJson(doc, body);
  int httpCode = http.POST(body);
  Serial.printf("[HTTP RES] Enrollment synced to DB! HTTP Code: %d\n", httpCode);

  http.end();
  return (httpCode == 200 || httpCode == 201);
}

// =========================================================
// Serial Telemetry & Display Functions
// =========================================================

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
  lcd.print("Smart Ration");
  lcd.setCursor(0, 1);
  lcd.print("Scan RFID Card");
}

void updateItemDisplay() {
  lcd.clear();
  lcd.print("Item: ");
  lcd.print(items[selectedItem]);
  lcd.setCursor(0, 1);
  lcd.print("Press [SEL] ->");
}

void resetSystem() {
  scannedUID = "";
  authenticatedFpID = -1;
  expectedFpID = -1;
  beneficiaryName = "";
  isUserEligible = false;
  currentState = IDLE;
  showIdleScreen();
}

// =========================================================
// PCA9685 Servo Motor Operations
// =========================================================

void setServoAngle(uint8_t channel, uint8_t angle) {
  uint16_t pulse = map(angle, 0, 180, SERVOMIN, SERVOMAX);
  pwm.setPWM(channel, 0, pulse);
}

void closeAllGates() {
  setServoAngle(0, 0); // Channel 0: Rice Gate
  setServoAngle(1, 0); // Channel 1: Wheat Gate
  setServoAngle(2, 0); // Channel 2: Sugar/Dal Gate
}

// =========================================================
// Peripheral Sensor Drivers
// =========================================================

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

// =========================================================
// Dispensing Logic with Real-Time Weight & IR Interlock
// =========================================================

void dispenseItem(uint8_t channel, float targetWeightKg) {
  lcd.clear();
  lcd.print("Dispensing ");
  lcd.print(items[channel]);
  
  scale.tare();
  delay(200);

  setServoAngle(channel, 90); // Open Servo Gate
  Serial.printf(">>> [SERVO] Opening Gate on PCA9685 Channel %d\n", channel);

  float currentWeight = 0.0;
  bool aborted = false;

  while (currentWeight < targetWeightKg) {
    // Continuous Safety Interlock: Stop dispensing if container is moved away
    if (digitalRead(IR_CONTAINER) == HIGH) {
      setServoAngle(channel, 0); // Emergency gate close
      Serial.println("\n[EMERGENCY ABORT] Container removed mid-dispense!");
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

  setServoAngle(channel, 0); // Close Servo Gate
  Serial.printf(">>> [SERVO] Closed Gate on PCA9685 Channel %d\n", channel);

  if (!aborted) {
    lcd.clear();
    lcd.print("Dispense Done!");
    lcd.setCursor(0, 1);
    lcd.print("Take Container");
    delay(2000);
  }
}

// =========================================================
// Enrollment / Signup Workflow (With Cloud Sync)
// =========================================================

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
    if (digitalRead(BTN_NAV) == LOW) {
      Serial.println(">>> [MODE] Signup Aborted.");
      return; 
    }
    delay(100);
  }

  Serial.println(">>> [SIGNUP] RFID Card Tag Captured: " + newUID);
  lcd.clear();
  lcd.print("UID: " + newUID.substring(0, 10));
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

  Serial.printf(">>> [SIGNUP] SUCCESS! Finger ID #%d linked to RFID: %s\n", newFpID, newUID.c_str());
  
  // Sync new user record to Supabase / Localhost database
  lcd.clear();
  lcd.print("Syncing Cloud...");
  bool synced = registerUserToDatabase(newUID, newFpID, "Beneficiary " + String(newFpID));

  lcd.clear();
  lcd.print("User Enrolled!");
  lcd.setCursor(0, 1);
  lcd.print("ID: #" + String(newFpID) + (synced ? " [DB OK]" : " [OFF]"));
  
  nextEnrollID++;
  delay(2500);
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
