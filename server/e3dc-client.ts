import { exec } from 'child_process';
import { promisify } from 'util';
import type { E3dcConfig } from '@shared/schema';

const execAsync = promisify(exec);

class E3dcClient {
  private config: E3dcConfig | null = null;
  private lastCommandTime: number = 0;
  private readonly RATE_LIMIT_MS = 5000; // 5 Sekunden zwischen Befehlen

  configure(config: E3dcConfig): void {
    if (!config.enabled) {
      throw new Error('E3DC not enabled');
    }
    this.config = config;
  }

  disconnect(): void {
    this.config = null;
  }

  private sanitizeOutput(value: string, command: string, extraSecrets: string[]): string {
    let sanitized = value;

    sanitized = sanitized.replace(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[COMMAND REDACTED]');

    const sensitivePatterns = [
      /--password[=\s]+\S+/gi,
      /--pass[=\s]+\S+/gi,
      /--token[=\s]+\S+/gi,
      /--auth[=\s]+\S+/gi,
      /--apikey[=\s]+\S+/gi,
      /--api-key[=\s]+\S+/gi,
      /--secret[=\s]+\S+/gi,
      /-p[=\s]+\S+/gi,
      /\b(password|pass|token|auth|apikey|api-key|secret|key)[=:]\S+/gi,
    ];

    sensitivePatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    });

    extraSecrets.forEach(secret => {
      if (secret && secret.trim() !== '') {
        sanitized = sanitized.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
      }
    });

    return sanitized;
  }

  private getSensitiveValues(): string[] {
    if (!this.config) return [];
    
    const values: string[] = [];
    
    if (this.config.dischargeLockEnableCommand) {
      values.push(this.config.dischargeLockEnableCommand);
    }
    if (this.config.dischargeLockDisableCommand) {
      values.push(this.config.dischargeLockDisableCommand);
    }
    if (this.config.gridChargeEnableCommand) {
      values.push(this.config.gridChargeEnableCommand);
    }
    if (this.config.gridChargeDisableCommand) {
      values.push(this.config.gridChargeDisableCommand);
    }
    
    return values;
  }

  private async executeCommand(command: string | undefined, commandName: string): Promise<void> {
    if (!command || command.trim() === '') {
      console.log(`[E3DC] ${commandName} - Kein Befehl konfiguriert, überspringe`);
      return;
    }

    // Rate Limiting: Warten wenn letzter Befehl weniger als 5 Sekunden her ist
    const now = Date.now();
    const timeSinceLastCommand = now - this.lastCommandTime;
    
    if (this.lastCommandTime > 0 && timeSinceLastCommand < this.RATE_LIMIT_MS) {
      const waitTime = this.RATE_LIMIT_MS - timeSinceLastCommand;
      console.log(`[E3DC] Rate Limiting: Warte ${(waitTime / 1000).toFixed(1)}s vor nächstem Befehl`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const isDevelopment = process.env.NODE_ENV !== 'production';
    const sensitiveValues = this.getSensitiveValues();

    try {
      console.log(`[E3DC] Führe aus: ${commandName}`);
      
      const { stdout, stderr } = await execAsync(command);
      
      if (isDevelopment) {
        if (stdout) {
          const sanitized = this.sanitizeOutput(stdout, command, sensitiveValues);
          console.log(`[E3DC] ${commandName} - Ausgabe [sanitized preview ${stdout.length} chars]:`, sanitized.slice(0, 200));
        }
        if (stderr) {
          const sanitized = this.sanitizeOutput(stderr, command, sensitiveValues);
          console.error(`[E3DC] ${commandName} - Fehler-Ausgabe [sanitized preview ${stderr.length} chars]:`, sanitized.slice(0, 200));
        }
      } else {
        if (stdout) {
          console.log(`[E3DC] ${commandName} - Ausgabe erhalten (${stdout.length} Zeichen)`);
        }
        if (stderr) {
          console.error(`[E3DC] ${commandName} - Fehler-Ausgabe erhalten (${stderr.length} Zeichen)`);
        }
      }
      
      // Zeitpunkt des letzten Befehls aktualisieren
      this.lastCommandTime = Date.now();
      console.log(`[E3DC] ${commandName} erfolgreich ausgeführt`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const sanitizedError = this.sanitizeOutput(errorMessage, command, sensitiveValues);
      
      if (isDevelopment) {
        console.error(`[E3DC] ${commandName} fehlgeschlagen:`, sanitizedError.slice(0, 200));
      } else {
        console.error(`[E3DC] Befehlsausführung fehlgeschlagen für: ${commandName}`);
      }
      throw new Error(`Failed to execute ${commandName}`);
    }
  }

  async lockDischarge(): Promise<void> {
    if (!this.config) {
      throw new Error('E3DC not configured');
    }
    await this.executeCommand(this.config.dischargeLockEnableCommand, 'Entladesperre aktivieren');
  }

  async unlockDischarge(): Promise<void> {
    if (!this.config) {
      throw new Error('E3DC not configured');
    }
    await this.executeCommand(this.config.dischargeLockDisableCommand, 'Entladesperre deaktivieren');
  }

  async enableGridCharge(): Promise<void> {
    if (!this.config) {
      throw new Error('E3DC not configured');
    }
    await this.executeCommand(this.config.gridChargeEnableCommand, 'Netzstrom-Laden aktivieren');
  }

  async disableGridCharge(): Promise<void> {
    if (!this.config) {
      throw new Error('E3DC not configured');
    }
    await this.executeCommand(this.config.gridChargeDisableCommand, 'Netzstrom-Laden deaktivieren');
  }

  isConfigured(): boolean {
    return this.config !== null && this.config.enabled === true;
  }

  isGridChargeDuringNightChargingEnabled(): boolean {
    return this.config?.gridChargeDuringNightCharging === true;
  }
}

export const e3dcClient = new E3dcClient();
