"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { UrlInput } from "@/components/url-input";
import { Card } from "@/components/ui/card";
import { extractVideoId } from "@/lib/utils";
import { toast } from "sonner";
import { AuthModal } from "@/components/auth-modal";
import { useModePreference } from "@/lib/hooks/use-mode-preference";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const authPromptHandled = useRef(false);
  const { mode, setMode } = useModePreference();

  useEffect(() => {
    if (!searchParams) return;

    const videoIdParam = searchParams.get("v");
    if (!videoIdParam) return;

    const params = new URLSearchParams();
    const cachedParam = searchParams.get("cached");
    const urlParam = searchParams.get("url");

    if (cachedParam === "true") {
      params.set("cached", "true");
    }

    if (urlParam) {
      params.set("url", urlParam);
    }

    router.replace(
      `/analyze/${videoIdParam}${params.toString() ? `?${params.toString()}` : ""}`,
      { scroll: false }
    );
  }, [router, searchParams]);

  useEffect(() => {
    if (!searchParams) return;

    const authParam = searchParams.get("auth");
    if (authParam !== "limit" || authPromptHandled.current) {
      return;
    }

    authPromptHandled.current = true;

    let message = "You've used today's free analysis. Sign in to keep going.";
    try {
      const storedMessage = sessionStorage.getItem("limitRedirectMessage");
      if (storedMessage) {
        message = storedMessage;
        sessionStorage.removeItem("limitRedirectMessage");
      }

      const storedVideo = sessionStorage.getItem("pendingVideoId");
      if (storedVideo) {
        setPendingVideoId(storedVideo);
      }
    } catch (error) {
      console.error("Failed to read sessionStorage for auth redirect:", error);
    }

    toast.error(message);
    setAuthModalOpen(true);

    const params = new URLSearchParams(searchParams.toString());
    params.delete("auth");
    const queryString = params.toString();
    router.replace(queryString ? `/?${queryString}` : "/", { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    if (!authModalOpen) {
      return;
    }

    try {
      const storedVideo = sessionStorage.getItem("pendingVideoId");
      if (storedVideo) {
        setPendingVideoId(storedVideo);
      }
    } catch (error) {
      console.error("Failed to sync pending video for auth modal:", error);
    }
  }, [authModalOpen]);

  const handleSubmit = useCallback(
    (url: string) => {
      const videoId = extractVideoId(url);
      if (!videoId) {
        toast.error("Please enter a valid YouTube URL");
        return;
      }

      const params = new URLSearchParams();
      params.set("url", url);

      router.push(`/analyze/${videoId}?${params.toString()}`);
    },
    [router]
  );

  return (
    <>
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="mx-auto flex w-full max-w-[660px] -translate-y-[5vh] transform flex-col items-center gap-9 px-6 py-16 text-center sm:py-24">
          <header className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-[21px] font-bold tracking-tight text-[#787878]">TLDW</h1>
            </div>
            <p className="text-[14px] leading-[15px] text-[#787878]">
              Too Long; Didn&apos;t Watch - Learn from long videos 10x faster
            </p>
          </header>
          <div className="flex w-full flex-col items-center gap-9">
            <UrlInput onSubmit={handleSubmit} mode={mode} onModeChange={setMode} />

            <Card className="relative flex w-[425px] max-w-full flex-col gap-2.5 overflow-hidden rounded-[22px] border border-[#f0f1f1] bg-white p-6 text-left shadow-[2px_11px_40.4px_rgba(0,0,0,0.06)]">
              <div className="relative z-10 flex flex-col gap-2.5">
                <h3 className="text-[14px] font-medium leading-[15px] text-[#5c5c5c]">
                  Jump to top insights immediately
                </h3>
                <p className="max-w-[60%] text-[14px] leading-[1.5] text-[#8d8d8d]">
                  Paste a link, and we&apos;ll generate highlight reels for you. Consume a 1-hour video in 5 minutes.
                </p>
              </div>
              <div className="pointer-events-none absolute right-[10px] top-[-00px] h-[110px] w-[110px]">
                <div className="absolute inset-0 overflow-hidden rounded-full opacity-100 [mask-image:radial-gradient(circle,black_30%,transparent_65%)]">
                  <Image
                    src="/gradient_person.jpg"
                    alt="Gradient silhouette illustration"
                    fill
                    sizes="100px"
                    className="object-cover"
                    priority
                  />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
      <AuthModal
        open={authModalOpen}
        onOpenChange={(open) => {
          setAuthModalOpen(open);
          if (!open) {
            setPendingVideoId(null);
          }
        }}
        trigger="generation-limit"
        currentVideoId={pendingVideoId}
      />
    </>
  );
}
