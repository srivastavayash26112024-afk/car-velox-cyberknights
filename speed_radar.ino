/*
  VELOX - Speed Radar
  Arduino Uno + 2.4" TFT (MCUFRIEND_kbv) + 2x IR sensors
  IR A OUT -> D10, IR B OUT -> D11

  Car Velox Web Dashboard:
  - Connect this board using the separate "Connect Speed Radar" button.
  - Serial baud rate: 9600.
  - Telemetry format: speed = 25.5 km/h dir = A>B
*/

#include <Adafruit_GFX.h>
#include <MCUFRIEND_kbv.h>

// ================= SETTINGS =================
const float SENSOR_DISTANCE_CM = 10.0;   // distance between the 2 IR sensors (cm)
const bool  SENSOR_ACTIVE_LOW  = true;   // most IR modules: LOW when object detected
const unsigned long TIMEOUT_MS = 3000;
const unsigned long MIN_GAP_US = 200;
const unsigned long SHOW_MS    = 6000;
// ============================================

#define C_BG      0x0000
#define C_PANEL   0x0841
#define C_CYAN    0x07FF
#define C_MAGENTA 0xF81F
#define C_GREEN   0x07E0
#define C_YELLOW  0xFFE0
#define C_RED     0xF800
#define C_WHITE   0xFFFF
#define C_GREY    0x7BEF
#define C_DARK    0x2104

MCUFRIEND_kbv tft;

#define MASK_A (1 << PB2)   // D10
#define MASK_B (1 << PB3)   // D11

volatile unsigned long tA = 0, tB = 0;
volatile uint8_t lastPinB = 0;
volatile bool trigA = false, trigB = false;

ISR(PCINT0_vect) {
  unsigned long t = micros();
  uint8_t now = PINB;
  uint8_t changed = now ^ lastPinB;
  lastPinB = now;

  if (changed & MASK_A) {
    bool active = SENSOR_ACTIVE_LOW ? !(now & MASK_A) : (now & MASK_A);
    if (active && !trigA) { trigA = true; tA = t; }
  }
  if (changed & MASK_B) {
    bool active = SENSOR_ACTIVE_LOW ? !(now & MASK_B) : (now & MASK_B);
    if (active && !trigB) { trigB = true; tB = t; }
  }
}

float maxKmh = 0;
unsigned long firstSeenMs = 0;
unsigned long resultMs = 0;
bool showingResult = false;

void centerText(const char *s, int cx, int y, uint8_t size, uint16_t col, uint16_t bg) {
  int16_t w = strlen(s) * 6 * size;
  tft.setTextSize(size);
  tft.setTextColor(col, bg);
  tft.setCursor(cx - w / 2, y);
  tft.print(s);
}

uint16_t speedColor(float kmh) {
  if (kmh < 10) return C_GREEN;
  if (kmh < 30) return C_YELLOW;
  return C_RED;
}

void drawStatic() {
  tft.fillScreen(C_BG);

  tft.fillRect(0, 0, 320, 40, C_PANEL);
  tft.setTextSize(3);
  tft.setTextColor(C_CYAN);
  tft.setCursor(12, 9);
  tft.print("VELOX");
  tft.setTextSize(1);
  tft.setTextColor(C_MAGENTA);
  tft.setCursor(200, 10);
  tft.print("SPEED RADAR");
  tft.setTextColor(C_GREY);
  tft.setCursor(200, 24);
  tft.print("2x IR  |  LIVE");
  tft.fillRect(0, 40, 320, 3, C_MAGENTA);
  tft.fillRect(0, 43, 320, 1, C_CYAN);

  tft.fillRoundRect(10, 54, 300, 112, 10, C_PANEL);
  tft.drawRoundRect(10, 54, 300, 112, 10, C_CYAN);
  tft.drawRoundRect(11, 55, 298, 110, 9, C_DARK);

  for (int i = 0; i < 3; i++) {
    int x = 10 + i * 102;
    tft.fillRoundRect(x, 176, 96, 54, 8, C_PANEL);
    tft.drawRoundRect(x, 176, 96, 54, 8, C_MAGENTA);
  }
  centerText("M/S", 58, 182, 1, C_GREY, C_PANEL);
  centerText("DIRECTION", 160, 182, 1, C_GREY, C_PANEL);
  centerText("MAX KM/H", 262, 182, 1, C_GREY, C_PANEL);
}

void drawReady() {
  tft.fillRect(14, 58, 292, 104, C_PANEL);
  centerText("READY", 160, 80, 4, C_CYAN, C_PANEL);
  centerText("waiting for vehicle...", 160, 125, 1, C_GREY, C_PANEL);
  tft.fillRect(14, 194, 88, 30, C_PANEL);
  tft.fillRect(112, 194, 88, 30, C_PANEL);
  centerText("-", 58, 200, 3, C_WHITE, C_PANEL);
  centerText("-", 160, 200, 3, C_WHITE, C_PANEL);
}

void drawWaitingSecond() {
  tft.fillRect(14, 58, 292, 104, C_PANEL);
  centerText("DETECTED", 160, 80, 3, C_YELLOW, C_PANEL);
  centerText("measuring...", 160, 125, 1, C_GREY, C_PANEL);
}

void drawResult(float kmh, float ms, bool aToB) {
  uint16_t col = speedColor(kmh);
  char buf[16];

  tft.fillRect(14, 58, 292, 104, C_PANEL);
  dtostrf(kmh, 0, 1, buf);
  centerText(buf, 160, 72, 6, col, C_PANEL);
  centerText("km/h", 160, 134, 2, C_WHITE, C_PANEL);

  tft.fillRect(14, 194, 88, 30, C_PANEL);
  dtostrf(ms, 0, 2, buf);
  centerText(buf, 58, 198, 2, C_WHITE, C_PANEL);

  tft.fillRect(112, 194, 88, 30, C_PANEL);
  centerText(aToB ? "A > B" : "B > A", 160, 198, 2, C_CYAN, C_PANEL);

  tft.fillRect(214, 194, 88, 30, C_PANEL);
  dtostrf(maxKmh, 0, 1, buf);
  centerText(buf, 262, 198, 2, C_YELLOW, C_PANEL);
}

void drawSplash() {
  tft.fillScreen(C_BG);
  centerText("VELOX", 160, 70, 6, C_CYAN, C_BG);
  centerText("SPEED RADAR", 160, 125, 2, C_MAGENTA, C_BG);
  tft.drawRoundRect(60, 170, 200, 14, 6, C_CYAN);
  for (int i = 0; i < 196; i += 4) {
    tft.fillRoundRect(62, 172, i, 10, 4, C_MAGENTA);
    delay(8);
  }
  delay(300);
}

void resetMeasurement() {
  noInterrupts();
  trigA = false;
  trigB = false;
  tA = 0;
  tB = 0;
  interrupts();
  firstSeenMs = 0;
}

void setup() {
  Serial.begin(9600); // Must match the website's Speed Radar connection.
  pinMode(10, INPUT);
  pinMode(11, INPUT);

  uint16_t id = tft.readID();
  if (id == 0xD3D3 || id == 0x0000 || id == 0xFFFF) id = 0x9341;
  tft.begin(id);
  tft.setRotation(1);   // try 3 if display is upside down

  drawSplash();
  drawStatic();
  drawReady();

  lastPinB = PINB;
  PCICR  |= (1 << PCIE0);
  PCMSK0 |= (1 << PCINT2) | (1 << PCINT3);

  Serial.println("RADAR_READY");
}

void loop() {
  bool a, b;
  unsigned long ta, tb;

  noInterrupts();
  a = trigA;
  b = trigB;
  ta = tA;
  tb = tB;
  interrupts();

  if ((a || b) && firstSeenMs == 0 && !(a && b)) {
    firstSeenMs = millis();
    drawWaitingSecond();
  }

  if (a && b) {
    bool aToB = (ta <= tb);
    unsigned long dt = aToB ? (tb - ta) : (ta - tb);

    if (dt >= MIN_GAP_US) {
      float seconds = dt / 1000000.0;
      float ms  = (SENSOR_DISTANCE_CM / 100.0) / seconds;
      float kmh = ms * 3.6;

      if (kmh > maxKmh) maxKmh = kmh;
      drawResult(kmh, ms, aToB);

      // Send one complete telemetry line to the Car Velox dashboard.
      Serial.print("speed = ");
      Serial.print(kmh, 1);
      Serial.print(" km/h dir = ");
      Serial.println(aToB ? "A>B" : "B>A");

      showingResult = true;
      resultMs = millis();
    } else {
      drawReady();
    }
    resetMeasurement();
  }

  if (firstSeenMs && (millis() - firstSeenMs > TIMEOUT_MS)) {
    resetMeasurement();
    drawReady();
  }

  if (showingResult && (millis() - resultMs > SHOW_MS)) {
    showingResult = false;
    drawReady();
  }
}
// END OF CODE
