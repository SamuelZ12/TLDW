import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { TranscriptSegment } from '@/lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(request: Request) {
  try {
    const { transcript, videoTitle, targetLanguage = 'en' } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json(
        { error: 'Transcript is required' },
        { status: 400 }
      );
    }

    // Take first ~30 seconds or 500 words of transcript for quick preview
    let previewText = '';
    let wordCount = 0;
    const maxWords = 500;
    const maxTime = 30; // seconds

    for (const segment of transcript as TranscriptSegment[]) {
      if (segment.start > maxTime) break;
      
      const words = segment.text.split(' ');
      if (wordCount + words.length > maxWords) {
        const remainingWords = maxWords - wordCount;
        previewText += ' ' + words.slice(0, remainingWords).join(' ');
        break;
      }
      
      previewText += ' ' + segment.text;
      wordCount += words.length;
    }

    if (!previewText.trim()) {
      return NextResponse.json({ 
        preview: 'Processing video content...' 
      });
    }

    const languageInstructions = targetLanguage !== 'en' ? `
IMPORTANT: Write the overview in ${targetLanguage === 'zh' ? 'Simplified Chinese' : targetLanguage === 'ja' ? 'Japanese' : 'English'}.` : '';

    const prompt = `Based on the beginning of this video transcript${videoTitle ? ` titled "${videoTitle}"` : ''}, write a brief 2-3 sentence overview of what this video appears to be about. Focus on the main topic and what viewers can expect to learn. Be concise and engaging.${languageInstructions}

Transcript excerpt:
${previewText}

Write the overview in 2-3 sentences:`;

    try {
      // Use the faster Flash model for quick response
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(prompt);
      const preview = result.response.text().trim();

      return NextResponse.json({ preview });
    } catch (aiError) {
      // Fallback to a generic message
      return NextResponse.json({ 
        preview: videoTitle 
          ? `Analyzing "${videoTitle}" to identify key insights and themes...`
          : 'Analyzing video content to identify key insights and themes...'
      });
    }

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate preview' },
      { status: 500 }
    );
  }
}