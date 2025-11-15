import type { Settings, ControlState, LogEntry, LogSettings, LogLevel, PlugStatusTracking, ChargingContext } from "@shared/schema";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// Simple logger for storage operations (avoids circular dependency with logger.ts)
// Uses identical timestamp formatting as logger.ts to ensure consistency
// Respects the configured log level to avoid excessive console output
function logStorage(level: "debug" | "info" | "warning", message: string, details?: string): void {
  const logLevelPriority: Record<string, number> = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3,
  };

  // Check log level before emitting (with fallback for initialization phase)
  let currentLevelPriority = logLevelPriority.debug; // Default: log everything during init
  try {
    if (typeof storage !== 'undefined') {
      const currentSettings = storage.getLogSettings();
      currentLevelPriority = logLevelPriority[currentSettings.level];
    }
  } catch (e) {
    // storage not yet initialized - use default
  }
  
  const messageLevelPriority = logLevelPriority[level];
  
  if (messageLevelPriority >= currentLevelPriority) {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    const timestamp = `${hours}:${minutes}:${seconds},${milliseconds}`;
    
    const levelUpper = level.toUpperCase() as 'DEBUG' | 'INFO' | 'WARNING';
    const fullMessage = details ? `${message} - ${details}` : message;
    console.log(`[${timestamp}] [${levelUpper}] [storage] ${fullMessage}`);
    
    // Also add to central log store so it appears in UI (if storage is ready)
    try {
      if (typeof storage !== 'undefined') {
        storage.addLog({ level: level as LogLevel, category: "storage", message, details });
      }
    } catch (e) {
      // storage not yet initialized - skip
    }
  }
}

export interface IStorage {
  getSettings(): Settings | null;
  saveSettings(settings: Settings): void;
  getControlState(): ControlState;
  saveControlState(state: ControlState): void;
  updateControlState(updates: Partial<ControlState>): void;
  getPlugStatusTracking(): PlugStatusTracking;
  savePlugStatusTracking(tracking: PlugStatusTracking): void;
  getChargingContext(): ChargingContext;
  saveChargingContext(context: ChargingContext): void;
  updateChargingContext(updates: Partial<ChargingContext>): void;
  getLogs(): LogEntry[];
  addLog(entry: Omit<LogEntry, "id" | "timestamp">): void;
  clearLogs(): void;
  getLogSettings(): LogSettings;
  saveLogSettings(settings: LogSettings): void;
}

export class MemStorage implements IStorage {
  private settingsFilePath = join(process.cwd(), "data", "settings.json");
  private controlStateFilePath = join(process.cwd(), "data", "control-state.json");
  private plugTrackingFilePath = join(process.cwd(), "data", "plug-tracking.json");
  private chargingContextFilePath = join(process.cwd(), "data", "charging-context.json");
  private settings: Settings | null = null;
  private controlState: ControlState = {
    pvSurplus: false,
    nightCharging: false,
    batteryLock: false,
    gridCharging: false,
  };
  private plugStatusTracking: PlugStatusTracking = {};
  private chargingContext: ChargingContext = {
    strategy: "off",
    isActive: false,
    currentAmpere: 0,
    targetAmpere: 0,
    currentPhases: 3,
    adjustmentCount: 0,
    lastAdjustmentTimes: [],
  };
  private logs: LogEntry[] = [];
  private logSettings: LogSettings = {
    level: "debug" as LogLevel,
  };
  private maxLogs = 1000;

  constructor() {
    // Erstelle data-Verzeichnis falls nicht vorhanden
    const dataDir = join(process.cwd(), "data");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Lade Settings aus Datei oder verwende Defaults
    this.settings = this.loadSettingsFromFile();
    
    // Lade Control State aus Datei
    this.controlState = this.loadControlStateFromFile();
    
    // Lade Plug Status Tracking aus Datei
    this.plugStatusTracking = this.loadPlugTrackingFromFile();
    
    // Lade Charging Context aus Datei
    this.chargingContext = this.loadChargingContextFromFile();
  }

  private loadSettingsFromFile(): Settings {
    if (existsSync(this.settingsFilePath)) {
      try {
        const data = readFileSync(this.settingsFilePath, "utf-8");
        const loaded = JSON.parse(data);
        logStorage("debug", `Einstellungen geladen aus: ${this.settingsFilePath}`);
        return loaded;
      } catch (error) {
        logStorage("warning", "Fehler beim Laden der Einstellungen", error instanceof Error ? error.message : String(error));
      }
    }

    // Default-Einstellungen
    const defaults: Settings = {
      wallboxIp: "192.168.40.16",
      pvSurplusOnUrl: "http://192.168.40.11:8083/fhem?detail=autoWallboxPV&cmd.autoWallboxPV=set%20autoWallboxPV%20on",
      pvSurplusOffUrl: "http://192.168.40.11:8083/fhem?detail=autoWallboxPV&cmd.autoWallboxPV=set%20autoWallboxPV%20off",
      nightChargingSchedule: {
        enabled: false,
        startTime: "00:00",
        endTime: "05:00",
      },
    };
    
    // Speichere Defaults in Datei
    this.saveSettingsToFile(defaults);
    return defaults;
  }

  private saveSettingsToFile(settings: Settings): void {
    try {
      writeFileSync(this.settingsFilePath, JSON.stringify(settings, null, 2), "utf-8");
      logStorage("debug", `Einstellungen gespeichert in: ${this.settingsFilePath}`);
    } catch (error) {
      logStorage("warning", "Fehler beim Speichern der Einstellungen", error instanceof Error ? error.message : String(error));
    }
  }

  private loadControlStateFromFile(): ControlState {
    if (existsSync(this.controlStateFilePath)) {
      try {
        const data = readFileSync(this.controlStateFilePath, "utf-8");
        const loaded = JSON.parse(data);
        logStorage("debug", `Control State geladen aus: ${this.controlStateFilePath}`);
        
        // Stelle sicher, dass alle Felder vorhanden sind (Backward Compatibility)
        return {
          pvSurplus: false,
          nightCharging: false,
          batteryLock: false,
          gridCharging: false,
          ...loaded,
        };
      } catch (error) {
        logStorage("warning", "Fehler beim Laden des Control States", error instanceof Error ? error.message : String(error));
      }
    }

    // Default Control State
    return {
      pvSurplus: false,
      nightCharging: false,
      batteryLock: false,
      gridCharging: false,
    };
  }

  private saveControlStateToFile(state: ControlState): void {
    try {
      writeFileSync(this.controlStateFilePath, JSON.stringify(state, null, 2), "utf-8");
      logStorage("debug", `Control State gespeichert in: ${this.controlStateFilePath}`);
    } catch (error) {
      logStorage("warning", "Fehler beim Speichern des Control States", error instanceof Error ? error.message : String(error));
    }
  }

  private loadPlugTrackingFromFile(): PlugStatusTracking {
    if (existsSync(this.plugTrackingFilePath)) {
      try {
        const data = readFileSync(this.plugTrackingFilePath, "utf-8");
        const loaded = JSON.parse(data);
        logStorage("debug", `Plug Tracking geladen aus: ${this.plugTrackingFilePath}`);
        return loaded;
      } catch (error) {
        logStorage("warning", "Fehler beim Laden des Plug Trackings", error instanceof Error ? error.message : String(error));
      }
    }
    
    // Default Plug Tracking (leer)
    return {};
  }

  private savePlugTrackingToFile(tracking: PlugStatusTracking): void {
    try {
      writeFileSync(this.plugTrackingFilePath, JSON.stringify(tracking, null, 2), "utf-8");
      logStorage("debug", `Plug Tracking gespeichert in: ${this.plugTrackingFilePath}`);
    } catch (error) {
      logStorage("warning", "Fehler beim Speichern des Plug Trackings", error instanceof Error ? error.message : String(error));
    }
  }

  private loadChargingContextFromFile(): ChargingContext {
    if (existsSync(this.chargingContextFilePath)) {
      try {
        const data = readFileSync(this.chargingContextFilePath, "utf-8");
        const loaded = JSON.parse(data);
        logStorage("debug", `Charging Context geladen aus: ${this.chargingContextFilePath}`);
        
        return {
          strategy: "off",
          isActive: false,
          currentAmpere: 0,
          targetAmpere: 0,
          currentPhases: 3,
          adjustmentCount: 0,
          lastAdjustmentTimes: [],
          ...loaded,
        };
      } catch (error) {
        logStorage("warning", "Fehler beim Laden des Charging Context", error instanceof Error ? error.message : String(error));
      }
    }
    
    return {
      strategy: "off",
      isActive: false,
      currentAmpere: 0,
      targetAmpere: 0,
      currentPhases: 3,
      adjustmentCount: 0,
      lastAdjustmentTimes: [],
    };
  }

  private saveChargingContextToFile(context: ChargingContext): void {
    try {
      writeFileSync(this.chargingContextFilePath, JSON.stringify(context, null, 2), "utf-8");
      logStorage("debug", `Charging Context gespeichert in: ${this.chargingContextFilePath}`);
    } catch (error) {
      logStorage("warning", "Fehler beim Speichern des Charging Context", error instanceof Error ? error.message : String(error));
    }
  }

  getSettings(): Settings | null {
    return this.settings;
  }

  saveSettings(settings: Settings): void {
    const previousSettings = this.settings;
    const wasDemoMode = previousSettings?.demoMode || false;
    const isDemoMode = settings.demoMode || false;
    
    // Demo-Modus aktiviert: Backup erstellen und IPs auf Mock-Server setzen
    if (isDemoMode && !wasDemoMode) {
      // Wallbox IP Backup
      settings.wallboxIpBackup = settings.wallboxIp;
      settings.wallboxIp = "127.0.0.1";
      logStorage("debug", `Demo-Modus aktiviert - Wallbox Backup: ${settings.wallboxIpBackup} → 127.0.0.1`);
      
      // E3DC IP: IMMER auf Mock setzen, Backup nur wenn vorher konfiguriert
      if (settings.e3dcIp) {
        settings.e3dcIpBackup = settings.e3dcIp;
        logStorage("debug", `Demo-Modus aktiviert - E3DC Backup: ${settings.e3dcIpBackup} → 127.0.0.1:5502`);
      }
      settings.e3dcIp = "127.0.0.1:5502";
      
      // FHEM URLs: Backup erstellen und auf Mock-Server setzen
      if (settings.pvSurplusOnUrl) {
        settings.pvSurplusOnUrlBackup = settings.pvSurplusOnUrl;
        settings.pvSurplusOnUrl = "http://127.0.0.1:8083/fhem?cmd.autoWallboxPV=on";
        logStorage("debug", "Demo-Modus aktiviert - FHEM ON URL → Mock-Server");
      }
      if (settings.pvSurplusOffUrl) {
        settings.pvSurplusOffUrlBackup = settings.pvSurplusOffUrl;
        settings.pvSurplusOffUrl = "http://127.0.0.1:8083/fhem?cmd.autoWallboxPV=off";
        logStorage("debug", "Demo-Modus aktiviert - FHEM OFF URL → Mock-Server");
      }
    }
    // Demo-Modus deaktiviert: IPs aus previousSettings-Backup wiederherstellen
    else if (!isDemoMode && wasDemoMode) {
      // Wallbox IP wiederherstellen
      if (previousSettings?.wallboxIpBackup) {
        settings.wallboxIp = previousSettings.wallboxIpBackup;
        logStorage("debug", `Demo-Modus deaktiviert - Wallbox wiederhergestellt: ${settings.wallboxIp}`);
      } else {
        // Migration/Edge Case: Kein Backup vorhanden
        if (settings.wallboxIp === "127.0.0.1") {
          settings.wallboxIp = "192.168.40.16";
          logStorage("warning", `Demo-Modus deaktiviert ohne Backup - Wallbox Fallback auf Default-IP: ${settings.wallboxIp}`);
        }
      }
      delete settings.wallboxIpBackup;
      
      // E3DC IP wiederherstellen (nur wenn Backup existiert)
      if (previousSettings?.e3dcIpBackup) {
        settings.e3dcIp = previousSettings.e3dcIpBackup;
        logStorage("debug", `Demo-Modus deaktiviert - E3DC wiederhergestellt: ${settings.e3dcIp}`);
        delete settings.e3dcIpBackup;
      } else if (settings.e3dcIp === "127.0.0.1:5502") {
        // Falls E3DC auf Mock-IP war aber kein Backup existiert, setze auf undefined
        delete settings.e3dcIp;
        logStorage("warning", "Demo-Modus deaktiviert ohne E3DC Backup - E3DC IP entfernt");
      }
      
      // FHEM URLs wiederherstellen
      if (previousSettings?.pvSurplusOnUrlBackup) {
        settings.pvSurplusOnUrl = previousSettings.pvSurplusOnUrlBackup;
        logStorage("debug", "Demo-Modus deaktiviert - FHEM ON URL wiederhergestellt");
      }
      delete settings.pvSurplusOnUrlBackup;
      
      if (previousSettings?.pvSurplusOffUrlBackup) {
        settings.pvSurplusOffUrl = previousSettings.pvSurplusOffUrlBackup;
        logStorage("debug", "Demo-Modus deaktiviert - FHEM OFF URL wiederhergestellt");
      }
      delete settings.pvSurplusOffUrlBackup;
    }
    // Demo-Modus bleibt aktiv: IPs auf Mock-Server behalten, Backups erhalten
    else if (isDemoMode && wasDemoMode) {
      // Wallbox: Force Mock-IP
      settings.wallboxIp = "127.0.0.1";
      if (!settings.wallboxIpBackup && previousSettings?.wallboxIpBackup) {
        settings.wallboxIpBackup = previousSettings.wallboxIpBackup;
      }
      
      // E3DC: Wenn User neue ECHTE IP setzt (nicht Mock), backup it first
      if (settings.e3dcIp && settings.e3dcIp !== "127.0.0.1:5502") {
        // User hat echte IP eingetragen während Demo aktiv - backup erstellen
        settings.e3dcIpBackup = settings.e3dcIp;
        settings.e3dcIp = "127.0.0.1:5502";
        logStorage("debug", `Demo-Modus aktiv - Neue E3DC IP gesichert: ${settings.e3dcIpBackup} → 127.0.0.1:5502`);
      } else if (settings.e3dcIp === "127.0.0.1:5502") {
        // E3DC Mock-IP bleibt gesetzt → Backup aus previousSettings übernehmen
        if (!settings.e3dcIpBackup && previousSettings?.e3dcIpBackup) {
          settings.e3dcIpBackup = previousSettings.e3dcIpBackup;
        }
      } else if (!settings.e3dcIp && previousSettings?.e3dcIp === "127.0.0.1:5502") {
        // E3DC IP leer vom Frontend, aber previous war Mock → Force Mock (fresh install case)
        settings.e3dcIp = "127.0.0.1:5502";
        if (!settings.e3dcIpBackup && previousSettings?.e3dcIpBackup) {
          settings.e3dcIpBackup = previousSettings.e3dcIpBackup;
        }
      } else if (!settings.e3dcIp && previousSettings?.e3dcIp && previousSettings.e3dcIp !== "127.0.0.1:5502") {
        // User hat E3DC gelöscht (undefined/null) UND previous war ECHTE IP → Respektiere Löschung
        delete settings.e3dcIpBackup;
        logStorage("debug", "Demo-Modus aktiv - E3DC IP gelöscht (User-Request)");
      }
      
      // FHEM URLs: Force Mock-URLs, erhalte Backups
      settings.pvSurplusOnUrl = "http://127.0.0.1:8083/fhem?cmd.autoWallboxPV=on";
      settings.pvSurplusOffUrl = "http://127.0.0.1:8083/fhem?cmd.autoWallboxPV=off";
      if (!settings.pvSurplusOnUrlBackup && previousSettings?.pvSurplusOnUrlBackup) {
        settings.pvSurplusOnUrlBackup = previousSettings.pvSurplusOnUrlBackup;
      }
      if (!settings.pvSurplusOffUrlBackup && previousSettings?.pvSurplusOffUrlBackup) {
        settings.pvSurplusOffUrlBackup = previousSettings.pvSurplusOffUrlBackup;
      }
    }
    
    this.settings = settings;
    this.saveSettingsToFile(settings);
  }

  getControlState(): ControlState {
    // Stelle sicher, dass immer alle Felder vorhanden sind (wichtig für Migration von alten Daten)
    const defaults: ControlState = {
      pvSurplus: false,
      nightCharging: false,
      batteryLock: false,
      gridCharging: false,
    };
    
    return {
      ...defaults,
      ...this.controlState,
    };
  }

  saveControlState(state: ControlState): void {
    this.controlState = state;
    this.saveControlStateToFile(state);
  }

  updateControlState(updates: Partial<ControlState>): void {
    // Atomar: Lese aktuellen State, merge nur die angegebenen Felder, speichere
    this.controlState = {
      ...this.controlState,
      ...updates,
    };
    this.saveControlStateToFile(this.controlState);
  }

  getPlugStatusTracking(): PlugStatusTracking {
    // Defensive Kopie um Race Conditions zu vermeiden
    return { ...this.plugStatusTracking };
  }

  savePlugStatusTracking(tracking: PlugStatusTracking): void {
    this.plugStatusTracking = tracking;
    this.savePlugTrackingToFile(tracking);
  }

  getChargingContext(): ChargingContext {
    return { ...this.chargingContext };
  }

  saveChargingContext(context: ChargingContext): void {
    this.chargingContext = context;
    this.saveChargingContextToFile(context);
  }

  updateChargingContext(updates: Partial<ChargingContext>): void {
    this.chargingContext = {
      ...this.chargingContext,
      ...updates,
    };
    this.saveChargingContextToFile(this.chargingContext);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  addLog(entry: Omit<LogEntry, "id" | "timestamp">): void {
    const logEntry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    
    this.logs.push(logEntry);
    
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  clearLogs(): void {
    this.logs = [];
  }

  getLogSettings(): LogSettings {
    return this.logSettings;
  }

  saveLogSettings(settings: LogSettings): void {
    this.logSettings = settings;
  }
}

export const storage = new MemStorage();
