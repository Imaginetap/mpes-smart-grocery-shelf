# Smart Shelf System — ESP32 USB Serial Dashboard

## Included files
- `index.html` — dashboard layout
- `style.css` — dashboard styling
- `app.js` — Web Serial connection and live UI updates
- `firebase-config.js` — intentionally unused placeholder for a later Firebase phase
- `arduino/smart_shelf_esp32.ino` — ESP32 firmware

## Requirements
- ESP32 board and USB data cable
- Arduino IDE
- Arduino libraries: U8g2 and LiquidCrystal_I2C
- Desktop Google Chrome or Microsoft Edge with Web Serial support
- VS Code with Live Server (or another localhost web server)

## Run the dashboard
1. Open the `smart-shelf-system` folder in VS Code.
2. Install the Live Server extension if needed.
3. Right-click `index.html` and choose **Open with Live Server**.
4. Use desktop Chrome or Edge.
5. Connect the ESP32 by USB.
6. Click **Connect ESP32**, select the ESP32 serial port, and approve access.
7. Do not keep Arduino IDE Serial Monitor open at the same time; only one application can normally own the serial port.

## Upload the firmware
1. Open `arduino/smart_shelf_esp32.ino` in Arduino IDE.
2. Select the correct ESP32 board and COM/serial port.
3. Install `U8g2` and `LiquidCrystal_I2C` if they are not already installed.
4. Check your LCD I2C address and wiring.
5. Upload the sketch.
6. Close Serial Monitor before connecting from the browser.

## Important calibration
`emptyDistance[]` and `fullDistance[]` in the sketch are example calibration values (35 cm and 5 cm). Measure the actual sensor distance with each shelf empty and full, then update those arrays separately for each shelf.

The dashboard shows sensor-derived percentage, not item quantity. A percentage cannot be converted into units until the physical capacity and calibration method are established.

## Serial protocol
The ESP32 sends one JSON object per line at 115200 baud. The browser ignores startup/debug lines that are not valid Smart Shelf JSON. Do not add ordinary debug prints to the serial stream while the dashboard is connected.

## Scope of this phase
- ESP32 → browser only
- No Firebase connection
- No dashboard-to-ESP32 commands
- No simulated pickup/restock actions
- No actual item-count conversion
