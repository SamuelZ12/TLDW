"use client";

import { useState, useRef, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChatMessage, TranscriptSegment, Topic } from "@/lib/types";
import { ChatMessageComponent } from "./chat-message";
import { SuggestedQuestions } from "./suggested-questions";
import { ModelSelector, type GeminiModel } from "./model-selector";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Send, Loader2, MessageSquare } from "lucide-react";

interface AIChatProps {
  transcript: TranscriptSegment[];
  topics: Topic[];
  videoId: string;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string) => void;
}

export function AIChat({ transcript, topics, videoId, onTimestampClick }: AIChatProps) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [selectedModel, setSelectedModel] = useState<GeminiModel>('gemini-2.5-flash');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (transcript.length > 0 && suggestedQuestions.length === 0) {
      fetchSuggestedQuestions();
    }
  }, [transcript]);

  useEffect(() => {
    const savedModel = localStorage.getItem('selectedChatModel');
    if (savedModel && ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'].includes(savedModel)) {
      setSelectedModel(savedModel as GeminiModel);
    }
  }, []);

  const handleModelChange = (model: GeminiModel) => {
    setSelectedModel(model);
    localStorage.setItem('selectedChatModel', model);
  };

  const fetchSuggestedQuestions = async () => {
    setLoadingQuestions(true);
    try {
      const response = await fetch("/api/suggested-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, topics }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setSuggestedQuestions(data.questions || []);
      }
    } catch (error) {
    } finally {
      setLoadingQuestions(false);
    }
  };

  const sendMessage = async (messageText?: string, retryCount = 0) => {
    const text = messageText || input.trim();
    if (!text || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    // Only add user message on first attempt
    if (retryCount === 0) {
      setMessages(prev => [...prev, userMessage]);
      setInput("");
    }
    setIsLoading(true);

    try {
      // Add timeout controller
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          transcript,
          topics,
          videoId,
          chatHistory: messages,
          model: selectedModel,
          targetLanguage: locale,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Check if it's a rate limit or temporary error
        if (response.status === 429 || response.status === 503) {
          throw new Error("Service temporarily unavailable");
        }
        throw new Error(`Failed to get response (${response.status})`);
      }

      const data = await response.json();
      
      // Validate response has content
      if (!data.content || data.content.trim() === "") {
        throw new Error("Empty response received");
      }
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.content,
        citations: data.citations || [],
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      if (messages.length === 0 && suggestedQuestions.length > 0) {
        fetchSuggestedQuestions();
      }
    } catch (error: any) {
      
      // Retry logic for temporary failures
      if (retryCount < 2 && (
        error.name === 'AbortError' ||
        error.message?.includes('temporarily unavailable') ||
        error.message?.includes('Empty response')
      )) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1500 * (retryCount + 1)));
        return sendMessage(text, retryCount + 1);
      }
      
      // Provide specific error messages
      let errorContent = "Sorry, I encountered an error processing your request.";
      
      if (error.name === 'AbortError') {
        errorContent = "The request took too long to process. Please try again with a simpler question.";
      } else if (error.message?.includes('temporarily unavailable')) {
        errorContent = "The AI service is temporarily unavailable. Please try again in a moment.";
      } else if (error.message?.includes('Empty response')) {
        errorContent = "I couldn't generate a proper response. Please try rephrasing your question.";
      }
      
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: errorContent,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent={false}>
      <Card className="w-full h-[600px] flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              <h3 className="font-semibold">Ask about this video</h3>
            </div>
            <ModelSelector
              value={selectedModel}
              onChange={handleModelChange}
              disabled={isLoading}
            />
          </div>
        </div>

        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-sm">Ask questions about the video content</p>
              <p className="text-xs mt-2">I'll provide answers with citations from the transcript</p>
            </div>
          )}
          
          <div className="space-y-4">
            {messages.map((message) => (
              <ChatMessageComponent
                key={message.id}
                message={message}
                onTimestampClick={onTimestampClick}
              />
            ))}
            
            {isLoading && (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
                <Card className="p-4 bg-muted/30">
                  <p className="text-sm text-muted-foreground">Thinking...</p>
                </Card>
              </div>
            )}
          </div>
        </ScrollArea>

        {messages.length === 0 && (
          <div className="px-4 pb-2">
            <SuggestedQuestions
              questions={suggestedQuestions}
              onQuestionClick={sendMessage}
              isLoading={loadingQuestions}
            />
          </div>
        )}

        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('placeholder')}
              className="resize-none"
              rows={2}
              disabled={isLoading}
            />
            <Button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              size="icon"
              className="self-end"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </Card>
    </TooltipProvider>
  );
}