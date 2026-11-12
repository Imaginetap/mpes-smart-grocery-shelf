#include <Wire.h>
#include <U8g2lib.h>
#include <LiquidCrystal_I2C.h>
#include <string.h>
#include <stdio.h>

// ==========================================
// SMART SHELF MONITORING SYSTEM - ESP32
// ==========================================

// DISPLAY SETTINGS
#define SDA_PIN 21
#define SCL_PIN 22
#define OLED_ADDRESS 0x3C
#define LCD_ADDRESS 0x27

// STOCK CALIBRATION
const float EMPTY_THRESHOLD_CM = 30.0f;
const float FULL_DISTANCE_CM = 5.0f;

// SHELF CAPACITIES
// Milk = 5 bottles
// Cereal = 4 boxes
// Juice = 5 bottles
const int shelfCapacity[3] = {5, 4, 5};

// DISPLAY OBJECTS
U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(
  U8G2_R0,
  U8X8_PIN_NONE
);

LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);

// PRODUCT INFORMATION
const char* productNames[3] = {
  "MILK",
  "CEREAL",
  "JUICE"
};

const char* productIds[3] = {
  "SHELF_01",
  "SHELF_02",
  "SHELF_03"
};

float productPrices[3] = {
  35.00,
  65.00,
  25.00
};

// SENSOR PINS
const int trigPins[3] = {
  25, 26, 27
};

const int echoPins[3] = {
  34, 35, 32
};

// TRAFFIC LIGHT PINS
const int redPins[3] = {
  13, 17, 23
};

const int yellowPins[3] = {
  14, 18, 4
};

const int greenPins[3] = {
  16, 19, 5
};

// SENSOR DATA
float distanceCM[3] = {0, 0, 0};

int stockPercent[3] = {0, 0, 0};
int stockCount[3] = {0, 0, 0};

bool sensorValid[3] = {
  false, false, false
};

// TIMING
unsigned long previousUpdate = 0;
unsigned long previousLCD = 0;

const unsigned long SENSOR_INTERVAL = 1000;
const unsigned long LCD_INTERVAL = 3000;

int lcdPage = 0;

// ==========================================
// READ ULTRASONIC SENSOR
// ==========================================

float readDistance(int trigPin, int echoPin) {

  digitalWrite(trigPin, LOW);
  delayMicroseconds(3);

  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);

  digitalWrite(trigPin, LOW);

  unsigned long duration = pulseIn(
    echoPin,
    HIGH,
    30000
  );

  if (duration == 0) {
    return -1;
  }

  float distance = duration * 0.0343f / 2.0f;

  if (distance < 2.0f || distance > 400.0f) {
    return -1;
  }

  return distance;
}

// ==========================================
// CALCULATE STOCK PERCENTAGE AND COUNT
// ==========================================

int calculateStock(int shelf, float distance) {

  // More than 30 cm means EMPTY
  if (distance > EMPTY_THRESHOLD_CM) {

    stockCount[shelf] = 0;

    return 0;
  }

  // Calculate percentage from distance
  float percentage =
    ((EMPTY_THRESHOLD_CM - distance) /
    (EMPTY_THRESHOLD_CM - FULL_DISTANCE_CM)) * 100.0f;

  percentage = constrain(
    percentage,
    0.0f,
    100.0f
  );

  // Convert percentage into whole product count
  int count = (int)(
    (percentage / 100.0f) *
    shelfCapacity[shelf] + 0.5f
  );

  count = constrain(
    count,
    0,
    shelfCapacity[shelf]
  );

  // Convert count back into percentage
  int adjustedPercentage = (int)(
    ((float)count / shelfCapacity[shelf]) *
    100.0f + 0.5f
  );

  stockCount[shelf] = count;

  return adjustedPercentage;
}

// ==========================================
// READ ALL SENSORS
// ==========================================

void readSensors() {

  for (int i = 0; i < 3; i++) {

    distanceCM[i] = readDistance(
      trigPins[i],
      echoPins[i]
    );

    if (distanceCM[i] < 0) {

      sensorValid[i] = false;

    } else {

      sensorValid[i] = true;

      stockPercent[i] = calculateStock(
        i,
        distanceCM[i]
      );
    }

    delay(60);
  }
}

// ==========================================
// TRAFFIC LIGHT CONTROL
// ==========================================

void setTrafficLight(
  int shelf,
  bool red,
  bool yellow,
  bool green
) {

  digitalWrite(redPins[shelf], red);
  digitalWrite(yellowPins[shelf], yellow);
  digitalWrite(greenPins[shelf], green);
}

void updateTrafficLights() {

  for (int i = 0; i < 3; i++) {

    if (!sensorValid[i] || stockPercent[i] < 30) {

      setTrafficLight(
        i,
        HIGH,
        LOW,
        LOW
      );

    } else if (stockPercent[i] < 70) {

      setTrafficLight(
        i,
        LOW,
        HIGH,
        LOW
      );

    } else {

      setTrafficLight(
        i,
        LOW,
        LOW,
        HIGH
      );
    }
  }
}

// ==========================================
// OLED DISPLAY - STOCK QUANTITY AND PERCENT
// ==========================================

void updateOLED() {

  oled.clearBuffer();

  oled.setFont(u8g2_font_6x10_tr);

  oled.drawStr(
    0,
    10,
    "SMART SHELF STOCK"
  );

  oled.drawHLine(0, 13, 128);

  for (int i = 0; i < 3; i++) {

    int y = 29 + (i * 15);

    char productText[20];

    snprintf(
      productText,
      sizeof(productText),
      "%s %d/%d",
      productNames[i],
      stockCount[i],
      shelfCapacity[i]
    );

    oled.drawStr(
      0,
      y,
      productText
    );

    char percentText[12];

    if (sensorValid[i]) {

      snprintf(
        percentText,
        sizeof(percentText),
        "%d%%",
        stockPercent[i]
      );

    } else {

      snprintf(
        percentText,
        sizeof(percentText),
        "ERR"
      );
    }

    oled.drawStr(
      96,
      y,
      percentText
    );
  }

  oled.drawHLine(0, 61, 128);

  oled.sendBuffer();
}

// ==========================================
// LCD DISPLAY HELPER
// ==========================================

void printLCDLine(
  int row,
  const char* message
) {

  lcd.setCursor(0, row);

  lcd.print(message);

  int length = strlen(message);

  for (int i = length; i < 16; i++) {
    lcd.print(" ");
  }
}

// ==========================================
// LCD DISPLAY - PRODUCT PRICES
// ==========================================

void updateLCD() {

  if (lcdPage == 0) {

    // PAGE 1
    printLCDLine(
      0,
      "MILK     P35.00"
    );

    printLCDLine(
      1,
      "CEREAL   P65.00"
    );

  } else {

    // PAGE 2
    printLCDLine(
      0,
      "JUICE    P25.00"
    );

    printLCDLine(
      1,
      "SMART SHELF"
    );
  }

  // Switch pages
  lcdPage = 1 - lcdPage;
}

// ==========================================
// SEND DATA TO WEB DASHBOARD
// ==========================================

void sendDashboardJSON() {

  Serial.print(
    "{\"type\":\"smart_shelf\","
    "\"device\":\"ESP32\","
    "\"uptime_ms\":"
  );

  Serial.print(millis());

  Serial.print(",\"shelves\":[");

  for (int i = 0; i < 3; i++) {

    if (i > 0) {
      Serial.print(",");
    }

    const char* status;

    if (!sensorValid[i]) {

      status = "SENSOR_ERROR";

    } else if (stockCount[i] == 0) {

      status = "EMPTY";

    } else if (stockPercent[i] < 30) {

      status = "LOW";

    } else if (stockPercent[i] < 70) {

      status = "MEDIUM";

    } else {

      status = "OPTIMAL";
    }

    Serial.print("{\"id\":\"");
    Serial.print(productIds[i]);

    Serial.print("\",\"product\":\"");
    Serial.print(productNames[i]);

    Serial.print("\",\"price\":");
    Serial.print(productPrices[i], 2);

    Serial.print(",\"capacity\":");
    Serial.print(shelfCapacity[i]);

    Serial.print(",\"stock_count\":");

    if (sensorValid[i]) {
      Serial.print(stockCount[i]);
    } else {
      Serial.print("null");
    }

    Serial.print(",\"distance_cm\":");

    if (sensorValid[i]) {
      Serial.print(distanceCM[i], 1);
    } else {
      Serial.print("null");
    }

    Serial.print(",\"stock_percent\":");

    if (sensorValid[i]) {
      Serial.print(stockPercent[i]);
    } else {
      Serial.print("null");
    }

    Serial.print(",\"sensor_valid\":");

    Serial.print(
      sensorValid[i] ? "true" : "false"
    );

    Serial.print(",\"status\":\"");
    Serial.print(status);

    Serial.print("\"}");
  }

  Serial.println("]}");
}

// ==========================================
// SETUP
// ==========================================

void setup() {

  Serial.begin(115200);

  delay(300);

  // Initialize I2C
  Wire.begin(
    SDA_PIN,
    SCL_PIN
  );

  // Initialize pins
  for (int i = 0; i < 3; i++) {

    pinMode(
      trigPins[i],
      OUTPUT
    );

    pinMode(
      echoPins[i],
      INPUT
    );

    digitalWrite(
      trigPins[i],
      LOW
    );

    pinMode(
      redPins[i],
      OUTPUT
    );

    pinMode(
      yellowPins[i],
      OUTPUT
    );

    pinMode(
      greenPins[i],
      OUTPUT
    );

    setTrafficLight(
      i,
      HIGH,
      LOW,
      LOW
    );
  }

  // Initialize OLED
  oled.setI2CAddress(
    OLED_ADDRESS << 1
  );

  oled.begin();

  // Initialize LCD
  lcd.init();
  lcd.backlight();

  printLCDLine(
    0,
    "SMART SHELF"
  );

  printLCDLine(
    1,
    "INITIALIZING..."
  );

  // Initialize displays and sensors
  readSensors();

  updateTrafficLights();

  updateOLED();

  // Show first price page immediately
  lcdPage = 0;
  updateLCD();

  // Send initial sensor data
  sendDashboardJSON();
}

// ==========================================
// MAIN LOOP
// ==========================================

void loop() {

  unsigned long now = millis();

  // Update sensors every second
  if (now - previousUpdate >= SENSOR_INTERVAL) {

    previousUpdate = now;

    readSensors();

    updateTrafficLights();

    updateOLED();

    sendDashboardJSON();
  }

  // Switch LCD price pages every 3 seconds
  if (now - previousLCD >= LCD_INTERVAL) {

    previousLCD = now;

    updateLCD();
  }
}
