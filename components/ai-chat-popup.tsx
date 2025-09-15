"use client";

import { useState, useRef, useEffect } from "react";
import { ChatMessage, TranscriptSegment, Topic, Citation } from "@/lib/types";
import { ChatMessageComponent } from "./chat-message";
import { SuggestedQuestions } from "./suggested-questions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Send, Loader2, ChevronUp, ChevronDown, MessageSquare, X, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AIChatPopupProps {
  transcript: TranscriptSegment[];
  topics: Topic[];
  videoId: string;
  videoTitle?: string;
  onCitationClick: (citation: Citation) => void;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string) => void;
  onPlayAllCitations?: (citations: Citation[]) => void;
}

export function AIChatPopup({
  transcript,
  topics,
  videoId,
  videoTitle,
  onCitationClick,
  onTimestampClick,
  onPlayAllCitations
}: AIChatPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [askedQuestions, setAskedQuestions] = useState<Set<string>>(new Set());
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);

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

  // Track unread messages when chat is closed or minimized
  useEffect(() => {
    if (!isOpen || isMinimized) {
      const newMessageCount = messages.filter(m => m.role === 'assistant').length;
      if (newMessageCount > lastMessageCountRef.current) {
        setUnreadCount(prev => prev + (newMessageCount - lastMessageCountRef.current));
      }
      lastMessageCountRef.current = newMessageCount;
    } else {
      setUnreadCount(0);
      lastMessageCountRef.current = messages.filter(m => m.role === 'assistant').length;
    }
  }, [messages, isOpen, isMinimized]);

  const fetchSuggestedQuestions = async () => {
    setLoadingQuestions(true);
    try {
      const response = await fetch("/api/suggested-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, topics, videoTitle }),
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

    if (retryCount === 0) {
      setMessages(prev => [...prev, userMessage]);
      setInput("");
      if (messageText) {
        setAskedQuestions(prev => new Set(prev).add(messageText));
      }
    }
    setIsLoading(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          transcript,
          topics,
          videoId,
          chatHistory: messages,
          model: 'gemini-2.5-flash-lite',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429 || response.status === 503) {
          throw new Error("Service temporarily unavailable");
        }
        throw new Error(`Failed to get response (${response.status})`);
      }

      const data = await response.json();

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
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      const errorMessage = error instanceof Error ? error.message : '';
      if (retryCount < 2 && (
        errorName === 'AbortError' ||
        errorMessage.includes('temporarily unavailable') ||
        errorMessage.includes('Empty response')
      )) {
        await new Promise(resolve => setTimeout(resolve, 1500 * (retryCount + 1)));
        return sendMessage(text, retryCount + 1);
      }

      let errorContent = "Sorry, I encountered an error processing your request.";

      if (errorName === 'AbortError') {
        errorContent = "The request took too long to process. Please try again with a simpler question.";
      } else if (errorMessage.includes('temporarily unavailable')) {
        errorContent = "The AI service is temporarily unavailable. Please try again in a moment.";
      } else if (errorMessage.includes('Empty response')) {
        errorContent = "I couldn't generate a proper response. Please try rephrasing your question.";
      }

      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: errorContent,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
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

  const toggleChat = () => {
    if (!isOpen) {
      setIsOpen(true);
      setIsMinimized(false);
      setUnreadCount(0);
    } else {
      setIsOpen(false);
    }
  };

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
    if (!isMinimized) {
      setUnreadCount(0);
    }
  };

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent={false}>
      {/* Floating Action Button */}
      {!isOpen && (
        <div className="fixed bottom-4 right-4 z-50">
          <Button
            onClick={toggleChat}
            size="icon"
            className={cn(
              "h-14 w-14 rounded-full shadow-lg",
              "bg-primary hover:bg-primary/90",
              "transition-all duration-200 hover:scale-105"
            )}
          >
            <MessageSquare className="h-6 w-6" />
            {unreadCount > 0 && (
              <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
                {unreadCount}
              </div>
            )}
          </Button>
        </div>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className={cn(
          "fixed bottom-4 right-4 z-50",
          "w-[380px] bg-background border rounded-lg shadow-2xl",
          "transition-all duration-300 ease-in-out",
          isMinimized ? "h-14" : "h-[500px]",
          "flex flex-col"
        )}>
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b bg-muted/50 rounded-t-lg">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm">AI Assistant</span>
              {unreadCount > 0 && isMinimized && (
                <div className="h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
                  {unreadCount}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                onClick={toggleMinimize}
                size="icon"
                variant="ghost"
                className="h-8 w-8"
              >
                {isMinimized ? <ChevronUp className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              </Button>
              <Button
                onClick={toggleChat}
                size="icon"
                variant="ghost"
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Chat Content */}
          {!isMinimized && (
            <>
              {/* Messages */}
              <ScrollArea className="flex-1 p-3" ref={scrollRef}>
                <div className="space-y-4">
                  {messages.length === 0 && (
                    <div className="text-center py-8">
                      <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                      <p className="text-sm text-muted-foreground">
                        Hi! Ask me anything about this video.
                      </p>
                    </div>
                  )}
                  {messages.map((message) => (
                    <ChatMessageComponent
                      key={message.id}
                      message={message}
                      onCitationClick={onCitationClick}
                      onTimestampClick={onTimestampClick}
                      onPlayAllCitations={onPlayAllCitations}
                    />
                  ))}

                  {isLoading && (
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                      <div className="p-3 rounded-lg bg-muted/30 max-w-[85%]">
                        <p className="text-sm text-muted-foreground">Thinking...</p>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Suggested Questions */}
              {suggestedQuestions.length > 0 && (
                <div className="px-3 py-2 border-t">
                  <div className="space-y-2">
                    <button
                      onClick={() => setShowSuggestions(!showSuggestions)}
                      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                    >
                      {showSuggestions ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                      <span className="font-medium">Suggested questions</span>
                    </button>
                    {showSuggestions && (
                      <SuggestedQuestions
                        questions={suggestedQuestions.slice(0, 3)}
                        onQuestionClick={sendMessage}
                        isLoading={loadingQuestions}
                        askedQuestions={askedQuestions}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Input Area */}
              <div className="p-3 border-t">
                <div className="flex gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your message..."
                    className="resize-none text-sm"
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
            </>
          )}
        </div>
      )}
    </TooltipProvider>
  );
}