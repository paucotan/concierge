# CLAUDE.md — Concierge macOS Menu Bar Center

This is the developer guide for the Tauri + TypeScript menu bar helper utility.

## Build & Test Commands

- **Run in Dev Mode**: `npm run tauri dev`
- **Build App Bundle**: `npm run tauri build`
- **Frontend Only Dev**: `npm run dev`
- **Typecheck**: `npm run build` (runs `tsc`)
- **Run actual test suite** (if any): `cd src-tauri && cargo test`

## Architecture & Code Guidelines

- **Tauri Commands**: Defined in `src-tauri/src/lib.rs` and invoked in frontend `src/main.ts`.
- **Budgeting Subfolder**: Contains the backend node scripting suite under `budgeting/`.
- **Styling**: Tailwind CSS v4.
- **Window Sizing**: Responsive to content height. Runs `resizeToContent` on state changes or window focus.
