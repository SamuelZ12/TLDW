# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TLDW (Too Long; Didn't Watch) is a Next.js 15 application that transforms long YouTube videos into topic-driven learning experiences using AI-generated "highlight reels" that identify and extract the most valuable insights scattered across entire video transcripts.

## Key Commands

```bash
npm run dev           # Start development server with Turbopack
npm run build         # Build production bundle with Turbopack
npm start            # Start production server
npm run lint         # Run ESLint on the codebase
```

## Architecture & Structure

### Application Routing

The app uses Next.js 15 App Router with two main pages:

1. **Home Page** (`app/page.tsx`): Landing page with URL input
   - Redirects to `/analyze/[videoId]` when URL is submitted
   - Handles auth redirects and pending video linking after authentication
   - Uses `useSearchParams` to detect `auth=limit` query param for rate limit flows

2. **Analysis Page** (`app/analyze/[videoId]/page.tsx`): Main video analysis interface
   - Dynamic route handling `[videoId]` parameter
   - Page states: `IDLE`, `ANALYZING_NEW`, `LOADING_CACHED`
   - Loading stages: `fetching`, `understanding`, `generating`, `processing`
   - Two-column layout: Left (video player + highlights), Right (tabs for Summary/Chat/Transcript/Notes)

### Core Application Flow

1. User inputs YouTube URL → `components/url-input.tsx`
2. Router navigates to `/analyze/[videoId]` with optional query params (`url`, `cached`)
3. Fetch video info → `app/api/video-info/route.ts` (metadata & thumbnails)
4. Fetch transcript → `app/api/transcript/route.ts` (uses Supadata API)
5. Generate AI content in parallel:
   - Highlight reels → `app/api/generate-topics/route.ts`
   - Video summary → `app/api/generate-summary/route.ts`
   - Suggested questions (background) → `app/api/suggested-questions/route.ts`
6. Display two-column interface:
   - Left: Video player + HighlightsPanel showing topic cards
   - Right: RightColumnTabs with Summary/Chat/Transcript/Notes tabs
7. User interactions:
   - Click topics to play segments
   - Ask questions in AI chat
   - Take notes on transcript selections
   - Explore different theme-based highlights

### API Routes

#### Core Video Processing
- `/api/transcript`: Fetches YouTube transcripts via Supadata API
- `/api/video-info`: Retrieves video metadata (title, author, duration, thumbnail)
- `/api/generate-topics`: Creates highlight reels using Gemini (supports `smart`/`fast` mode + theme selection)
- `/api/generate-summary`: Creates comprehensive video summary using Gemini
- `/api/quick-preview`: Fast topic preview generation
- `/api/top-quotes`: Extracts memorable quotes from transcript

#### AI & Chat
- `/api/chat`: Powers context-aware AI chat with citation extraction
- `/api/suggested-questions`: Generates relevant questions based on video content

#### User Data & Authentication
- `/api/check-limit`: Validates rate limits for authenticated/anonymous users
- `/api/check-video-cache`: Checks if video analysis already exists
- `/api/video-analysis`: Fetches/stores analyzed video data in Supabase
- `/api/update-video-analysis`: Updates existing video analysis
- `/api/toggle-favorite`: Manages user video favorites
- `/api/link-video`: Links video analysis to authenticated user account
- `/api/notes`: CRUD operations for user notes
- `/api/notes/all`: Fetches all notes across all videos for a user
- `/api/csrf-token`: Provides CSRF tokens for secure state-changing requests
- `/api/save-analysis`: Saves complete video analysis to database

### Translation Feature

**Transcript Translation (EN ↔ ID)**
- Toggle button in Transcript Viewer header (next to Auto/Manual toggle)
- Uses OpenAI GPT-4o mini for high-quality translation
- Batch processing: 30 segments per request for optimal performance
- Parallel processing across batches
- Smart caching:
  - Memory cache: Instant toggle between languages within session
  - Database cache: Persistent storage in `translated_transcripts` JSONB column
  - Auto-load cached translations on video revisit
- AI Chat integration: Automatically uses transcript in active language
- Background saving: Non-blocking database updates
- Files: `app/api/translate-transcript/route.ts`, `components/transcript-viewer.tsx`
- Migration: `supabase/migrations/20241027000000_add_translated_transcripts.sql`

### Key Technical Implementation

#### Quote Matching System (`lib/quote-matcher.ts`)
- **Boyer-Moore Search**: Implements efficient substring search algorithm for exact matching
- **N-gram Similarity**: Calculates similarity using 3-gram Jaccard coefficient
- **Transcript Indexing**: Builds comprehensive indices with word positions and n-gram maps
- **Multi-strategy Matching**: Falls back from exact → normalized → fuzzy matching
- **Segment Mapping**: Maps text matches back to precise segment boundaries with character offsets

#### AI Processing with Gemini (`lib/gemini-client.ts`)
- **Model Cascade**: Automatically falls back through `gemini-2.5-flash-lite` → `gemini-2.5-flash` → `gemini-2.5-pro`
- **Structured Output**: Converts Zod schemas to Gemini's schema format for type-safe responses
- **Retry Logic**: Detects overload/rate limit errors (503, 429) and tries next model
- **Timeout Handling**: Optional timeout support with graceful error handling
- **Topic Generation Modes**:
  - `smart`: High-quality analysis with candidate pool for theme-based exploration
  - `fast`: Quick initial highlights without candidate pool

#### Theme-Based Topic Generation
The application supports dynamic topic generation based on user-selected themes:

1. **Initial Analysis** (smart mode):
   - Generate base topics + candidate pool (`topicCandidates`)
   - Extract themes from candidates using keyword clustering
   - Display theme selector with suggested topic themes

2. **Theme Selection Flow**:
   - User clicks theme → Fetch relevant candidates from pool
   - Call `/api/generate-topics` with `excludeTopicKeys` to avoid duplicates
   - Generate 5 new topics fitting the selected theme
   - Cache theme topics in `themeTopicsMap` to avoid re-generation

3. **State Management** (`app/analyze/[videoId]/page.tsx`):
   - `baseTopics`: Initial 5 topics (always available)
   - `themes`: List of available themes extracted from candidates
   - `selectedTheme`: Currently active theme filter
   - `themeTopicsMap`: Cache of generated topics per theme
   - `usedTopicKeys`: Set of candidate keys already used in topics

#### Authentication & Security
- **Supabase Auth**: User authentication with email/password and OAuth providers
- **Rate Limiting**: Different limits for anonymous (3 videos/30 min) vs authenticated users
- **Video Linking**: Post-authentication linking of anonymous analyses to user accounts
- **Favorites System**: Users can favorite and manage their analyzed videos
- **CSRF Protection**: Token-based CSRF validation for state-changing operations (`lib/csrf-protection.ts`)
  - Client-side helper: `csrfFetch` automatically includes CSRF tokens
- **Security Middleware**: Centralized security wrapper for API routes (`lib/security-middleware.ts`)
  - Rate limiting, auth checks, body size limits, security headers
  - Presets: `PUBLIC`, `AUTHENTICATED`, `STRICT`
- **Audit Logging**: Tracks security events, rate limits, and unauthorized access (`lib/audit-logger.ts`)
- **Input Sanitization**: DOMPurify-based sanitization for user input (`lib/sanitizer.ts`)

#### Async Operation Management (`lib/promise-utils.ts`)
- **AbortManager**: Centralized abort controller management with automatic cleanup and timeouts
- **backgroundOperation**: Non-blocking operations that log errors without disrupting UI
- **safePromise**: Returns `[data, error]` tuples for Go-style error handling
- Prevents memory leaks from abandoned requests during navigation/unmount

#### Notes System
Users can create, edit, and manage notes throughout the application:

**Data Model** (`lib/types.ts`):
- `Note`: Core note entity with `id`, `userId`, `videoId`, `source`, `text`, `metadata`
- `NoteSource`: Types include `'chat'`, `'takeaways'`, `'transcript'`, `'custom'`
- `NoteMetadata`: Context about where note originated (transcript position, chat message, selected text)
- `NoteWithVideo`: Extended note with video details for `/all-notes` page

**API Endpoints** (`app/api/notes/route.ts`):
- `GET /api/notes?youtubeId=...`: Fetch notes for specific video
- `POST /api/notes`: Create new note (requires auth)
- `DELETE /api/notes`: Delete note by ID (requires auth)
- `GET /api/notes/all`: Fetch all notes across all videos (requires auth)

**Database Schema** (Supabase table: `notes`):
```sql
notes (
  id: uuid PRIMARY KEY,
  user_id: uuid REFERENCES auth.users,
  video_id: uuid REFERENCES video_analyses,
  source: text,
  source_id: text?,
  text: text,
  metadata: jsonb?,
  created_at: timestamp,
  updated_at: timestamp
)
```

**Client Integration** (`lib/notes-client.ts`):
- All note operations use `csrfFetch` for CSRF protection
- Notes are fetched when video analysis loads
- Real-time note updates sync with UI state

**UI Components**:
- `components/notes-panel.tsx`: Main notes interface in right column tabs
- `components/note-editor.tsx`: Inline note editing with metadata preservation
- `components/selection-actions.tsx`: Context menu for creating notes from text selections
- `app/all-notes/page.tsx`: Dedicated page showing all user notes across videos

### Component Architecture

#### Two-Column Analysis Layout (`app/analyze/[videoId]/page.tsx`)
```
┌─────────────────────────────────────────────────────────┐
│  Video Header (title, author, actions)                  │
├──────────────────────────┬──────────────────────────────┤
│  YouTube Player          │  RightColumnTabs             │
│  (video-player.tsx)      │  ├─ Summary (summary-viewer) │
│                          │  ├─ Chat (ai-chat)           │
│  HighlightsPanel         │  ├─ Transcript (viewer)      │
│  ├─ ThemeSelector        │  └─ Notes (notes-panel)      │
│  └─ Topic Cards          │                              │
└──────────────────────────┴──────────────────────────────┘
```

- **State Management**: React hooks orchestrate the entire flow
  - Page states: `IDLE`, `ANALYZING_NEW`, `LOADING_CACHED`
  - Loading stages: `fetching`, `understanding`, `generating`, `processing`
  - Centralized playback control via `PlaybackCommand` system
  - AbortManager cleanup on unmount to prevent memory leaks

- **Playback System**: Centralized command pattern for video control
  - Commands: `SEEK`, `PLAY_TOPIC`, `PLAY_SEGMENT`, `PLAY`, `PAUSE`, `PLAY_ALL`, `PLAY_CITATIONS`
  - Playback context tracks segment boundaries for auto-pause/advance
  - "Play All" mode chains topics sequentially with automatic transitions

- **Loading States**: Multi-stage loading indicators with progress tracking
  - Shows elapsed time for generation and processing stages
  - Preview generation happens in parallel (non-blocking)

- **YouTube Player**: Custom wrapper supporting auto-play of highlight segments
- **Transcript Viewer**: Synchronized highlighting with video playback
- **AI Chat**: Maintains conversation history with citation highlighting
- **Video Progress Bar**: Visual timeline showing highlight segments
- **Auth Modal**: User authentication/registration flow
- **User Menu**: Account management dropdown
- **Loading Context**: Global loading state management

### TypeScript Types (`lib/types.ts`)
- `TranscriptSegment`: Individual transcript segment with timing
- `Topic`: Highlight reel with segments, quotes, and keywords
  - Includes character offsets (`startCharOffset`, `endCharOffset`) for precise highlighting
  - Optional `isCitationReel` flag for citation playback mode
- `TopicCandidate`: Potential topic from candidate pool with key, title, quote
- `TopicGenerationMode`: Either `'smart'` (with candidates) or `'fast'`
- `VideoInfo`: Video metadata (title, author, thumbnail, duration, description, tags)
- `Citation`: Timestamped reference with precise segment and character offsets
- `ChatMessage`: Chat history with role and citations
- `Note`: User note with source metadata
- `NoteWithVideo`: Note with associated video details
- `PlaybackCommand`: Centralized playback control commands

### Parallel Processing Patterns
The application uses aggressive parallel processing to minimize latency:

1. **Initial Load** (Analysis Page):
   - Transcript fetch + Video metadata fetch (parallel)
   - Quick preview generation (non-blocking background)

2. **Analysis Generation**:
   - Topics generation + Summary generation (parallel using `Promise.allSettled`)
   - Suggested questions generation (background after topics complete)
   - Database save operations (background via `backgroundOperation`)

3. **Cached Videos**:
   - Load all data from cache instantly
   - Generate missing summary in background if needed
   - Update database with new content in background

4. **Theme-Based Topic Generation**:
   - When user selects theme, immediately show loading state
   - Generate new topics while keeping base topics visible
   - Cache results to avoid re-generation on theme re-selection

### Utility Functions (`lib/utils.ts`)
- `extractVideoId()`: Parses YouTube URLs to extract video ID
- `formatDuration()`: Converts seconds to MM:SS format
- `formatTopicDuration()`: Human-readable duration (e.g., "5 min", "1h 30m")
- `getTopicColor()`: Assigns consistent colors to highlight reels
- `getTopicHSLColor()`: Returns HSL color values for dynamic theming
- `cn()`: Tailwind CSS class merging utility

### Database Integration

**Supabase Client**: Browser and server clients for data operations
- `lib/supabase/client.ts`: Browser client using `createBrowserClient`
- `lib/supabase/server.ts`: Server client with cookie-based auth

**Tables**:
- `video_analyses`: Stores complete video analysis
  - Fields: `id`, `youtube_id`, `user_id`, `title`, `author`, `thumbnail_url`, `duration`, `transcript`, `topics`, `summary`, `suggested_questions`, `created_at`, `updated_at`
- `user_favorites`: User's favorited videos
  - Fields: `user_id`, `video_analysis_id`, `created_at`
- `rate_limit_logs`: Tracks API usage for rate limiting
  - Fields: `identifier`, `action`, `timestamp`, `metadata`
- `notes`: User notes on videos
  - Fields: `id`, `user_id`, `video_id`, `source`, `source_id`, `text`, `metadata`, `created_at`, `updated_at`

**Caching Strategy**:
- Check cache before processing (`/api/check-video-cache`)
- Load cached data instantly, generate missing pieces in background
- Anonymous user videos can be linked to account post-auth via `/api/link-video`
- Cache includes `video_analyses` with embedded `topics`, `transcript`, `summary`

**User Data**: Persistent storage of user-specific analysis history and notes

### Development Patterns

#### Error Handling
- Use `backgroundOperation` for non-critical operations (saving to DB, generating suggestions)
- Display user-friendly error messages, log technical details server-side
- Graceful degradation: If summary generation fails, show error but keep topics visible
- Use `safePromise` for predictable error handling without try-catch

#### State Updates
- Batch related state updates together to minimize re-renders
- Use `useCallback` for memoized setters passed to child components
- Clear playback state when switching between modes (topics, citations, play all)
- When changing themes, preserve `baseTopics` in state while loading new theme topics

#### Request Lifecycle
- Create AbortControllers via `AbortManager` for all API requests
- Set appropriate timeouts (10s for metadata, 30s for transcripts, 60s for AI generation)
- Clean up controllers on component unmount or new request
- All state-changing requests must include CSRF tokens via `csrfFetch`

#### Authentication Flow
1. Store `pendingVideoId` in sessionStorage before showing auth modal
2. After auth, check for pending video and link it to user account
3. Retry linking with exponential backoff if video not yet in database
4. Clear `pendingVideoId` from sessionStorage after successful linking

#### Mode Preference Persistence
- User's preferred generation mode (`smart`/`fast`) persisted in localStorage
- Custom hook `useModePreference` provides `mode`, `setMode`, `isLoading`
- Mode selector in URL input updates preference for future analyses

### Environment Variables
Required in `.env.local`:
- `GEMINI_API_KEY`: Google Gemini API key for AI generation
- `OPENAI_API_KEY`: OpenAI API key for transcript translation (GPT-4o mini)
- `SUPADATA_API_KEY`: Supadata API key for transcript fetching
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anonymous key

### Deployment
Optimized for Vercel deployment with Next.js 15 and Turbopack for fast builds and hot module replacement.
