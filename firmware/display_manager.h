#ifndef DISPLAY_MANAGER_H
#define DISPLAY_MANAGER_H

#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "config.h"

class DisplayManager {
private:
  LiquidCrystal_I2C lcd;
  bool isInitialized;

public:
  DisplayManager() : lcd(LCD_I2C_ADDR, 20, 4), isInitialized(false) {}

  void begin() {
    Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
    lcd.init();
    lcd.backlight();
    lcd.clear();
    isInitialized = true;
    showWelcomeScreen();
  }

  void showWelcomeScreen() {
    if (!isInitialized) return;
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("SMART RATION PDS");
    lcd.setCursor(0, 1);
    lcd.print("TAMIL NADU MODEL");
    lcd.setCursor(0, 2);
    lcd.print("PLEASE SCAN CARD");
    lcd.setCursor(0, 3);
    lcd.print("அட்டையை காட்டவும்");
  }

  void showCardVerified(const char* name, const char* rationNo) {
    if (!isInitialized) return;
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("CARD AUTHENTICATED");
    lcd.setCursor(0, 1);
    char buf[21];
    snprintf(buf, sizeof(buf), "%.20s", name);
    lcd.print(buf);
    lcd.setCursor(0, 2);
    snprintf(buf, sizeof(buf), "No: %.16s", rationNo);
    lcd.print(buf);
    lcd.setCursor(0, 3);
    lcd.print("PLACE FINGERPRINT");
  }

  void showAlreadyCollected() {
    if (!isInitialized) return;
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("ALREADY COLLECTED!");
    lcd.setCursor(0, 1);
    lcd.print("ரேஷன் பெறப்பட்டது");
    lcd.setCursor(0, 2);
    lcd.print("QUOTA EXHAUSTED FOR");
    lcd.setCursor(0, 3);
    lcd.print("THIS CALENDAR MONTH");
  }

  void showCommodityMenu() {
    if (!isInitialized) return;
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("1: Rice(500g) Arisi");
    lcd.setCursor(0, 1);
    lcd.print("2: Wheat(500g) Godhu");
    lcd.setCursor(0, 2);
    lcd.print("3: Dal(250g) Paruppu");
    lcd.setCursor(0, 3);
    lcd.print("4: Sugar(250g) Sarka");
  }

  void showWaitingContainer() {
    if (!isInitialized) return;
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("PLACE CONTAINER!");
    lcd.setCursor(0, 1);
    lcd.print("பாத்திரம் வைக்கவும்");
    lcd.setCursor(0, 2);
    lcd.print("UNDER COMMON FUNNEL");
    lcd.setCursor(0, 3);
    lcd.print("IR-1 SENSING...");
  }

  void showDispensing(const char* grain, float currentWeight, float targetWeight) {
    if (!isInitialized) return;
    lcd.setCursor(0, 0);
    char buf[21];
    snprintf(buf, sizeof(buf), "DISPENSING: %-8s", grain);
    lcd.print(buf);

    lcd.setCursor(0, 1);
    snprintf(buf, sizeof(buf), "WEIGHT: %5.1fg    ", currentWeight);
    lcd.print(buf);

    lcd.setCursor(0, 2);
    snprintf(buf, sizeof(buf), "TARGET: %5.1fg    ", targetWeight);
    lcd.print(buf);

    lcd.setCursor(0, 3);
    lcd.print("PLEASE WAIT...      ");
  }

  void showComplete(float finalWeight) {
    if (!isInitialized) return;
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("DISPENSE COMPLETE!");
    lcd.setCursor(0, 1);
    char buf[21];
    snprintf(buf, sizeof(buf), "DISPENSED: %.1fg", finalWeight);
    lcd.print(buf);
    lcd.setCursor(0, 2);
    lcd.print("TAKE YOUR CONTAINER");
    lcd.setCursor(0, 3);
    lcd.print("THANK YOU / நன்றி");
  }

  void showError(const char* line1, const char* line2) {
    if (!isInitialized) return;
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("ERROR / எச்சரிக்கை");
    lcd.setCursor(0, 1);
    lcd.print(line1);
    lcd.setCursor(0, 2);
    lcd.print(line2);
  }
};

#endif // DISPLAY_MANAGER_H
