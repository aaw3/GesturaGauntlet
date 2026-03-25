from machine import Pin, I2C
import ssd1306

# Initialize the I2C bus on GP4/GP5 (Pico 2W default)
# Reference the SCL/SDA endpoints from your v0 prompt
i2c = I2C(0, scl=Pin(5), sda=Pin(4), freq=400000)

# Initialize the OLED (width=128, height=64)
oled = ssd1306.SSD1306_I2C(128, 64, i2c)

# Clear the screen
oled.fill(0)
oled.show()

# Write your first message
oled.text("Gesture Gauntlet", 0, 0)
oled.text("OLED is ACTIVE!", 0, 16)
oled.text("Waiting...", 0, 32)

# Show the text
oled.show()

# Verify initialization for next-step integration
print("OLED Initialized and displaying test message.")
print("Wiring validated.")