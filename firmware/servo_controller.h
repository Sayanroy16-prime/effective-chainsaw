#ifndef SERVO_CONTROLLER_H
#define SERVO_CONTROLLER_H

#include <Arduino.h>
#include <ESP32Servo.h>
#include "config.h"

class ServoController {
private:
  Servo servoRice;
  Servo servoWheat;
  Servo servoDal;
  Servo servoSugar;

public:
  ServoController() {}

  void begin() {
    // Allocate ESP32 hardware PWM timers
    ESP32PWM::allocateTimer(0);
    ESP32PWM::allocateTimer(1);
    ESP32PWM::allocateTimer(2);
    ESP32PWM::allocateTimer(3);

    // Standard 50Hz servo period
    servoRice.setPeriodHertz(50);
    servoWheat.setPeriodHertz(50);
    servoDal.setPeriodHertz(50);
    servoSugar.setPeriodHertz(50);

    // Standard MG995 pulse widths: 500us to 2400us
    servoRice.attach(SERVO_RICE_PIN, 500, 2400);
    servoWheat.attach(SERVO_WHEAT_PIN, 500, 2400);
    servoDal.attach(SERVO_DAL_PIN, 500, 2400);
    servoSugar.attach(SERVO_SUGAR_PIN, 500, 2400);

    // Ensure all gates start firmly closed
    closeAllGates();
    Serial.println(F("[SERVOS] 4x MG995 gates attached and locked at 0 degrees."));
  }

  void openGate(int servoId) {
    closeAllGates(); // Safety: only open one flap at a time
    delay(50);

    switch (servoId) {
      case 1:
        servoRice.write(SERVO_ANGLE_OPEN);
        Serial.println(F("[SERVO] Gate 1 (Rice) OPEN."));
        break;
      case 2:
        servoWheat.write(SERVO_ANGLE_OPEN);
        Serial.println(F("[SERVO] Gate 2 (Wheat) OPEN."));
        break;
      case 3:
        servoDal.write(SERVO_ANGLE_OPEN);
        Serial.println(F("[SERVO] Gate 3 (Dal) OPEN."));
        break;
      case 4:
        servoSugar.write(SERVO_ANGLE_OPEN);
        Serial.println(F("[SERVO] Gate 4 (Sugar) OPEN."));
        break;
      default:
        Serial.printf("[SERVO ERROR] Invalid gate ID %d\n", servoId);
        break;
    }
  }

  void closeGate(int servoId) {
    switch (servoId) {
      case 1:
        servoRice.write(SERVO_ANGLE_CLOSED);
        break;
      case 2:
        servoWheat.write(SERVO_ANGLE_CLOSED);
        break;
      case 3:
        servoDal.write(SERVO_ANGLE_CLOSED);
        break;
      case 4:
        servoSugar.write(SERVO_ANGLE_CLOSED);
        break;
    }
    Serial.printf("[SERVO] Gate %d CLOSED.\n", servoId);
  }

  void closeAllGates() {
    servoRice.write(SERVO_ANGLE_CLOSED);
    servoWheat.write(SERVO_ANGLE_CLOSED);
    servoDal.write(SERVO_ANGLE_CLOSED);
    servoSugar.write(SERVO_ANGLE_CLOSED);
  }
};

#endif // SERVO_CONTROLLER_H
