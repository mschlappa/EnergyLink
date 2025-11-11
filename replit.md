# EnergyLink - Entwicklungsleitfaden

## Overview

EnergyLink is a Progressive Web App (PWA) that controls a KEBA Wallbox charging station for electric vehicles. It provides real-time status monitoring, charge control, and SmartHome integration features. The application enables users to monitor charging status, start/stop charging, and configure automated charging based on PV surplus, night schedules, and battery lockout rules. **Now includes E3DC integration via CLI tool (e3dcset) for battery discharge control and grid charging during night charging intervals.** It adheres to Material Design 3 principles with a mobile-first approach, optimized for German users.

**Latest Update (Nov 2025):** 
- App umbenannt in "EnergyLink" - alle Meta-Tags, PWA-Manifest und Dokumentation aktualisiert
- Neues Favicon mit grünem EV-Lade-Icon (Auto + Sonne + Blitz) in allen erforderlichen Größen
- "Letztes Update" Anzeige auf Statusseite: zeigt Wallbox-Polling-Zeitstempel mit absoluter Zeit und intelligenter relativer Zeitangabe (Sekunden/Minuten/Stunden/Tage), linksbündig ausgerichtet
- Kabelstatus-Tracking vom Frontend ins Backend migriert für persistentes Tracking
- E3DC Integration reorganisiert mit Prefix-Feld für CLI-Tool-Pfad
- **E3DC Modbus TCP Integration (Phase 2 abgeschlossen):** Backend-Integration mit modbus-serial Library vollständig implementiert. Neuer API-Endpoint `/api/e3dc/live-data` liest E3DC S10 Register über Modbus TCP (Port 502): PV-Leistung, Batterie-Leistung/SOC, Hausverbrauch, Netzleistung, Autarkie, Eigenverbrauch. Wallbox-Leistung wird zusätzlich via UDP Report 3 abgefragt. Frontend zeigt Live-Daten mit 5-Sekunden Auto-Refresh. Connection Recovery: Bei Modbus-Fehlern wird Verbindung automatisch geschlossen und beim nächsten Request neu aufgebaut. Register-Offsets: 66, 68, 70, 72, 81, 82, 83 (40001-Basis abgezogen). E3DC IP-Adresse in Settings konfigurierbar. **Wartet auf E3DC S10 Hardware-Test zur Validierung der Register-Adressen.**

## User Preferences

Preferred communication style: Simple, everyday language.

**Deployment Target:** Local operation (home server/Raspberry Pi/Docker) in private network. Application communicates via HTTP in development; HTTPS not required for local-only deployment but recommended if accessible from internet.

## System Architecture

### Frontend

The frontend uses React 18+ with TypeScript, Wouter for routing, TanStack Query for state management, and shadcn/ui (Radix UI primitives) for UI components. Styling is managed with Tailwind CSS, customized with design tokens following Material Design 3 principles. The design is mobile-first, responsive, and uses Roboto typography. Core components include `StatusCard`, `ChargingVisualization`, `EnergyFlowDiagram`, and `BottomNav`, structured with Atomic Design. **SmartHome control toggles are integrated directly into the Settings page: PV surplus control is always available, while battery lock and grid charging controls appear only when E3DC integration is enabled. Night charging is controlled exclusively via the automatic scheduler configuration. Wallbox and E3DC IP address fields are positioned at the top of settings for immediate visibility.** PWA features like manifest configuration and Apple Touch Icons are included for a standalone app experience. **The StatusCard component on the main page displays contextual status icons (Sun, Moon, ShieldOff, PlugZap) indicating active SmartHome features. Icons for battery lock and grid charging only appear when E3DC is enabled. The cable status card includes an interactive drawer showing current status and last change timestamp retrieved from backend tracking.** **The E3DC page (accessible via dedicated BottomNav tab) displays an energy flow diagram showing real-time power flows between PV, battery, house, wallbox, and grid, plus efficiency metrics (autarky, self-consumption). Uses live data from `/api/e3dc/live-data` endpoint with 5-second auto-refresh. Four frontend states: Settings loading (skeleton), E3DC IP not configured (hint card), connection error (retry button), success (live data). All interactive elements instrumented with data-testid attributes.**

### Backend

The backend is built with Express.js and TypeScript, exposing a RESTful API (`/api` prefix). It features a storage abstraction layer (`IStorage`) with file-based persistence for settings in `data/settings.json`. The backend proxies communication with the KEBA Wallbox and integrates with external SmartHome systems via configurable webhooks. 

**E3DC integration uses two approaches:**
1. **CLI Tool (e3dcset):** Battery discharge lock control and grid charging functionality via command-line execution. Commands are composed by concatenating a user-configurable prefix (CLI tool path + config) with command-specific parameters, ensuring proper spacing. All CLI outputs are sanitized before logging to prevent credential leakage.
2. **Modbus TCP (modbus-serial):** Real-time energy monitoring via direct Modbus TCP connection (Port 502). Reads 7 registers from E3DC S10: PV power, battery power/SOC, house consumption, grid power, autarky, self-consumption. Singleton-based service with automatic connection recovery on failures. INT32/UINT16 Big-Endian conversion. 5-second timeout.

The backend automatically tracks cable status changes during wallbox polling, storing timestamps in `data/plug-tracking.json` - only valid status values trigger updates to prevent corruption during UDP timeouts.

### Data Storage

Drizzle ORM is configured for PostgreSQL, with schemas defined in `shared/schema.ts` and migrations via `drizzle-kit` using the Neon Serverless PostgreSQL driver. Current implementation uses file-based persistence, storing `WallboxStatus`, `Settings`, `ControlState`, and `PlugStatusTracking` in separate JSON files to ensure persistence across server restarts, especially in Docker environments. **The ControlState schema includes four boolean flags: `pvSurplus`, `nightCharging`, `batteryLock`, and `gridCharging`. The `nightCharging` flag is read-only and controlled exclusively by the automatic scheduler - manual changes via API are rejected. The E3dcConfig schema includes an optional `prefix` field for the CLI tool path and configuration, plus four command fields for battery lock/unlock and grid charge enable/disable parameters. The PlugStatusTracking schema stores cable connection history with `lastPlugStatus` (number) and optional `lastPlugChange` (ISO timestamp). The E3dcLiveData schema defines live energy monitoring data: PV power, battery power/SOC, house consumption, grid power, wallbox power, autarky, self-consumption, timestamp. The storage layer ensures backward compatibility by backfilling missing fields with default values when retrieving state.**

### Authentication

Currently, no authentication is implemented, as the application is designed for single-user local network use. Future authentication would likely be minimal for home automation contexts.

### Key Architectural Decisions

1.  **Separation of Concerns**: Shared schema definitions (`shared/`) for type safety across frontend and backend.
2.  **File-based Persistency**: Settings are saved to `data/settings.json`, control state to `data/control-state.json`, and plug tracking to `data/plug-tracking.json` for persistence across server restarts.
3.  **Storage Abstraction**: Interface-based storage design allows flexible persistence strategy changes with backward compatibility via default value backfilling.
4.  **Mobile-First PWA**: Optimized for touch devices with a standalone app experience.
5.  **Webhook Integration Pattern**: External SmartHome systems are integrated via HTTP callbacks for PV surplus control.
6.  **E3DC-Only Battery Control**: Battery discharge locking and grid charging are exclusively managed via E3DC CLI integration (e3dcset). UI conditionally displays these controls only when E3DC is enabled, ensuring users cannot attempt unsupported operations. E3DC commands use a prefix-parameter architecture to avoid repetition of tool path and configuration across multiple command fields.
7.  **Type Safety**: Zod schemas provide runtime validation and TypeScript types.
8.  **Security-First Logging**: CLI outputs are sanitized to prevent credential leakage - development mode shows sanitized previews (200 chars), production mode shows only metadata. HTTP request logs are controlled by log level setting (only appear in debug mode).
9.  **Visual Status Feedback**: Icon-based status indicators on the main screen provide immediate visual feedback for active SmartHome features, improving user awareness.
10. **Fixed Timezone**: Application uses Europe/Berlin (MEZ/MESZ) timezone for all time-based operations including night charging scheduler. No user configuration required.
11. **Auto-Save with Form Hydration Guards**: Scheduler toggle implements immediate auto-save with robust guards (`formHydratedRef`) to prevent race conditions and data corruption. Settings are never saved until form is fully hydrated with server data.
12. **Optimistic UI with Refetch-on-Mount**: StatusPage uses `refetchOnMount: true` for settings query to ensure Moon icon always reflects current scheduler state after navigation from settings.
13. **Backend-Driven Status Tracking**: Cable status change detection moved from frontend to backend - wallbox polling automatically detects and persists status changes with validation guards against UDP timeouts/malformed responses.
14. **Settings Page Organization**: Wallbox IP address field positioned at top of settings page for immediate access. E3DC Integration section uses accordion pattern with streamlined command configuration via prefix field. Night charging scheduler visible inline with toggle control.

## External Dependencies

*   **UI Components**: shadcn/ui (New York style), Radix UI Primitives, Lucide React (icons).
*   **Styling & Build Tools**: Tailwind CSS with PostCSS, Vite, esbuild.
*   **State Management & Data Fetching**: TanStack Query v5, React Hook Form with Zod Resolvers.
*   **Database & ORM**: Drizzle ORM, @neondatabase/serverless (PostgreSQL), drizzle-zod.
*   **SmartHome Integration**: 
    *   **E3DC**: 
        - CLI integration via e3dcset tool for battery discharge lock and grid charging control (prefix-parameter command composition)
        - Modbus TCP integration via modbus-serial library for real-time energy monitoring (Port 502, registers 66-83)
    *   **FHEM**: Webhook-based integration for PV surplus control
    *   **KEBA Wallbox**: Direct UDP/HTTP API communication
*   **Development Tools**: Replit-specific plugins, TypeScript Strict Mode, path aliases (`@/`, `@shared/`, `@assets/`).