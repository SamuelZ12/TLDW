# Translation MVP Plan

**Goal:** Get English→Chinese translation working quickly with a maintainable foundation.

## MVP Implementation Strategy

**Phase 1: Core Infrastructure (Tasks 1-3)**
- Google Translate API client with clean interface
- Minimal type extensions that don't break existing code
- Single translation endpoint for on-demand requests

**Phase 2: UI Integration (Tasks 4-6)**
- Simple toggle in video header
- Transcript viewer showing alternating original/translated lines
- Topic titles display translations when enabled

**Phase 3: Testing (Task 7)**
- Verify translation accuracy and UI functionality

## Architecture Decisions for MVP

**Maintainable Choices:**
- Abstract translation interface (easy to swap providers later)
- Client-side state management (no DB changes needed for MVP)
- Modular components that can be extended
- Clear separation of translation logic in `lib/translation/`

**MVP Constraints:**
- English→Chinese only (hardcoded)
- On-demand translation (no caching initially)
- Memory-only storage (no persistence)
- Simple toggle UI (no language selection)

**Future Extension Points:**
- Translation provider interface → multiple services
- Language detection placeholder → auto-detect
- Memory storage → database persistence
- Simple toggle → full language preferences

This gets translation working fast while making future enhancements straightforward.

## Task List

1. **Create basic translation client with Google Translate API**
2. **Add minimal translation types to existing interfaces**
3. **Create translation API endpoint**
4. **Add translation toggle to video header**
5. **Update transcript viewer for alternating display**
6. **Update topic titles to show translations**
7. **Test MVP functionality**