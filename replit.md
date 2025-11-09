# KEBA Wallbox PWA - Entwicklungsleitfaden

## Overview

This Progressive Web App (PWA) controls a KEBA Wallbox charging station for electric vehicles. It provides real-time status monitoring, charge control, and SmartHome integration features. The application enables users to monitor charging status, start/stop charging, and configure automated charging based on PV surplus, night schedules, and battery lockout rules. It adheres to Material Design 3 principles with a mobile-first approach, optimized for German users.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend uses React 18+ with TypeScript, Wouter for routing, TanStack Query for state management, and shadcn/ui (Radix UI primitives) for UI components. Styling is managed with Tailwind CSS, customized with design tokens following Material Design 3 principles. The design is mobile-first, responsive, and uses Roboto typography. Core components include `StatusCard`, `ChargingVisualization`, `ToggleListItem`, and `BottomNav`, structured with Atomic Design. PWA features like manifest configuration and Apple Touch Icons are included for a standalone app experience.

### Backend

The backend is built with Express.js and TypeScript, exposing a RESTful API (`/api` prefix). It features a storage abstraction layer (`IStorage`) with file-based persistence for settings in `data/settings.json`. The backend proxies communication with the KEBA Wallbox and integrates with external SmartHome systems via configurable webhooks.

### Data Storage

Drizzle ORM is configured for PostgreSQL, with schemas defined in `shared/schema.ts` and migrations via `drizzle-kit` using the Neon Serverless PostgreSQL driver. Current implementation uses file-based persistence, storing `WallboxStatus`, `Settings`, and `ControlState` in `data/settings.json` to ensure persistence across server restarts, especially in Docker environments.

### Authentication

Currently, no authentication is implemented, as the application is designed for single-user local network use. Future authentication would likely be minimal for home automation contexts.

### Key Architectural Decisions

1.  **Separation of Concerns**: Shared schema definitions (`shared/`) for type safety across frontend and backend.
2.  **File-based Persistency**: Settings are saved to `data/settings.json` for persistence across server restarts.
3.  **Storage Abstraction**: Interface-based storage design allows flexible persistence strategy changes.
4.  **Mobile-First PWA**: Optimized for touch devices with a standalone app experience.
5.  **Webhook Integration Pattern**: External SmartHome systems are integrated via HTTP callbacks.
6.  **Type Safety**: Zod schemas provide runtime validation and TypeScript types.

## External Dependencies

*   **UI Components**: shadcn/ui (New York style), Radix UI Primitives, Lucide React (icons).
*   **Styling & Build Tools**: Tailwind CSS with PostCSS, Vite, esbuild.
*   **State Management & Data Fetching**: TanStack Query v5, React Hook Form with Zod Resolvers.
*   **Database & ORM**: Drizzle ORM, @neondatabase/serverless (PostgreSQL), drizzle-zod.
*   **SmartHome Integration**: Webhook-based integration (e.g., FHEM) for PV surplus, battery lockout, and night charging. Direct UDP/HTTP API communication with KEBA Wallbox.
*   **Development Tools**: Replit-specific plugins, TypeScript Strict Mode, path aliases (`@/`, `@shared/`, `@assets/`).