import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment, Topic, ChatMessage, Citation } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function formatTranscriptForContext(segments: TranscriptSegment[]): string {
  return segments.map(s => {
    const mins = Math.floor(s.start / 60);
    const secs = Math.floor(s.start % 60);
    const timestamp = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `[${timestamp}] ${s.text}`;
  }).join('\n');
}

function extractCitations(response: string, transcript: TranscriptSegment[], maxCitations: number = 10): {
  content: string;
  citations: Citation[];
} {
  const citations: Citation[] = [];
  const citationMap = new Map<number, Citation>();
  let processedContent = response;
  
  // First, handle comma-separated timestamps by splitting them
  // Pattern to match [MM:SS, MM:SS, ...] or [MM:SS-MM:SS, MM:SS, ...]
  const commaSeparatedPattern = /\[([^\]]+)\]/g;
  const preprocessedResponse = response.replace(commaSeparatedPattern, (match, content) => {
    // Check if this contains commas (multiple timestamps)
    if (content.includes(',')) {
      // Split by comma and create individual timestamp brackets
      const timestamps = content.split(',').map((t: string) => t.trim());
      return timestamps.map((t: string) => `[${t}]`).join(' ');
    }
    // Return original if no commas
    return match;
  });
  
  // Now extract all timestamps and create citations
  const timestampPattern = /\[(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/g;
  const timestampMatches = Array.from(preprocessedResponse.matchAll(timestampPattern));
  
  // Track citation numbers for each unique timestamp
  const timestampToCitationNumber = new Map<string, number>();
  let citationCounter = 1;
  
  // Limit citations to avoid overwhelming the response
  const limitedMatches = timestampMatches.slice(0, maxCitations);
  
  limitedMatches.forEach(match => {
    const [fullMatch, startTime, endTime] = match;
    const [startMin, startSec] = startTime.split(':').map(Number);
    const startSeconds = startMin * 60 + startSec;
    
    let endSeconds: number | undefined;
    if (endTime) {
      const [endMin, endSec] = endTime.split(':').map(Number);
      endSeconds = endMin * 60 + endSec;
    }
    
    const segment = transcript.find(s => 
      s.start <= startSeconds && (s.start + s.duration) >= startSeconds
    );
    
    if (segment) {
      const timestampKey = `${startSeconds}-${endSeconds || ''}`;
      
      if (!timestampToCitationNumber.has(timestampKey) && citationCounter <= maxCitations) {
        const citationNumber = citationCounter++;
        timestampToCitationNumber.set(timestampKey, citationNumber);
        
        // Extract context around the timestamp from original response
        const originalIndex = response.indexOf(startTime);
        const startIndex = Math.max(0, originalIndex - 150);
        const endIndex = Math.min(response.length, originalIndex + startTime.length + 150);
        const contextText = response.substring(startIndex, endIndex).replace(/\[[^\]]+\]/g, '').trim();
        const words = contextText.split(' ').slice(0, 40).join(' ');
        
        const citation: Citation = {
          timestamp: startSeconds,
          endTime: endSeconds,
          text: segment.text,
          context: words,
          number: citationNumber,
        };
        
        citationMap.set(citationNumber, citation);
        citations.push(citation);
      }
    }
  });
  
  // Replace timestamps with inline citation numbers in the original response
  // First handle comma-separated timestamps
  processedContent = response.replace(commaSeparatedPattern, (match, content) => {
    if (content.includes(',')) {
      const timestamps = content.split(',').map((t: string) => t.trim());
      const citationNumbers: string[] = [];
      
      timestamps.forEach((timestamp: string) => {
        // Parse each timestamp
        const timeMatch = timestamp.match(/(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?/);
        if (timeMatch) {
          const [, startTime, endTime] = timeMatch;
          const [startMin, startSec] = startTime.split(':').map(Number);
          const startSeconds = startMin * 60 + startSec;
          
          let endSeconds: number | undefined;
          if (endTime) {
            const [endMin, endSec] = endTime.split(':').map(Number);
            endSeconds = endMin * 60 + endSec;
          }
          
          const timestampKey = `${startSeconds}-${endSeconds || ''}`;
          const citationNumber = timestampToCitationNumber.get(timestampKey);
          
          if (citationNumber) {
            citationNumbers.push(`[${citationNumber}]`);
          }
        }
      });
      
      return citationNumbers.join(' ');
    }
    
    // Handle single timestamps
    const timeMatch = content.match(/(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?/);
    if (timeMatch) {
      const [, startTime, endTime] = timeMatch;
      const [startMin, startSec] = startTime.split(':').map(Number);
      const startSeconds = startMin * 60 + startSec;
      
      let endSeconds: number | undefined;
      if (endTime) {
        const [endMin, endSec] = endTime.split(':').map(Number);
        endSeconds = endMin * 60 + endSec;
      }
      
      const timestampKey = `${startSeconds}-${endSeconds || ''}`;
      const citationNumber = timestampToCitationNumber.get(timestampKey);
      
      if (citationNumber) {
        return `[${citationNumber}]`;
      }
    }
    
    return '';
  });
  
  // Clean up extra whitespace while preserving newlines for formatting
  // This regex replaces multiple spaces/tabs with single space but keeps newlines
  processedContent = processedContent.replace(/[^\S\n]+/g, ' ').trim();
  
  return { content: processedContent, citations };
}

export async function POST(request: Request) {
  try {
    const { message, transcript, topics, chatHistory, model, targetLanguage = 'en' } = await request.json();

    if (!message || !transcript) {
      return NextResponse.json(
        { error: 'Message and transcript are required' },
        { status: 400 }
      );
    }

    const transcriptContext = formatTranscriptForContext(transcript);
    const topicsContext = topics.map((t: Topic) => 
      `- ${t.title}: ${t.description}`
    ).join('\n');

    const chatHistoryContext = chatHistory?.map((msg: ChatMessage) => 
      `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
    ).join('\n\n') || '';

    const languageInstructions = targetLanguage !== 'en' ? `

IMPORTANT: Respond entirely in ${targetLanguage === 'zh' ? 'Simplified Chinese (简体中文)' : targetLanguage === 'ja' ? 'Japanese (日本語)' : 'English'}. Keep timestamp references in [MM:SS] format.` : '';

    const prompt = `You are a concise AI assistant helping users understand a video transcript.${languageInstructions}

## Video Topics
${topicsContext}

## Video Transcript (with timestamps)
${transcriptContext}

## Previous Conversation
${chatHistoryContext}

## User Question
${message}

## Response Instructions

BE CONCISE AND DIRECT. Get to the point immediately.

### Content Guidelines:
- Answer ONLY from the transcript provided
- Use **bold** for key terms only when essential
- Keep responses short (2-3 paragraphs max)
- Use bullet points for multiple items
- Avoid unnecessary elaboration

### Citation Rules:
- Include ONLY 1-2 most relevant citations per main point
- Use [MM:SS] format for timestamps
- Place citations at the end of statements
- DO NOT over-cite - quality over quantity
- Only cite when it adds real value

### Examples:
Good: "The speaker explains **the main concept** clearly [02:15]."
Bad: "The speaker discusses [01:23] and elaborates [01:45] while also mentioning [02:03] the concept [02:15]."

Focus on giving a clear, direct answer with minimal but meaningful citations.`;

    const selectedModel = model && ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'].includes(model) 
      ? model 
      : 'gemini-2.5-flash';

    const maxOutputTokens = selectedModel === 'gemini-2.0-flash' ? 8192 : 65536;

    const aiModel = genAI.getGenerativeModel({ 
      model: selectedModel,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: Math.min(1024, maxOutputTokens),
      }
    });

    let response = '';
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        const result = await aiModel.generateContent(prompt);
        response = result.response?.text() || '';
        
        if (response) {
          break; // Success, exit retry loop
        }
      } catch (error: any) {
        
        if (retryCount === maxRetries) {
          // Final attempt failed
          const errorMessage = error?.message || 'Unknown error';
          if (errorMessage.includes('429') || errorMessage.includes('quota')) {
            return NextResponse.json({ 
              content: "The AI service is currently at capacity. Please wait a moment and try again.",
              citations: [],
            });
          }
          return NextResponse.json({ 
            content: "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.",
            citations: [],
          });
        }
        
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
        retryCount++;
      }
    }
    
    if (!response) {
      return NextResponse.json({ 
        content: "I couldn't generate a response. Please try rephrasing your question.",
        citations: [],
      });
    }

    const { content, citations } = extractCitations(response, transcript, 6);

    return NextResponse.json({ 
      content,
      citations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate response' },
      { status: 500 }
    );
  }
}