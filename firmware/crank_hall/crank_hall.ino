// 手摇空间音乐盒 · 摇柄编码器 + 开盖霍尔 → USB 键盘（HID）
// 板子：Arduino Pro Micro / Leonardo（ATmega32U4，原生 USB）
// 接到 Jupiter 主板的 USB Host 口后，相框里的网页直接收到按键，无需驱动。
//
// 键位协议（与 prototype/src/config.js 的 INPUT.hidKeys 一致）：
//   ]  正转一个定位      [  反转一个定位
//   o  上盖打开          c  上盖合上
//   R  （Shift+R）演示重置，来自背面隐藏按钮
//
// 接线：
//   EC11 A → D2，EC11 B → D3，EC11 C → GND（内部上拉）
//   霍尔开关（A3144 等，开漏，靠近磁铁输出低）OUT → D4，VCC → 5V，GND → GND
//   背面重置按钮 → D5 与 GND 之间

#include <Keyboard.h>

const uint8_t PIN_ENC_A = 2;
const uint8_t PIN_ENC_B = 3;
const uint8_t PIN_HALL = 4;
const uint8_t PIN_RESET = 5;

const int8_t DIRECTION = 1;              // 顺时针摇却显示反转时改成 -1
const uint8_t COUNTS_PER_DETENT = 4;     // EC11：一个定位 = 4 个正交计数
const uint16_t HALL_DEBOUNCE_MS = 120;   // 避免临界位置抖动误触发（方案第 08 页）
const uint16_t LID_RESEND_MS = 3000;     // 周期性重发开合状态，网页晚于板子启动也能对齐

volatile int16_t counts = 0;
volatile uint8_t lastAB = 0;
const int8_t QDEC[16] = { 0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0 };

void onEdge() {
  uint8_t ab = (digitalRead(PIN_ENC_A) << 1) | digitalRead(PIN_ENC_B);
  counts += QDEC[(lastAB << 2) | ab];
  lastAB = ab;
}

bool lidOpen = false, lidCandidate = false;
uint32_t lidSince = 0, lidSentAt = 0;
bool resetWasDown = false;

void setup() {
  pinMode(PIN_ENC_A, INPUT_PULLUP);
  pinMode(PIN_ENC_B, INPUT_PULLUP);
  pinMode(PIN_HALL, INPUT_PULLUP);
  pinMode(PIN_RESET, INPUT_PULLUP);
  lastAB = (digitalRead(PIN_ENC_A) << 1) | digitalRead(PIN_ENC_B);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_A), onEdge, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC_B), onEdge, CHANGE);
  lidOpen = lidCandidate = digitalRead(PIN_HALL) == HIGH;  // 远离磁铁 = 打开
  Keyboard.begin();
  delay(1500);  // 等主机枚举完成
}

void loop() {
  // 摇柄：累计到一个定位就发一次按键
  static int16_t acc = 0;
  noInterrupts();
  int16_t c = counts;
  counts = 0;
  interrupts();
  acc += c * DIRECTION;
  while (acc >= COUNTS_PER_DETENT) { Keyboard.write(']'); acc -= COUNTS_PER_DETENT; }
  while (acc <= -COUNTS_PER_DETENT) { Keyboard.write('['); acc += COUNTS_PER_DETENT; }

  // 开盖检测：稳定 120ms 才算数
  uint32_t now = millis();
  bool raw = digitalRead(PIN_HALL) == HIGH;
  if (raw != lidCandidate) { lidCandidate = raw; lidSince = now; }
  bool changed = lidCandidate != lidOpen && now - lidSince > HALL_DEBOUNCE_MS;
  if (changed) lidOpen = lidCandidate;
  if (changed || now - lidSentAt > LID_RESEND_MS) {
    Keyboard.write(lidOpen ? 'o' : 'c');
    lidSentAt = now;
  }

  // 背面隐藏重置
  bool resetDown = digitalRead(PIN_RESET) == LOW;
  if (resetDown && !resetWasDown) Keyboard.write('R');
  resetWasDown = resetDown;

  delay(2);
}
