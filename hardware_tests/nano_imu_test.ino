#include <LiquidCrystal.h>
#include <Arduino_LSM9DS1.h> // <-- THIS WAS THE FIX!

// Tell the Arduino which pins the screen is plugged into
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

void setup() {
  Serial.begin(9600);
  
  // Wait up to 3 seconds for the Serial Monitor to open
  unsigned long startWait = millis();
  while (!Serial && (millis() - startWait < 3000));

  Serial.println("--- Gestura Gauntlet Debug Start ---");

  // Initialize the LCD
  lcd.begin(16, 2);
  lcd.print("Booting...");
  Serial.println("LCD Initialized.");

  // Initialize the correct IMU for the BLE Sense
  if (!IMU.begin()) {
    Serial.println("CRITICAL ERROR: IMU (sensor) failed to start!");
    lcd.clear();
    lcd.print("IMU Error!");
    while (1); // Stop here if sensor is broken
  }
  
  Serial.println("IMU successfully started.");
  lcd.clear();
  lcd.print("Gestura Ready");
  
  delay(2000);
  lcd.clear();
}

void loop() {
  float x, y, z;

  // Read the accelerometer
  if (IMU.accelerationAvailable()) {
    IMU.readAcceleration(x, y, z);

    // Print to Serial Monitor
    Serial.print("Accel X: ");
    Serial.print(x);
    Serial.print(" | Y: ");
    Serial.print(y);
    Serial.print(" | Z: ");
    Serial.println(z);

    // Update the LCD Top Row
    lcd.setCursor(0, 0); 
    if (x > 0.4) {
      lcd.print("Tilted Right!   "); 
    } else if (x < -0.4) {
      lcd.print("Tilted Left!    "); 
    } else {
      lcd.print("Level           "); 
    }

    // Update the LCD Bottom Row (Raw X Value)
    lcd.setCursor(0, 1);
    lcd.print("X-Val: ");
    lcd.print(x);
    lcd.print("      "); // Clear trailing characters
  }
  
  delay(150); // Balanced delay for responsiveness
}


// Pin out
// The Final 1602A to Nano 33 BLE Sense Pinout
// Pin 1 (VSS) ➔ Blue Rail (GND)

// Pin 2 (VDD) ➔ Red Rail (VIN / 5V)

// Pin 3 (V0) ➔ Blue Rail (GND - Max Contrast Workaround)

// Pin 4 (RS) ➔ Arduino 12

// Pin 5 (RW) ➔ Blue Rail (GND)

// Pin 6 (E) ➔ Arduino 11

// Pins 7 to 10 ➔ Leave Empty

// Pin 11 (D4) ➔ Arduino 5

// Pin 12 (D5) ➔ Arduino 4

// Pin 13 (D6) ➔ Arduino 3

// Pin 14 (D7) ➔ Arduino 2

// Pin 15 (A) ➔ Red Rail (VIN / 5V for Backlight)

// Pin 16 (K) ➔ Blue Rail (GND for Backlight)