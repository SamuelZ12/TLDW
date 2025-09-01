import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(request: Request) {
  try {
    const { text, targetLanguage, model = 'gemini-2.5-flash' } = await request.json();

    if (!text || !targetLanguage) {
      return NextResponse.json(
        { error: 'Text and target language are required' },
        { status: 400 }
      );
    }

    // Don't translate if already in target language (English to English)
    if (targetLanguage === 'en') {
      return NextResponse.json({ translation: text });
    }

    const languageName = targetLanguage === 'zh' ? 'Simplified Chinese' : 
                        targetLanguage === 'ja' ? 'Japanese' : 
                        'English';

    const prompt = `Translate the following text to ${languageName}. 
Maintain the original meaning and tone. 
Keep any technical terms accurate.
Do not add any explanations or notes, just provide the translation.

Text to translate:
${text}

Translation:`;

    const selectedModel = model && ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'].includes(model) 
      ? model 
      : 'gemini-2.5-flash-lite';

    const aiModel = genAI.getGenerativeModel({ 
      model: selectedModel,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      }
    });

    const result = await aiModel.generateContent(prompt);
    const translation = result.response?.text() || text;

    return NextResponse.json({ translation });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json(
      { error: 'Failed to translate text' },
      { status: 500 }
    );
  }
}