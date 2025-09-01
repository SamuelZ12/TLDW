import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic } from '@/lib/types';

interface ParsedTopic {
  title: string;
  description: string;
  quotes?: Array<{
    timestamp: string;
    text: string;
  }>;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function combineTranscript(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}

function formatTranscriptWithTimestamps(segments: TranscriptSegment[]): string {
  return segments.map(s => {
    const startTime = formatTime(s.start);
    const endTime = formatTime(s.start + s.duration);
    return `[${startTime}-${endTime}] ${s.text}`;
  }).join('\n');
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Text normalization utilities
function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ') // Replace newlines with spaces
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim();
}

function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")     // Normalize quotes
    .replace(/[""]/g, '"')     // Normalize double quotes
    .replace(/…/g, '...')      // Normalize ellipsis
    .replace(/—/g, '-')        // Normalize dashes
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
}

// Calculate similarity between two strings (0-1)
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Build a comprehensive index of the transcript
interface TranscriptIndex {
  fullTextSpace: string;
  fullTextNewline: string;
  segmentBoundaries: Array<{
    segmentIdx: number;
    startPos: number;
    endPos: number;
    text: string;
  }>;
}

function buildTranscriptIndex(transcript: TranscriptSegment[]): TranscriptIndex {
  const segmentBoundaries: Array<{
    segmentIdx: number;
    startPos: number;
    endPos: number;
    text: string;
  }> = [];
  
  let fullTextSpace = '';
  let fullTextNewline = '';
  
  transcript.forEach((segment, idx) => {
    if (idx > 0) {
      fullTextSpace += ' ';
      fullTextNewline += '\n';
    }
    
    const segmentStartPos = fullTextSpace.length;
    fullTextSpace += segment.text;
    fullTextNewline += segment.text;
    
    const boundary = {
      segmentIdx: idx,
      startPos: segmentStartPos,
      endPos: fullTextSpace.length,
      text: segment.text
    };
    segmentBoundaries.push(boundary);
    
    // Debug - verify segment indices match
    if (idx >= 40 && idx <= 46) {
    }
  });
  
  return {
    fullTextSpace,
    fullTextNewline,
    segmentBoundaries
  };
}

// Enhanced text matching with multiple strategies
function findTextInTranscript(
  transcript: TranscriptSegment[],
  targetText: string,
  options: {
    startIdx?: number;
    strategy?: 'exact' | 'normalized' | 'fuzzy' | 'all';
    minSimilarity?: number;
    maxSegmentWindow?: number;
  } = {}
): {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
  matchStrategy: string;
  similarity: number;
} | null {
  const {
    startIdx = 0,
    strategy = 'all',
    minSimilarity = 0.85,
    maxSegmentWindow = 30
  } = options;
  
  // Build transcript index for efficient searching
  const index = buildTranscriptIndex(transcript);
  
  // Try different strategies based on option
  const strategies = strategy === 'all' 
    ? ['exact', 'normalized', 'fuzzy']
    : [strategy];
  
  for (const currentStrategy of strategies) {
    
    let searchText = '';
    let targetSearchText = '';
    
    if (currentStrategy === 'exact') {
      // Try both space and newline joined versions
      for (const fullText of [index.fullTextSpace, index.fullTextNewline]) {
        searchText = fullText;
        targetSearchText = targetText;
        
        const matchIdx = searchText.indexOf(targetSearchText);
        if (matchIdx !== -1) {
          const result = mapMatchToSegments(matchIdx, targetSearchText.length, index);
          if (result) {
            return {
              ...result,
              matchStrategy: 'exact',
              similarity: 1.0
            };
          }
        }
      }
    } else if (currentStrategy === 'normalized') {
      // Normalize whitespace and try again
      searchText = normalizeWhitespace(index.fullTextSpace);
      targetSearchText = normalizeWhitespace(targetText);
      
      const matchIdx = searchText.indexOf(targetSearchText);
      if (matchIdx !== -1) {
        // Map back to original positions
        const result = mapNormalizedMatchToSegments(
          matchIdx,
          targetSearchText,
          index,
          targetText
        );
        if (result) {
          return {
            ...result,
            matchStrategy: 'normalized',
            similarity: 0.95
          };
        }
      }
    } else if (currentStrategy === 'fuzzy') {
      // Try fuzzy matching with sliding window
      const normalizedTarget = normalizeForMatching(targetText);
      const targetWords = normalizedTarget.split(' ').filter(w => w.length > 0);
      
      if (targetWords.length === 0) continue;
      
      // Slide through the transcript
      for (let i = startIdx; i < transcript.length; i++) {
        let combinedText = '';
        let segmentSpan: { idx: number; text: string }[] = [];
        
        // Build window
        for (let j = i; j < Math.min(i + maxSegmentWindow, transcript.length); j++) {
          if (combinedText.length > 0) combinedText += ' ';
          combinedText += transcript[j].text;
          segmentSpan.push({ idx: j, text: transcript[j].text });
          
          // Check similarity
          const normalizedCombined = normalizeForMatching(combinedText);
          const similarity = calculateSimilarity(normalizedTarget, normalizedCombined);
          
          if (similarity >= minSimilarity) {
            // Found a fuzzy match
            
            return {
              found: true,
              startSegmentIdx: segmentSpan[0].idx,
              endSegmentIdx: segmentSpan[segmentSpan.length - 1].idx,
              startCharOffset: 0,
              endCharOffset: segmentSpan[segmentSpan.length - 1].text.length,
              matchStrategy: 'fuzzy',
              similarity
            };
          }
          
          // Stop if we've built too much text
          if (combinedText.length > targetText.length * 2) {
            break;
          }
        }
      }
    }
  }
  
  return null;
}

// Map a match position in the full text to segment boundaries
function mapMatchToSegments(
  matchStart: number,
  matchLength: number,
  index: TranscriptIndex
): {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
} | null {
  const matchEnd = matchStart + matchLength;
  let startSegmentIdx = -1;
  let endSegmentIdx = -1;
  let startCharOffset = 0;
  let endCharOffset = 0;
  
  for (const boundary of index.segmentBoundaries) {
    // Find start segment
    if (startSegmentIdx === -1 && matchStart >= boundary.startPos && matchStart < boundary.endPos) {
      startSegmentIdx = boundary.segmentIdx;
      startCharOffset = matchStart - boundary.startPos;
    }
    
    // Find end segment
    if (matchEnd > boundary.startPos && matchEnd <= boundary.endPos) {
      endSegmentIdx = boundary.segmentIdx;
      endCharOffset = matchEnd - boundary.startPos;
      break;
    } else if (matchEnd > boundary.endPos) {
      endSegmentIdx = boundary.segmentIdx;
      endCharOffset = boundary.text.length;
    }
  }
  
  if (startSegmentIdx !== -1 && endSegmentIdx !== -1) {
    return {
      found: true,
      startSegmentIdx,
      endSegmentIdx,
      startCharOffset,
      endCharOffset
    };
  }
  
  return null;
}

// Map normalized match back to original segments
function mapNormalizedMatchToSegments(
  normalizedMatchIdx: number,
  normalizedTargetText: string,
  index: TranscriptIndex,
  originalTargetText: string
): {
  found: boolean;
  startSegmentIdx: number;
  endSegmentIdx: number;
  startCharOffset: number;
  endCharOffset: number;
} | null {
  // Build a mapping between normalized and original positions
  const normalizedFull = normalizeWhitespace(index.fullTextSpace);
  const originalText = index.fullTextSpace;
  
  // Create position mapping arrays
  const normalizedToOriginal: number[] = [];
  let originalIdx = 0;
  let lastOriginalIdx = 0;
  
  // Build the mapping from normalized position to original position
  for (let normIdx = 0; normIdx < normalizedFull.length; normIdx++) {
    // Skip whitespace runs in original text
    while (originalIdx < originalText.length) {
      const origChar = originalText[originalIdx];
      const normChar = normalizedFull[normIdx];
      
      // Check if we've found the corresponding character
      if (origChar === normChar) {
        normalizedToOriginal[normIdx] = originalIdx;
        lastOriginalIdx = originalIdx;
        originalIdx++;
        break;
      } else if (/\s/.test(origChar)) {
        // Skip whitespace in original
        originalIdx++;
      } else {
        // Characters don't match - this shouldn't happen
        normalizedToOriginal[normIdx] = lastOriginalIdx;
        break;
      }
    }
  }
  
  // Find the original start and end positions
  const originalStartPos = normalizedToOriginal[normalizedMatchIdx];
  const normalizedEndIdx = normalizedMatchIdx + normalizedTargetText.length - 1;
  const originalEndPos = normalizedToOriginal[Math.min(normalizedEndIdx, normalizedToOriginal.length - 1)];
  
  if (originalStartPos === undefined || originalEndPos === undefined) {
    return null;
  }
  
  // Calculate the actual length in the original text
  const actualLength = originalEndPos - originalStartPos + 1;
  
  // Now map from original position using the actual matched region
  return mapMatchToSegments(originalStartPos, actualLength, index);
}

function findExactQuotes(
  transcript: TranscriptSegment[],
  quotes: Array<{ timestamp: string; text: string }>
): { 
  start: number; 
  end: number; 
  text: string; 
  startSegmentIdx?: number; 
  endSegmentIdx?: number;
  startCharOffset?: number;
  endCharOffset?: number;
  hasCompleteSentences?: boolean;
}[] {
  const result: { 
    start: number; 
    end: number; 
    text: string; 
    startSegmentIdx?: number; 
    endSegmentIdx?: number;
    startCharOffset?: number;
    endCharOffset?: number;
    hasCompleteSentences?: boolean;
  }[] = [];
  
  for (const quote of quotes) {
    // Parse timestamp if provided
    const timestampMatch = quote.timestamp?.match(/\[?(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\]?/);
    if (!timestampMatch) continue;
    
    const [startMin, startSec] = timestampMatch[1].split(':').map(Number);
    const [endMin, endSec] = timestampMatch[2].split(':').map(Number);
    const timestampStart = startMin * 60 + startSec;
    const timestampEnd = endMin * 60 + endSec;
    
    // Use the exact text from the quote
    const quoteText = quote.text.trim();
    if (!quoteText) continue;
    
    
    // Show first and last parts for debugging
    if (quoteText.length > 100) {
    }
    
    // Try to find text match using multiple strategies
    const match = findTextInTranscript(transcript, quoteText, {
      strategy: 'all',
      minSimilarity: 0.85,
      maxSegmentWindow: 30
    });
    
    if (match) {
      
      // Get the actual timestamps from the segments
      const startSegment = transcript[match.startSegmentIdx];
      const endSegment = transcript[match.endSegmentIdx];
      
      // DEBUG: Verify the segment content
      if (match.startSegmentIdx > 0) {
      }
      
      // Check if the quote actually matches what we found
      const extractedText = startSegment.text.substring(match.startCharOffset);
      const quotePortion = quoteText.substring(0, Math.min(50, extractedText.length));
      if (!extractedText.startsWith(quotePortion.substring(0, 20))) {
      }
      
      result.push({
        start: startSegment.start,
        end: endSegment.start + endSegment.duration,
        text: quoteText,
        startSegmentIdx: match.startSegmentIdx,
        endSegmentIdx: match.endSegmentIdx,
        startCharOffset: match.startCharOffset,
        endCharOffset: match.endCharOffset,
        hasCompleteSentences: match.matchStrategy !== 'fuzzy'
      });
    } else {
      
      // Debug: Show potential issues
      const index = buildTranscriptIndex(transcript);
      const quoteNormalized = normalizeWhitespace(quoteText);
      const transcriptNormalized = normalizeWhitespace(index.fullTextSpace);
      
      // Check if normalized version exists
      if (transcriptNormalized.includes(quoteNormalized)) {
      } else {
        // Check for partial matches
        const quoteWords = quoteNormalized.split(' ').filter(w => w.length > 3);
        const firstWords = quoteWords.slice(0, 5).join(' ');
        const lastWords = quoteWords.slice(-5).join(' ');
        
        if (transcriptNormalized.includes(firstWords)) {
        }
        if (transcriptNormalized.includes(lastWords)) {
        }
      }
      
      
      // Find segments within the timestamp range
      const segmentsInRange: { idx: number; segment: TranscriptSegment }[] = [];
      for (let i = 0; i < transcript.length; i++) {
        const segment = transcript[i];
        const segmentEnd = segment.start + segment.duration;
        
        // Include segments that overlap with timestamp range
        if (segment.start <= timestampEnd && segmentEnd >= timestampStart) {
          segmentsInRange.push({ idx: i, segment });
        }
      }
      
      if (segmentsInRange.length === 0) {
        continue;
      }
      
      // Try to find match within the timestamp range segments
      const startSearchIdx = segmentsInRange[0].idx;
      const endSearchIdx = segmentsInRange[segmentsInRange.length - 1].idx;
      
      // Search within a constrained range with more lenient matching
      let foundInRange = false;
      const rangeMatch = findTextInTranscript(transcript, quoteText, {
        startIdx: Math.max(0, startSearchIdx - 2),
        strategy: 'all',
        minSimilarity: 0.80, // More lenient for timestamp range
        maxSegmentWindow: Math.min(30, endSearchIdx - startSearchIdx + 5)
      });
      
      if (rangeMatch && rangeMatch.startSegmentIdx <= endSearchIdx + 2) {
        
        const startSegment = transcript[rangeMatch.startSegmentIdx];
        const endSegment = transcript[rangeMatch.endSegmentIdx];
        
        result.push({
          start: startSegment.start,
          end: endSegment.start + endSegment.duration,
          text: quoteText,
          startSegmentIdx: rangeMatch.startSegmentIdx,
          endSegmentIdx: rangeMatch.endSegmentIdx,
          startCharOffset: rangeMatch.startCharOffset,
          endCharOffset: rangeMatch.endCharOffset,
          hasCompleteSentences: rangeMatch.matchStrategy !== 'fuzzy'
        });
        foundInRange = true;
      }
      
      if (!foundInRange) {
        // Final fallback: Use timestamp range
        
        const firstSegment = segmentsInRange[0];
        const lastSegment = segmentsInRange[segmentsInRange.length - 1];
        const joinedText = segmentsInRange.map(s => s.segment.text).join(' ');
        
        // Show why matching failed for debugging
        if (quoteText.length > 100 && joinedText.length > 100) {
        }
        
        result.push({
          start: firstSegment.segment.start,
          end: lastSegment.segment.start + lastSegment.segment.duration,
          text: joinedText, // Use the actual joined text from segments
          startSegmentIdx: firstSegment.idx,
          endSegmentIdx: lastSegment.idx,
          startCharOffset: 0,
          endCharOffset: lastSegment.segment.text.length,
          hasCompleteSentences: false
        });
      }
    }
  }
  
  return result;
}

export async function POST(request: Request) {
  try {
    const { transcript, model = 'gemini-2.5-flash', targetLanguage = 'en' } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Valid transcript is required' },
        { status: 400 }
      );
    }
    
    // Validate model
    const validModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'];
    if (!validModels.includes(model)) {
      return NextResponse.json(
        { error: 'Invalid model specified' },
        { status: 400 }
      );
    }

    const fullText = combineTranscript(transcript);
    
    // Log a sample of the transcript to help with debugging
    
    // Debug segments around index 40-46
    for (let i = 40; i <= 46 && i < transcript.length; i++) {
    }
    
    const transcriptWithTimestamps = formatTranscriptWithTimestamps(transcript);

    const languageInstructions = targetLanguage !== 'en' ? `

## Language Requirements
IMPORTANT: Generate all titles and descriptions in ${targetLanguage === 'zh' ? 'Simplified Chinese (简体中文)' : targetLanguage === 'ja' ? 'Japanese (日本語)' : 'English'}. 
- Translate the "title" field to the target language
- Keep the "text" field in the original English (as it must match the transcript exactly)
- Make titles culturally appropriate and natural-sounding in the target language` : '';

    const prompt = `## Role and Goal
You are an expert content strategist. Your goal is to analyze the provided video transcript and description to create 5 distinct "highlight reels." Each reel will focus on a single, powerful theme, supported by direct quotes from the speaker. The final output should allow a busy, intelligent viewer to absorb the video's most valuable insights in minutes.${languageInstructions}

## Target Audience
Your audience is forward-thinking and curious. They have a short attention span and are looking for contrarian insights, actionable mental models, and bold predictions, not generic advice.

## Your Task

### Step 1: Identify 5 Core Themes
Analyze the entire transcript to identify 5 key themes that are most valuable and thought-provoking.

**Theme/Title Criteria:**
- **Insightful:** It must challenge a common assumption or reframe a known concept.
- **Specific:** Avoid vague titles.
- **Format:** Must be a complete sentence or a question.
- **Concise:** Maximum of 10 words.
- **Synthesized:** The theme should connect ideas from different parts of the talk, not just one section.

### Step 2: Select Supporting Passages
For each theme, select 1 to 5 direct passages from the transcript that powerfully illustrate the core idea.

**CRITICAL Passage Selection Criteria:**
- **EXACT VERBATIM QUOTES:** You MUST copy the text EXACTLY as it appears in the transcript. This means:
  - DO NOT fix grammar mistakes (keep "gonna" not "going to")
  - DO NOT fix spelling errors or typos
  - DO NOT clean up incomplete sentences or fragments
  - DO NOT add or remove punctuation
  - DO NOT change capitalization
  - DO NOT normalize spaces or formatting
  - DO NOT use ellipsis (...) to skip parts
  - The text must be a CONTINUOUS passage from the transcript
- **CHARACTER-PERFECT ACCURACY:** Your quote text MUST be found as an exact substring in the transcript. We will search for it using string.indexOf() - if it returns -1, your quote is wrong.
- **LENGTH REQUIREMENT:** Each passage MUST be substantial enough to convey a complete thought or idea. Minimum 15-30 seconds of content. Short fragments are unacceptable.
- **Complete Thoughts:** ALWAYS extend the timestamp range to capture the FULL idea being expressed. Include the entire explanation, example, or argument - not just a fragment.
- **Self-Contained:** Each passage must be fully understandable on its own. If the speaker references something earlier, extend the passage backward to include that context.
- **Natural Boundaries:** Extend timestamps to natural speech breaks - complete sentences, paragraph ends, or topic transitions. NEVER cut off mid-sentence or mid-thought.
- **High-Signal:** Choose passages that contain memorable stories, bold predictions, data points, specific examples, or contrarian thinking. Avoid generic statements.
- **No Fluff:** While passages should be complete, avoid including unrelated tangents or off-topic rambling.
- **Avoid Redundancy:** Within a single reel, ensure each selected passage offers a unique angle on the theme.
- **Chronological:** Within each reel, list the passages in the order they appear in the video.

**Examples of EXACT copying:**
If the transcript says: "so um basically what we're gonna do is uh we're gonna like optimize the the system"
❌ BAD: "So basically what we're going to do is optimize the system"
✅ GOOD: "so um basically what we're gonna do is uh we're gonna like optimize the the system"

If the transcript says: "The problem with traditional education   is that it doesn't prepare"
❌ BAD: "The problem with traditional education is that it doesn't prepare"
✅ GOOD: "The problem with traditional education   is that it doesn't prepare" (keep extra spaces)

IMPORTANT: Copy EXACTLY what you see between the timestamp brackets, character for character!

## Quality Control
- **Distinct Themes:** Each highlight reel's title must represent a clearly distinct theme. While themes can be related, their core ideas should be unique.
- **Value Over Quantity:** If you can only identify 3-4 high-quality, distinct themes, deliver that number. Do not force generic themes to meet the count of 5.
- **Passage Completeness Check:** Before finalizing, verify each passage contains a COMPLETE thought that can stand alone. If it references something not included, extend the timestamp range.

## Output Format
You must return a JSON array with this EXACT structure:
[
  {
    "title": "Complete sentence or question",
    "quotes": [
      {
        "timestamp": "[MM:SS-MM:SS]",
        "text": "EXACT verbatim text from transcript - must be a perfect character-by-character match"
      }
    ]
  }
]

IMPORTANT: The "text" field MUST contain the exact text as it appears in the transcript. Do not clean up, correct, or modify the text in any way.

## Video Transcript (with timestamps)
${transcriptWithTimestamps}

`;
    
    

    
    const geminiModel = genAI.getGenerativeModel({ 
      model: model,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
      }
    });

    const result = await geminiModel.generateContent(prompt);
    const response = result.response.text();
    
    if (!response) {
      throw new Error('No response from Gemini');
    }

    
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(response);
    } catch (parseError) {
      
      // Try to extract JSON array from the response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } catch (e) {
          // Create a fallback response
          parsedResponse = [{
            title: "Full Video",
            description: "Complete video content",
            quotes: [{
              timestamp: "[00:00-00:30]",
              text: fullText.substring(0, 200)
            }]
          }];
        }
      } else {
        // Create a fallback response
        parsedResponse = [{
          title: "Full Video",
          description: "Complete video content",
          quotes: [{
            timestamp: "[00:00-00:30]",
            text: fullText.substring(0, 200)
          }]
        }];
      }
    }
    
    
    // Handle different possible response structures
    let topicsArray = parsedResponse;
    if (parsedResponse.topics && Array.isArray(parsedResponse.topics)) {
      topicsArray = parsedResponse.topics;
    } else if (parsedResponse.themes && Array.isArray(parsedResponse.themes)) {
      topicsArray = parsedResponse.themes;
    } else if (!Array.isArray(parsedResponse)) {
      throw new Error('Invalid response format from Gemini - not an array');
    }
    
    // If we got an empty array, create a basic structure
    if (topicsArray.length === 0) {
      
      // Create basic topics based on transcript chunks
      const chunkSize = Math.ceil(transcript.length / 3);
      topicsArray = [];
      
      for (let i = 0; i < 3 && i * chunkSize < transcript.length; i++) {
        const startIdx = i * chunkSize;
        const endIdx = Math.min((i + 1) * chunkSize, transcript.length);
        const chunkSegments = transcript.slice(startIdx, endIdx);
        
        if (chunkSegments.length > 0) {
          const startTime = chunkSegments[0].start;
          const endTime = chunkSegments[chunkSegments.length - 1].start + chunkSegments[chunkSegments.length - 1].duration;
          
          topicsArray.push({
            title: `Part ${i + 1}`,
            description: `Section ${i + 1} of the video`,
            quotes: [{
              timestamp: `[${formatTime(startTime)}-${formatTime(endTime)}]`,
              text: chunkSegments.map(s => s.text).join(' ').substring(0, 200) + '...'
            }]
          });
        }
      }
    }
    
    
    // Validate that topics have required fields
    topicsArray.forEach((topic: ParsedTopic, index: number) => {
      console.log({
        title: topic.title,
        hasQuotes: !!topic.quotes,
        quoteCount: topic.quotes ? topic.quotes.length : 0
      });
    });

    // Generate topics with segments from quotes
    const topicsWithSegments = topicsArray.map((topic: ParsedTopic, index: number) => {
      
      // Pass the quotes directly to findExactQuotes
      const quotesArray = topic.quotes && Array.isArray(topic.quotes) ? topic.quotes : [];
      
      
      // Find the exact segments for these quotes
      const segments = findExactQuotes(transcript, quotesArray);
      const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
      
      
      return {
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description || '',
        duration: Math.round(totalDuration),
        segments: segments,
        quotes: topic.quotes // Store original quotes for display
      };
    });
    
    // Keep all topics, even those without segments (they can still be displayed)
    const topics = topicsWithSegments.length > 0 ? topicsWithSegments : 
      topicsArray.map((topic: ParsedTopic, index: number) => ({
        id: `topic-${index}`,
        title: topic.title,
        description: topic.description || '',
        duration: 0,
        segments: [],
        quotes: topic.quotes || []
      }));
    

    return NextResponse.json({ topics });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate topics' },
      { status: 500 }
    );
  }
}