#include <Servo.h>

// Car Velox / CyberKnights toll gate controller
// Wiring: IR sensor 1 -> D2, IR sensor 2 -> D3, servo signal -> D9.
// IR sensors are assumed active-LOW. Servo power should use a suitable
// external 5V supply with GND connected to Arduino GND.

#define SENSOR_1 2
#define SENSOR_2 3
#define SERVO_PIN 9

#define GATE_CLOSED 0
#define GATE_OPEN 90
#define DEBOUNCE_MS 50
#define TIMEOUT_MS 10000UL

Servo gateServo;

bool gateIsOpen = false;
bool transactionActive = false;
bool exitSensorSeen = false;
bool remoteOpen = false;
uint8_t exitSensor = SENSOR_2;
unsigned long transactionStarted = 0;

struct SensorState {
  uint8_t pin;
  bool rawState;
  bool stableState;
  unsigned long changedAt;
};

SensorState sensor1 = { SENSOR_1, HIGH, HIGH, 0 };
SensorState sensor2 = { SENSOR_2, HIGH, HIGH, 0 };

void setGate(bool openGate) {
  if (gateIsOpen == openGate) return;
  gateIsOpen = openGate;
  gateServo.write(openGate ? GATE_OPEN : GATE_CLOSED);
  Serial.println(openGate ? "GATE:OPEN" : "GATE:CLOSED");
}

bool updateSensor(SensorState &sensor) {
  bool reading = digitalRead(sensor.pin);
  if (reading != sensor.rawState) {
    sensor.rawState = reading;
    sensor.changedAt = millis();
  }
  if (reading != sensor.stableState &&
      millis() - sensor.changedAt >= DEBOUNCE_MS) {
    sensor.stableState = reading;
    return true;
  }
  return false;
}

void handleCommand(String command) {
  command.trim();
  command.toUpperCase();

  if (command == "OPEN") {
    remoteOpen = true;
    transactionActive = false;
    exitSensorSeen = false;
    transactionStarted = millis();
    setGate(true);
    Serial.println("ACK:OPEN");
  } else if (command == "CLOSE") {
    remoteOpen = false;
    transactionActive = false;
    exitSensorSeen = false;
    setGate(false);
    Serial.println("ACK:CLOSE");
  } else if (command.length() > 0) {
    Serial.print("ERROR:UNKNOWN_COMMAND:");
    Serial.println(command);
  }
}

void readSerialCommands() {
  static String command = "";
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (command.length()) handleCommand(command);
      command = "";
    } else if (command.length() < 24) {
      command += c;
    } else {
      command = "";
    }
  }
}

void beginAutomaticPass(uint8_t entryPin) {
  if (transactionActive || remoteOpen) return;
  transactionActive = true;
  exitSensorSeen = false;
  exitSensor = (entryPin == SENSOR_1) ? SENSOR_2 : SENSOR_1;
  transactionStarted = millis();
  setGate(true);
  Serial.print("SENSOR:");
  Serial.println(entryPin == SENSOR_1 ? "1_ENTRY" : "2_ENTRY");
}

void setup() {
  Serial.begin(9600); // Must match the website's Web Serial baud rate.
  pinMode(SENSOR_1, INPUT_PULLUP);
  pinMode(SENSOR_2, INPUT_PULLUP);

  sensor1.rawState = sensor1.stableState = digitalRead(SENSOR_1);
  sensor2.rawState = sensor2.stableState = digitalRead(SENSOR_2);
  sensor1.changedAt = sensor2.changedAt = millis();

  gateServo.attach(SERVO_PIN);
  gateServo.write(GATE_CLOSED);
  gateIsOpen = false;
  Serial.println("TOLL_GATE_READY");
  Serial.println("GATE:CLOSED");
}

void loop() {
  readSerialCommands();

  bool sensor1Changed = updateSensor(sensor1);
  bool sensor2Changed = updateSensor(sensor2);

  // A new car at either entrance opens the gate and selects the opposite
  // sensor as the exit detector.
  if (!transactionActive && !remoteOpen) {
    if (sensor1Changed && sensor1.stableState == LOW) {
      beginAutomaticPass(SENSOR_1);
    } else if (sensor2Changed && sensor2.stableState == LOW) {
      beginAutomaticPass(SENSOR_2);
    }
  }

  if (transactionActive) {
    SensorState &exitState = (exitSensor == SENSOR_1) ? sensor1 : sensor2;

    if (exitState.stableState == LOW) exitSensorSeen = true;

    // Close only after the exit sensor has detected the car and then cleared.
    if (exitSensorSeen && exitState.stableState == HIGH) {
      transactionActive = false;
      setGate(false);
      Serial.println("CAR:EXITED");
    }

    if (millis() - transactionStarted >= TIMEOUT_MS) {
      transactionActive = false;
      exitSensorSeen = false;
      setGate(false);
      Serial.println("WARNING:GATE_TIMEOUT_CLOSED");
    }
  }

  // Remote OPEN is also protected by a 10-second timeout.
  if (remoteOpen && millis() - transactionStarted >= TIMEOUT_MS) {
    remoteOpen = false;
    setGate(false);
    Serial.println("WARNING:REMOTE_OPEN_TIMEOUT");
  }
}
