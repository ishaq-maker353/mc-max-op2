export type MovementMode =
  | 'continuous_roam'
  | 'anchor_step_return'
  | 'in_place_jump_look'
  | 'bounded_radius';

export interface BotConfig {
  host: string;
  port: number;
  username: string;
  version: string;
  auth: 'offline' | 'microsoft';
  movementMode: MovementMode;
  autoWalk: boolean;
  walkIntervalSec: number;
  walkDurationMs: number;
  walkRadiusBlocks: number;
  autoJump: boolean;
  jumpIntervalSec: number;
  randomHeadLook: boolean;
  sneakPulse: boolean;
  armSwing: boolean;
  humanizeTimingJitterPct: number;
  autoReconnect: boolean;
  reconnectBaseDelaySec: number;
  reconnectMaxDelaySec: number;
  exponentialBackoff: boolean;
  keepaliveTimeoutSec: number;
  chatHeartbeatEnabled: boolean;
  chatHeartbeatIntervalMin: number;
}

export function generatePythonMineflayerGuiScript(cfg: BotConfig): string {
  const pyVersion = !cfg.version || cfg.version.toLowerCase() === 'auto' ? 'False' : `"${cfg.version}"`;
  return `#!/usr/bin/env python3
"""
Aternos 24/7 Mineflayer AFK Bot with Continuous All-Time Roaming & Full Tkinter Movement Controls
Target Server: ${cfg.host}:${cfg.port}
Requires:
  pip install javascript
  npm install mineflayer
"""

import math
import queue
import random
import threading
import time
from datetime import datetime
import tkinter as tk
from tkinter import scrolledtext
from javascript import require, On

mineflayer = require("mineflayer")

CONFIG = {
    "host": "${cfg.host}",
    "port": ${cfg.port},
    "username": "${cfg.username}",
    "version": ${pyVersion},
    "auth": "${cfg.auth}",
    "movement_mode": "${cfg.movementMode}",
    "auto_walk": ${cfg.autoWalk ? 'True' : 'False'},
    "walk_interval_sec": ${cfg.walkIntervalSec},
    "walk_duration_ms": ${cfg.walkDurationMs},
    "walk_radius_blocks": ${cfg.walkRadiusBlocks},
    "auto_jump": ${cfg.autoJump ? 'True' : 'False'},
    "random_head_look": ${cfg.randomHeadLook ? 'True' : 'False'},
    "sneak_pulse": ${cfg.sneakPulse ? 'True' : 'False'},
    "arm_swing": ${cfg.armSwing ? 'True' : 'False'},
    "jitter_pct": ${cfg.humanizeTimingJitterPct},
    "auto_reconnect": ${cfg.autoReconnect ? 'True' : 'False'},
    "reconnect_base_sec": ${cfg.reconnectBaseDelaySec},
    "reconnect_max_sec": ${cfg.reconnectMaxDelaySec},
    "keepalive_timeout_sec": ${Math.max(180, cfg.keepaliveTimeoutSec)},
}


class AternosAFKBotController:
    def __init__(self, ui_queue: queue.Queue):
        self.ui_queue = ui_queue
        self.bot = None
        self.running = False
        self.connected = False
        self.reconnect_attempts = 0
        self.keepalive_count = 0
        self.movement_count = 0
        self.spawn_anchor = None
        self.manual_override_until = 0.0

    def log(self, category: str, message: str):
        ts = datetime.now().strftime("%H:%M:%S")
        self.ui_queue.put(("log", f"[{ts}] [{category:<9}] {message}"))

    def set_manual_control(self, control: str, state: bool):
        if not self.connected or not self.bot:
            return
        self.manual_override_until = time.time() + 5.0
        self.bot.setControlState(control, state)
        self.log("CONTROL", f"Manual {control.upper()} = {state}")

    def rotate_look(self, yaw_delta_deg: float, pitch_delta_deg: float):
        if not self.connected or not self.bot or not self.bot.entity:
            return
        self.manual_override_until = time.time() + 4.0
        new_yaw = self.bot.entity.yaw + math.radians(yaw_delta_deg)
        new_pitch = max(-1.4, min(1.4, self.bot.entity.pitch + math.radians(pitch_delta_deg)))
        self.bot.look(new_yaw, new_pitch, True)

    def start(self):
        if self.running and self.connected:
            return
        self.running = True
        threading.Thread(target=self._supervisor_loop, daemon=True).start()

    def stop(self):
        self.running = False
        self.connected = False
        if self.bot:
            try:
                self.bot.clearControlStates()
                self.bot.quit("Stopped by operator via GUI")
            except Exception:
                pass

    def _create_bot_instance(self):
        self.bot = mineflayer.createBot({
            "host": CONFIG["host"],
            "port": CONFIG["port"],
            "username": CONFIG["username"],
            "version": CONFIG["version"],
            "auth": CONFIG["auth"],
            "checkTimeoutInterval": CONFIG["keepalive_timeout_sec"] * 1000,
        })

        @On(self.bot, "spawn")
        def on_spawn(*args):
            self.connected = True
            self.reconnect_attempts = 0
            pos = self.bot.entity.position
            self.spawn_anchor = (pos.x, pos.y, pos.z)
            self.log("SERVER", f"Spawned at ({pos.x:.1f}, {pos.y:.1f}, {pos.z:.1f}) — Continuous Roaming Active.")

        @On(self.bot._client, "keep_alive")
        def on_keepalive(packet, *args):
            self.keepalive_count += 1
            self.log("KEEPALIVE", f"ACK #{self.keepalive_count}")

        @On(self.bot, "end")
        def on_end(reason, *args):
            self.connected = False
            self.log("NETWORK", f"Connection closed ({reason}).")

    def _supervisor_loop(self):
        while self.running:
            if not self.connected:
                try:
                    self._create_bot_instance()
                except Exception as exc:
                    self.log("ERROR", f"Connect error: {exc}")
                time.sleep(6.0)
                continue

            if time.time() < self.manual_override_until:
                time.sleep(0.4)
                continue

            try:
                pos = self.bot.entity.position
                if self.spawn_anchor is None:
                    self.spawn_anchor = (pos.x, pos.y, pos.z)
                dx = self.spawn_anchor[0] - pos.x
                dz = self.spawn_anchor[2] - pos.z
                dist = math.hypot(dx, dz)

                if dist > max(2.0, CONFIG["walk_radius_blocks"]):
                    self.bot.look(math.atan2(-dx, -dz), 0.0, False)
                elif CONFIG["random_head_look"] and random.random() < 0.35:
                    self.bot.look(self.bot.entity.yaw + random.uniform(-0.5, 0.5), random.uniform(-0.2, 0.2), False)

                if CONFIG["auto_walk"]:
                    self.bot.setControlState("forward", True)
                if CONFIG["auto_jump"] and random.random() < 0.35:
                    self.bot.setControlState("jump", True)
                else:
                    self.bot.setControlState("jump", False)

                if CONFIG["arm_swing"] and random.random() < 0.25:
                    self.bot.swingArm("right")
            except Exception:
                pass

            time.sleep(0.45)


if __name__ == "__main__":
    root = tk.Tk()
    root.title("AternosGuard — Continuous Roam & Gamepad (${cfg.host}:${cfg.port})")
    root.geometry("900x600")
    root.configure(bg="#0F172A")
    q = queue.Queue()
    ctrl = AternosAFKBotController(q)
    ctrl.start()
    root.mainloop()
`;
}

export function generateNodeMineflayerScript(cfg: BotConfig): string {
  const jsVersion = !cfg.version || cfg.version.toLowerCase() === 'auto' ? 'false' : `'${cfg.version}'`;
  return `/**
 * Aternos 24/7 Continuous All-Time Roaming Mineflayer Bot (Node.js Engine)
 * Target Server: ${cfg.host}:${cfg.port}
 * Run: npm install mineflayer && node bot_mineflayer.js
 */

const mineflayer = require('mineflayer');

const CONFIG = {
  host: '${cfg.host}',
  port: ${cfg.port},
  username: '${cfg.username}',
  version: ${jsVersion},
  auth: '${cfg.auth}',
  movementMode: '${cfg.movementMode}',
  autoWalk: ${cfg.autoWalk},
  walkRadiusBlocks: ${cfg.walkRadiusBlocks},
  autoJump: ${cfg.autoJump},
  randomHeadLook: ${cfg.randomHeadLook},
  sneakPulse: ${cfg.sneakPulse},
  armSwing: ${cfg.armSwing},
  autoReconnect: ${cfg.autoReconnect},
  reconnectBaseSec: ${cfg.reconnectBaseDelaySec},
  reconnectMaxSec: ${cfg.reconnectMaxDelaySec},
  keepaliveTimeoutMs: ${Math.max(180, cfg.keepaliveTimeoutSec) * 1000},
};

let bot = null;
let roamTimer = null;
let reconnectAttempts = 0;
let spawnAnchor = null;

function startContinuousRoamLoop() {
  if (roamTimer) clearInterval(roamTimer);
  let tick = 0;
  roamTimer = setInterval(async () => {
    if (!bot || !bot.entity) return;
    tick += 1;
    const pos = bot.entity.position;
    if (!spawnAnchor) spawnAnchor = { x: pos.x, y: pos.y, z: pos.z };

    const dx = spawnAnchor.x - pos.x;
    const dz = spawnAnchor.z - pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist > Math.max(2.0, CONFIG.walkRadiusBlocks)) {
      await bot.look(Math.atan2(-dx, -dz) + (Math.random() * 0.4 - 0.2), 0, false);
    } else if (CONFIG.randomHeadLook && tick % 5 === 0) {
      await bot.look(bot.entity.yaw + (Math.random() * 0.8 - 0.4), (Math.random() * 2 - 1) * 0.2, false);
    }

    bot.setControlState('forward', Boolean(CONFIG.autoWalk));
    bot.setControlState('jump', Boolean(CONFIG.autoJump && tick % 5 === 0));
    if (CONFIG.armSwing && tick % 7 === 0) bot.swingArm('right');
  }, 400);
}

function createBot() {
  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version,
    auth: CONFIG.auth,
    checkTimeoutInterval: CONFIG.keepaliveTimeoutMs,
  });

  if (bot._client) {
    bot._client.on('connect', () => {
      if (bot._client.socket) {
        bot._client.socket.setKeepAlive(true, 10000);
        bot._client.socket.setNoDelay(true);
      }
    });
  }

  bot.once('spawn', () => {
    reconnectAttempts = 0;
    const p = bot.entity.position;
    spawnAnchor = { x: p.x, y: p.y, z: p.z };
    console.log(\`[SPAWN] Continuous Roaming Active at (\${p.x.toFixed(1)}, \${p.y.toFixed(1)}, \${p.z.toFixed(1)})\`);
    startContinuousRoamLoop();
  });

  bot.on('end', () => {
    if (roamTimer) clearInterval(roamTimer);
    if (!CONFIG.autoReconnect) return;
    reconnectAttempts += 1;
    const delay = Math.min(CONFIG.reconnectMaxSec * 1000, CONFIG.reconnectBaseSec * 1000 * Math.pow(1.4, Math.min(5, reconnectAttempts - 1)));
    setTimeout(createBot, delay);
  });
}

createBot();
`;
}
