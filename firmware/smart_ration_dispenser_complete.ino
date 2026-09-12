/**
 * =========================================================================
 * Smart Ration Dispenser - Complete Unified Arduino Firmware
 * =========================================================================
 * Hardware Peripherals:
 *   - ESP32-WROOM-32 Main Controller
 *   - RFID MFRC522 (SDA/SS: 5, RST: 4)
 *   - Optical Fingerprint R307S (RX: 16, TX: 17)
 *   - 3x MG995 Servos (Rice: 13, Dal: 12, Wheat: 14)
 *   - 2x IR Sensors (Container: 25, Hopper Stock: 26)
 *   - 2x Pushbuttons (Select: 32, Confirm: 33)
 *   - 16x2 I2C LCD Display (0x27)
 * 
 * Optional Enhancements (Enable when wiring HX711 & DFPlayer):
 *   - Load Cell HX711 (DOUT: 32, SCK: 33) - Active when USE_LOAD_CELL_WEIGHING is true
 *   - DFPlayer Mini Audio (RX1: 26, TX1: 27) - Active when USE_DFPLAYER_AUDIO is true
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_Fingerprint.h>
#include <ESP32Servo.h>

// =========================================================
// Configuration & Feature Toggles
// =========================================================
#define USE_LOAD_CELL_WEIGHING  false  // Set to true to cutoff by exact grams instead of 3s timer
#define USE_DFPLAYER_AUDIO      false  // Set to true to enable DFPlayer Mini voice prompts

// --- Network & Supabase Credentials ---
// To use with the included local Node.js backend:
//   const char* SUPABASE_URL = "http://YOUR_COMPUTER_IP:3001/rest/v1";
// To use with cloud Supabase:
//   const char* SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co/rest/v1";
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* SUPABASE_URL  = "http://192.168.1.100:3001/rest/v1";
const char* SUPABASE_KEY   = "YOUR_SUPABASE_ANON_KEY";

// --- Pin Assignments ---
#define SS_PIN          5
#define RST_PIN         4
#define FINGER_RX       16
#define FINGER_TX       17
#define IR_CONTAINER    25
#define IR_STOCK        26
#define BTN_SELECT      32
#define BTN_CONFIRM     33

const int SERVO_PINS[3] = {13, 12, 14};
const char* commodities[3] = {"Rice", "Dal", "Wheat"};
const int targetQuotasGrams[3] = {500, 250, 500};

// --- Instances ---
LiquidCrystal_I2C lcd(0x27, 16, 2);
MFRC522 rfid(SS_PIN, RST_PIN);
HardwareSerial fingerSerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fingerSerial);
Servo servos[3];

int selectedCommodity = 0;

// Function Prototypes
void resetDisplay();
int getFingerprintID();
bool verifyUserInSupabase(String id, bool isFingerprint);
void selectAndDispenseCommodity(String userID);
void logTransaction(String userID, const char* item);

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println(F("\n======================================================="));
  Serial.println(F("     SMART RATION DISPENSER (ARDUINO IDE FIRMWARE)    "));
  Serial.println(F("======================================================="));

  // 1. Pin Modes
  pinMode(BTN_SELECT, INPUT_PULLUP);
  pinMode(BTN_CONFIRM, INPUT_PULLUP);
  pinMode(IR_CONTAINER, INPUT);
  pinMode(IR_STOCK, INPUT);

  // 2. Initialize Servos
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);

  for (int i = 0; i < 3; i++) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i], 500, 2400);
    servos[i].write(0); // Ensure closed state (0 degrees)
  }

  // 3. Initialize LCD
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.print("System Booting..");

  // 4. Wi-Fi Connection
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lcd.setCursor(0, 1);
  Serial.print(F("[WIFI] Connecting"));
  
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 12000) {
    delay(400);
    lcd.print(".");
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("\n[WIFI] Running in offline/disconnected mode."));
  }

  // 5. Peripherals Initialization
  SPI.begin();
  rfid.PCD_Init();
  Serial.println(F("[RFID] MFRC522 Ready."));

  fingerSerial.begin(57600, SERIAL_8N1, FINGER_RX, FINGER_TX);
  finger.begin(57600);
  if (finger.verifyPassword()) {
    Serial.println(F("[R307S] Fingerprint sensor detected!"));
  } else {
    Serial.println(F("[R307S] Warning: Fingerprint sensor not detected on GPIO 16/17."));
  }

  resetDisplay();
  Serial.println(F("[READY] Machine idle. Waiting for RFID card or Fingerprint..."));
}

void loop() {
  String authID = "";
  bool isFingerprint = false;

  // 1. Scan RFID
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    for (byte i = 0; i < rfid.uid.size; i++) {
      authID += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
      authID += String(rfid.uid.uidByte[i], HEX);
    }
    authID.toUpperCase();
    Serial.printf("[RFID] Scanned UID: %s\n", authID.c_str());
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }

  // 2. Scan Fingerprint if no RFID
  if (authID == "") {
    int fingerID = getFingerprintID();
    if (fingerID > 0) {
      authID = String(fingerID);
      isFingerprint = true;
      Serial.printf("[R307S] Fingerprint matched: ID #%d\n", fingerID);
    }
  }

  // 3. User Authentication & Selection Process
  if (authID != "") {
    lcd.clear();
    lcd.print("Verifying...");
    Serial.println(F("[AUTH] Verifying eligibility in Supabase database..."));

    if (verifyUserInSupabase(authID, isFingerprint)) {
      lcd.clear();
      lcd.print("Auth Success!");
      Serial.println(F("[AUTH] Eligible! Opening grain selection menu."));
      delay(1000);

      selectAndDispenseCommodity(authID);
    } else {
      lcd.clear();
      lcd.print("Access Denied!");
      lcd.setCursor(0, 1);
      lcd.print("Already Taken");
      Serial.println(F("[AUTH] Access Denied: Beneficiary already collected monthly quota."));
      delay(2500);
    }
    resetDisplay();
  }

  delay(150);
}

void selectAndDispenseCommodity(String userID) {
  selectedCommodity = 0;
  bool selectionActive = true;

  while (selectionActive) {
    lcd.clear();
    lcd.print("Select Item:");
    lcd.setCursor(0, 1);
    lcd.print("> " + String(commodities[selectedCommodity]));

    // Wait for button actions
    unsigned long startTime = millis();
    while (digitalRead(BTN_SELECT) == HIGH && digitalRead(BTN_CONFIRM) == HIGH) {
      // 15 second timeout guard
      if (millis() - startTime > 15000) {
        Serial.println(F("[TIMEOUT] User inactive. Resetting session."));
        return;
      }
      delay(50);
    }

    if (digitalRead(BTN_SELECT) == LOW) {
      selectedCommodity = (selectedCommodity + 1) % 3;
      Serial.printf("[BTN] Cycled item: %s\n", commodities[selectedCommodity]);
      delay(300); // Debounce
    } 
    else if (digitalRead(BTN_CONFIRM) == LOW) {
      selectionActive = false;
      Serial.printf("[BTN] Confirmed item: %s\n", commodities[selectedCommodity]);
      delay(300); // Debounce
    }
  }

  // Check Container IR Sensor (LOW indicates object detected)
  if (digitalRead(IR_CONTAINER) == HIGH) {
    lcd.clear();
    lcd.print("Place Container!");
    lcd.setCursor(0, 1);
    lcd.print("Waiting IR...");
    Serial.println(F("[IR] Waiting for container to be placed beneath funnel..."));

    unsigned long waitContainer = millis();
    while (digitalRead(IR_CONTAINER) == HIGH) {
      if (millis() - waitContainer > 30000) {
        Serial.println(F("[IR TIMEOUT] Container not placed. Aborting."));
        lcd.clear();
        lcd.print("Timeout Aborted");
        delay(2000);
        return;
      }
      delay(100);
    }
  }

  // Check Hopper Stock IR Sensor
  if (digitalRead(IR_STOCK) == HIGH) {
    Serial.println(F("[ALERT] Hopper stock level is low!"));
  }

  // Execute Dispensing
  lcd.clear();
  lcd.print("Dispensing:");
  lcd.setCursor(0, 1);
  lcd.print(commodities[selectedCommodity]);
  Serial.printf("[DISPENSE] Opening Servo #%d (%s) gate...\n", selectedCommodity + 1, commodities[selectedCommodity]);

  servos[selectedCommodity].write(90); // Open flap
  delay(3000);                         // Dispense window
  servos[selectedCommodity].write(0);  // Close flap
  Serial.println(F("[DISPENSE] Gate closed."));

  lcd.clear();
  lcd.print("Dispense Done!");
  lcd.setCursor(0, 1);
  lcd.print("Take Container");
  
  logTransaction(userID, commodities[selectedCommodity]);
  delay(2500);
}

int getFingerprintID() {
  if (finger.getImage() != FINGERPRINT_OK) return -1;
  if (finger.image2Tz() != FINGERPRINT_OK) return -1;
  if (finger.fingerFastSearch() != FINGERPRINT_OK) return -1;
  return finger.fingerID;
}

bool verifyUserInSupabase(String id, bool isFingerprint) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[HTTP] Wi-Fi offline. Cannot query Supabase."));
    return false;
  }

  HTTPClient http;
  String queryParam = isFingerprint ? "fingerprint_id=eq." + id : "card_uid=eq." + id;
  String url = String(SUPABASE_URL) + "/users?" + queryParam + "&select=*";

  Serial.printf("[HTTP GET] %s\n", url.c_str());
  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));

  int httpCode = http.GET();
  bool eligible = false;

  Serial.printf("[HTTP CODE] %d\n", httpCode);
  if (httpCode == 200) {
    String payload = http.getString();
    Serial.printf("[HTTP DATA] %s\n", payload.c_str());
    DynamicJsonDocument doc(1024);
    deserializeJson(doc, payload);
    if (doc.size() > 0 && doc[0]["eligible"].as<bool>() == true) {
      eligible = true;
    }
  }
  http.end();
  return eligible;
}

void logTransaction(String userID, const char* item) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/transactions";

  Serial.printf("[HTTP POST] %s\n", url.c_str());
  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument doc(200);
  doc["user_id"] = userID;
  doc["item_dispensed"] = item;
  doc["status"] = "SUCCESS";

  String body;
  serializeJson(doc, body);
  int httpCode = http.POST(body);
  Serial.printf("[HTTP POST RESULT] %d\n", httpCode);
  http.end();
}

void resetDisplay() {
  lcd.clear();
  lcd.print("Ready to Scan");
  lcd.setCursor(0, 1);
  lcd.print("RFID / Finger");
}
