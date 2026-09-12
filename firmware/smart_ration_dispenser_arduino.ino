#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_Fingerprint.h>
#include <ESP32Servo.h>

// --- Configuration ---
// Point to your local backend (e.g. http://192.168.1.XXX:3001) or Cloud Supabase
const char* WIFI_SSID   = "YOUR_WIFI_SSID";
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";
const char* SUPABASE_URL= "http://192.168.1.100:3001"; // Or "https://YOUR_PROJECT_ID.supabase.co/rest/v1"
const char* SUPABASE_KEY= "YOUR_SUPABASE_ANON_KEY";

// --- Pin Definitions ---
#define SS_PIN          5
#define RST_PIN         4
#define FINGER_RX       16
#define FINGER_TX       17
#define IR_CONTAINER    25
#define IR_STOCK        26
#define BTN_ENROLL      27  // External Signup Pushbutton
#define BTN_SELECT      32  // Commodity Cycle Button
#define BTN_CONFIRM     33  // Dispense Trigger Button

const int SERVO_PINS[3] = {13, 12, 14};
const char* commodities[3] = {"Rice", "Dal", "Wheat"};

// --- Peripheral Instances ---
LiquidCrystal_I2C lcd(0x27, 16, 2);
MFRC522 rfid(SS_PIN, RST_PIN);
HardwareSerial fingerSerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fingerSerial);
Servo servos[3];

int selectedCommodity = 0;

void setup() {
  Serial.begin(115200);

  // Configure external pushbuttons with internal pullups
  pinMode(BTN_ENROLL, INPUT_PULLUP);
  pinMode(BTN_SELECT, INPUT_PULLUP);
  pinMode(BTN_CONFIRM, INPUT_PULLUP);
  pinMode(IR_CONTAINER, INPUT);
  pinMode(IR_STOCK, INPUT);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);

  for (int i = 0; i < 3; i++) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i], 500, 2400);
    servos[i].write(0); // Initial closed flap position
  }

  lcd.init();
  lcd.backlight();
  lcd.print("System Starting");

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lcd.setCursor(0, 1);
  unsigned long startWifi = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startWifi < 12000) {
    delay(500);
    lcd.print(".");
  }

  SPI.begin();
  rfid.PCD_Init();
  fingerSerial.begin(57600, SERIAL_8N1, FINGER_RX, FINGER_TX);
  finger.begin(57600);

  resetDisplay();
}

void loop() {
  // 1. Check if External Signup Pushbutton is Pressed
  if (digitalRead(BTN_ENROLL) == LOW) {
    delay(50); // Debounce
    if (digitalRead(BTN_ENROLL) == LOW) {
      runEnrollmentMode();
      resetDisplay();
      return;
    }
  }

  // 2. Normal Mode: Authentication
  String authID = "";
  bool isFingerprint = false;

  // Scan RFID
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    for (byte i = 0; i < rfid.uid.size; i++) {
      authID += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
      authID += String(rfid.uid.uidByte[i], HEX);
    }
    authID.toUpperCase();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }

  // Scan Fingerprint
  if (authID == "") {
    int fingerID = getFingerprintID();
    if (fingerID > 0) {
      authID = String(fingerID);
      isFingerprint = true;
    }
  }

  // Handle Authenticated User
  if (authID != "") {
    lcd.clear();
    lcd.print("Verifying...");

    if (verifyUserInSupabase(authID, isFingerprint)) {
      lcd.clear();
      lcd.print("Auth Success!");
      delay(1000);
      selectAndDispenseCommodity(authID);
    } else {
      lcd.clear();
      lcd.print("Access Denied!");
      delay(2000);
    }
    resetDisplay();
  }

  delay(100);
}

// --- Registration Routine ---
void runEnrollmentMode() {
  lcd.clear();
  lcd.print("SIGN UP MODE");
  lcd.setCursor(0, 1);
  lcd.print("Scan RFID Card");

  String cardUID = "";

  // Step 1: Scan RFID
  while (cardUID == "") {
    // Allow canceling back to normal loop
    if (digitalRead(BTN_CONFIRM) == LOW) return;

    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      for (byte i = 0; i < rfid.uid.size; i++) {
        cardUID += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
        cardUID += String(rfid.uid.uidByte[i], HEX);
      }
      cardUID.toUpperCase();
      rfid.PICC_HaltA();
      rfid.PCD_StopCrypto1();
    }
    delay(100);
  }

  lcd.clear();
  lcd.print("RFID Recorded");
  delay(1000);

  // Step 2: Get Free Fingerprint Slot & Store Template
  int nextID = getNextFreeFingerprintID();
  if (nextID == -1 || !captureFingerprint(nextID)) {
    lcd.clear();
    lcd.print("Enroll Failed!");
    delay(2000);
    return;
  }

  // Step 3: Push payload directly to Supabase users table
  lcd.clear();
  lcd.print("Syncing Supabase");
  if (registerUserToSupabase(cardUID, nextID)) {
    lcd.clear();
    lcd.print("Sign Up Complete!");
    lcd.setCursor(0, 1);
    lcd.print("ID: " + String(nextID));
  } else {
    lcd.clear();
    lcd.print("DB Sync Error!");
  }
  delay(2500);
}

int getNextFreeFingerprintID() {
  for (int id = 1; id < 128; id++) {
    if (finger.loadModel(id) != FINGERPRINT_OK) return id;
  }
  return -1;
}

bool captureFingerprint(int id) {
  int p = -1;
  lcd.clear();
  lcd.print("Place Finger");
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) delay(100);
  }
  if (finger.image2Tz(1) != FINGERPRINT_OK) return false;

  lcd.clear();
  lcd.print("Remove Finger");
  delay(1500);
  while (finger.getImage() != FINGERPRINT_NOFINGER);

  lcd.clear();
  lcd.print("Place Same Finger");
  p = -1;
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) delay(100);
  }
  if (finger.image2Tz(2) != FINGERPRINT_OK) return false;

  if (finger.createModel() != FINGERPRINT_OK) return false;
  return (finger.storeModel(id) == FINGERPRINT_OK);
}

bool registerUserToSupabase(String cardUID, int fingerprintID) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/users";

  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument doc(256);
  doc["card_uid"] = cardUID;
  doc["fingerprint_id"] = fingerprintID;
  doc["name"] = "Registered Beneficiary";
  doc["eligible"] = true;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  http.end();
  return (code == 201 || code == 200);
}

void selectAndDispenseCommodity(String userID) {
  selectedCommodity = 0;
  bool active = true;

  while (active) {
    lcd.clear();
    lcd.print("Select Item:");
    lcd.setCursor(0, 1);
    lcd.print("> " + String(commodities[selectedCommodity]));

    while (digitalRead(BTN_SELECT) == HIGH && digitalRead(BTN_CONFIRM) == HIGH) {
      delay(50);
    }

    if (digitalRead(BTN_SELECT) == LOW) {
      selectedCommodity = (selectedCommodity + 1) % 3;
      delay(300);
    } else if (digitalRead(BTN_CONFIRM) == LOW) {
      active = false;
      delay(300);
    }
  }

  // IR Container check
  if (digitalRead(IR_CONTAINER) == HIGH) {
    lcd.clear();
    lcd.print("Place Container!");
    while (digitalRead(IR_CONTAINER) == HIGH) delay(100);
  }

  // Dispense
  lcd.clear();
  lcd.print("Dispensing...");
  servos[selectedCommodity].write(90);
  delay(3000);
  servos[selectedCommodity].write(0);

  logTransaction(userID, commodities[selectedCommodity]);
}

int getFingerprintID() {
  if (finger.getImage() != FINGERPRINT_OK) return -1;
  if (finger.image2Tz() != FINGERPRINT_OK) return -1;
  if (finger.fingerFastSearch() != FINGERPRINT_OK) return -1;
  return finger.fingerID;
}

bool verifyUserInSupabase(String id, bool isFingerprint) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String query = isFingerprint ? "fingerprint_id=eq." + id : "card_uid=eq." + id;
  String url = String(SUPABASE_URL) + "/users?" + query + "&select=*";

  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));

  int code = http.GET();
  bool eligible = false;

  if (code == 200) {
    DynamicJsonDocument doc(1024);
    deserializeJson(doc, http.getString());
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
  http.begin(String(SUPABASE_URL) + "/transactions");
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
  http.end();
}

void resetDisplay() {
  lcd.clear();
  lcd.print("Scan RFID / Finger");
  lcd.setCursor(0, 1);
  lcd.print("Press Signup Btn");
}
